import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { containsSecret } from "@hifi/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { childEnv } from "./child-env.js";

const exec = promisify(execFile);

/**
 * The secrets a real worker holds, by name and shape. None of these may ever
 * reach a subprocess, because every subprocess runs code the customer's
 * repository controls.
 */
const PLANTED: Record<string, string> = {
  M2_MODEL_API_KEY: "sk-proj-" + "a".repeat(48),
  HIFI_MASTER_SECRET_KEY: "master-secret-" + "b".repeat(32),
  DISCORD_BOT_TOKEN: "discord-token-" + "c".repeat(40),
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  DATABASE_URL: "postgresql://hifi:hifi@localhost:55432/hifi",
  SOME_FUTURE_SECRET: "ghs_" + "d".repeat(36),
};

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const [name, value] of Object.entries(PLANTED)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("childEnv", () => {
  it("leaves out every secret the worker holds, by name", () => {
    const env = childEnv();
    for (const name of Object.keys(PLANTED)) {
      expect(env[name], name).toBeUndefined();
    }
  });

  it("leaves out every secret by value too, whatever it is called", () => {
    const values = Object.values(childEnv()).join("\n");
    for (const value of Object.values(PLANTED)) {
      expect(values).not.toContain(value);
    }
  });

  it("keeps what a program needs in order to run", () => {
    const env = childEnv();
    const names = Object.keys(env).map((n) => n.toUpperCase());
    expect(names).toContain("PATH");
    if (process.platform === "win32") expect(names).toContain("SYSTEMROOT");
  });

  it("never passes a variable merely because it is not on a denylist", () => {
    // The approach is an allowlist. A brand-new secret nobody thought to name
    // must not slip through.
    expect(childEnv().SOME_FUTURE_SECRET).toBeUndefined();
  });

  it("drops an allowed name whose value looks like a key", () => {
    const env = childEnv({ source: { PATH: "/usr/bin", TERM: "sk-proj-" + "e".repeat(48) } });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.TERM).toBeUndefined();
  });

  it("passes what the caller deliberately adds", () => {
    const env = childEnv({ extra: { GIT_TERMINAL_PROMPT: "0" } });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("holds against a real child process, not just the object", async () => {
    // A subprocess that prints everything it can see, which is what a hostile
    // postinstall script would do.
    const { stdout } = await exec(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      { env: childEnv(), windowsHide: true },
    );
    const seen = JSON.parse(stdout) as Record<string, string>;

    for (const name of Object.keys(PLANTED)) {
      expect(seen[name], name).toBeUndefined();
    }
    expect(containsSecret(stdout)).toBe(false);
  });
});
