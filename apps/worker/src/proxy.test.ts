import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { extractUsage, startModelProxy, type ModelProxy } from "./proxy.js";

/**
 * Driven against a fake upstream, so the suite never calls a real model API.
 * The fake records what it was sent, which is how the budget clamping and the
 * key swap are checked.
 */
interface Recorded {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown> | null;
}

let upstream: Server;
let upstreamUrl: string;
let received: Recorded[] = [];
let respondWith: (body: Record<string, unknown>) => { status: number; body: string; sse?: boolean } = () => ({
  status: 200,
  body: JSON.stringify({ ok: true, usage: { prompt_tokens: 100, completion_tokens: 50 } }),
});

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      received.push({ path: req.url ?? "", auth: req.headers.authorization, body: parsed });

      const reply = respondWith(parsed ?? {});
      if (reply.sse) {
        res.writeHead(reply.status, { "content-type": "text/event-stream" });
        res.end(reply.body);
      } else {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
      }
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

async function withProxy(
  ceiling: number,
  fn: (proxy: ModelProxy) => Promise<void>,
): Promise<void> {
  received = [];
  const proxy = await startModelProxy({
    upstreamBaseUrl: upstreamUrl,
    apiKey: "sk-test-REAL-CUSTOMER-KEY",
    tokenCeiling: ceiling,
  });
  try {
    await fn(proxy);
  } finally {
    await proxy.close();
  }
}

function call(proxy: ModelProxy, body: Record<string, unknown>, token?: string) {
  return fetch(`${proxy.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token ?? proxy.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("extractUsage", () => {
  it("reads the chat completions shape", () => {
    expect(
      extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 3 } }),
    ).toEqual({ input: 10, output: 3, cacheRead: undefined });
  });

  it("reads the responses shape", () => {
    expect(extractUsage({ usage: { input_tokens: 7, output_tokens: 2 } })).toMatchObject({
      input: 7,
      output: 2,
    });
  });

  it("reads cached input tokens", () => {
    expect(
      extractUsage({
        usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 8 } },
      }),
    ).toMatchObject({ cacheRead: 8 });
  });

  it("returns null when there is no usage to read", () => {
    expect(extractUsage({})).toBeNull();
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage("nonsense")).toBeNull();
  });
});

describe("model proxy", () => {
  it("swaps the job token for the real key and never leaks it downstream", async () => {
    await withProxy(100_000, async (proxy) => {
      const res = await call(proxy, { model: "m", messages: [] });
      expect(res.status).toBe(200);
      expect(received[0]?.auth).toBe("Bearer sk-test-REAL-CUSTOMER-KEY");
      // The agent only ever sees its own job token.
      expect(proxy.token).not.toContain("sk-test");
    });
  });

  it("refuses a caller without the job token", async () => {
    await withProxy(100_000, async (proxy) => {
      const res = await call(proxy, { model: "m", messages: [] }, "wrong-token");
      expect(res.status).toBe(401);
      expect(received).toHaveLength(0);
    });
  });

  it("preserves the request path", async () => {
    await withProxy(100_000, async (proxy) => {
      await call(proxy, { model: "m", messages: [] });
      expect(received[0]?.path).toBe("/v1/chat/completions");
    });
  });

  it("meters usage from a JSON response", async () => {
    await withProxy(100_000, async (proxy) => {
      await call(proxy, { model: "m", messages: [] });
      await call(proxy, { model: "m", messages: [] });
      expect(proxy.usage()).toEqual({
        tokensIn: 200,
        tokensOut: 100,
        tokensCacheRead: 0,
        calls: 2,
      });
    });
  });

  it("meters usage from a streamed response and forwards every frame", async () => {
    respondWith = () => ({
      status: 200,
      sse: true,
      body: [
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        'data: {"usage":{"prompt_tokens":42,"completion_tokens":8}}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    });

    await withProxy(100_000, async (proxy) => {
      const res = await call(proxy, { model: "m", messages: [], stream: true });
      const text = await res.text();
      expect(text).toContain('"content":"hi"');
      expect(text).toContain("[DONE]");
      expect(proxy.usage().tokensIn).toBe(42);
      expect(proxy.usage().tokensOut).toBe(8);
    });

    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ ok: true, usage: { prompt_tokens: 100, completion_tokens: 50 } }),
    });
  });

  it("asks for usage on streamed requests, because metering is not optional", async () => {
    respondWith = () => ({ status: 200, sse: true, body: "data: [DONE]\n\n" });
    await withProxy(100_000, async (proxy) => {
      await call(proxy, { model: "m", messages: [], stream: true });
      expect(received[0]?.body?.stream_options).toEqual({ include_usage: true });
    });
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ ok: true, usage: { prompt_tokens: 100, completion_tokens: 50 } }),
    });
  });

  it("clamps a request that asks for more output than the budget allows", async () => {
    await withProxy(1000, async (proxy) => {
      await call(proxy, { model: "m", messages: [], max_completion_tokens: 50_000 });
      expect(received[0]?.body?.max_completion_tokens).toBe(1000);
    });
  });

  it("clamps the older max_tokens spelling too", async () => {
    await withProxy(1000, async (proxy) => {
      await call(proxy, { model: "m", messages: [], max_tokens: 50_000 });
      expect(received[0]?.body?.max_tokens).toBe(1000);
    });
  });

  it("leaves a modest request alone when the budget is large", async () => {
    await withProxy(1_000_000, async (proxy) => {
      await call(proxy, { model: "m", messages: [], max_completion_tokens: 256 });
      expect(received[0]?.body?.max_completion_tokens).toBe(256);
    });
  });

  it("stops the job mid-run once the ceiling is reached", async () => {
    // 400 leaves room for one 150-token call, after which too little remains to
    // be worth another request.
    await withProxy(400, async (proxy) => {
      const first = await call(proxy, { model: "m", messages: [] });
      expect(first.status).toBe(200);
      expect(proxy.exceeded()).toBe(true);

      const second = await call(proxy, { model: "m", messages: [] });
      expect(second.status).toBe(402);
      const body = (await second.json()) as { error: { type: string; message: string } };
      expect(body.error.type).toBe("hifi_budget_exhausted");
      expect(body.error.message).toContain("of 400 tokens used");

      // The refused call never reached the provider, so it cost nothing.
      expect(received).toHaveLength(1);
    });
  });

  it("refuses everything when the ceiling is too small to be useful", async () => {
    await withProxy(100, async (proxy) => {
      const res = await call(proxy, { model: "m", messages: [] });
      expect(res.status).toBe(402);
      expect(received).toHaveLength(0);
    });
  });

  it("passes an upstream error through rather than masking it", async () => {
    respondWith = () => ({
      status: 429,
      body: JSON.stringify({ error: { message: "slow down" } }),
    });
    await withProxy(100_000, async (proxy) => {
      const res = await call(proxy, { model: "m", messages: [] });
      expect(res.status).toBe(429);
      expect(await res.text()).toContain("slow down");
    });
    respondWith = () => ({
      status: 200,
      body: JSON.stringify({ ok: true, usage: { prompt_tokens: 100, completion_tokens: 50 } }),
    });
  });
});
