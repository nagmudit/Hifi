import { beforeAll, describe, expect, it } from "vitest";

import {
  containsSecret,
  generateMasterKeypair,
  initCrypto,
  readKeyVersion,
  redactSecrets,
  redactString,
  rejectionReason,
  seal,
  unseal,
  type MasterKeypair,
} from "./index.js";

let keys: MasterKeypair;
let other: MasterKeypair;

beforeAll(async () => {
  await initCrypto();
  keys = generateMasterKeypair();
  other = generateMasterKeypair();
});

function keyring(pair: MasterKeypair, keyVersion = 1) {
  return [{ ...pair, keyVersion }];
}

describe("seal / unseal", () => {
  it("round-trips a credential", () => {
    const secret = "sk-ant-api03-" + "a".repeat(40);
    const blob = seal(secret, { publicKey: keys.publicKey, keyVersion: 1 });
    expect(unseal(blob.ciphertext, keyring(keys))).toBe(secret);
  });

  it("produces different ciphertext for the same plaintext", () => {
    const a = seal("hunter2hunter2", { publicKey: keys.publicKey, keyVersion: 1 });
    const b = seal("hunter2hunter2", { publicKey: keys.publicKey, keyVersion: 1 });
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("never leaves the plaintext visible in the blob", () => {
    const secret = "ghp_" + "z".repeat(36);
    const blob = seal(secret, { publicKey: keys.publicKey, keyVersion: 1 });
    expect(Buffer.from(blob.ciphertext).toString("utf8")).not.toContain(secret);
  });

  it("carries the key version in the header", () => {
    const blob = seal("something", { publicKey: keys.publicKey, keyVersion: 7 });
    expect(readKeyVersion(blob.ciphertext)).toBe(7);
  });

  it("selects the right key from a keyring during rotation", () => {
    const v1 = seal("old-secret", { publicKey: keys.publicKey, keyVersion: 1 });
    const v2 = seal("new-secret", { publicKey: other.publicKey, keyVersion: 2 });
    const ring = [
      { ...keys, keyVersion: 1 },
      { ...other, keyVersion: 2 },
    ];
    expect(unseal(v1.ciphertext, ring)).toBe("old-secret");
    expect(unseal(v2.ciphertext, ring)).toBe("new-secret");
  });

  it("refuses a blob whose key version is not in the keyring", () => {
    const blob = seal("secret", { publicKey: keys.publicKey, keyVersion: 3 });
    expect(() => unseal(blob.ciphertext, keyring(keys, 1))).toThrow(
      /key version 3/,
    );
  });

  it("rejects the wrong secret key", () => {
    const blob = seal("secret", { publicKey: keys.publicKey, keyVersion: 1 });
    expect(() => unseal(blob.ciphertext, keyring(other))).toThrow(
      /could not be opened/,
    );
  });

  it("rejects tampered ciphertext", () => {
    const blob = seal("secret", { publicKey: keys.publicKey, keyVersion: 1 });
    const tampered = Uint8Array.from(blob.ciphertext);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] as number) ^ 0xff;
    expect(() => unseal(tampered, keyring(keys))).toThrow(/could not be opened/);
  });

  it("rejects a blob with a bad header", () => {
    expect(() => readKeyVersion(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(
      /bad magic/,
    );
    expect(() => readKeyVersion(new Uint8Array([1, 2]))).toThrow(/truncated/);
  });

  it("refuses empty plaintext and impossible key versions", () => {
    expect(() => seal("", { publicKey: keys.publicKey, keyVersion: 1 })).toThrow();
    expect(() => seal("x", { publicKey: keys.publicKey, keyVersion: 0 })).toThrow();
    expect(() => seal("x", { publicKey: "not-base64!!", keyVersion: 1 })).toThrow();
  });
});

describe("redaction", () => {
  it("scrubs known key prefixes but keeps the prefix as a breadcrumb", () => {
    const line = "using key sk-ant-api03-abcdefghijklmnop for the run";
    expect(redactString(line)).toBe("using key sk-ant-[redacted] for the run");
  });

  it("scrubs GitHub installation and personal tokens", () => {
    for (const token of [
      "ghs_" + "a".repeat(36),
      "ghp_" + "b".repeat(36),
      "github_pat_" + "c".repeat(40),
    ]) {
      expect(redactString(`token=${token}`)).not.toContain(token);
    }
  });

  it("scrubs OpenAI keys, both the project and the classic shapes", () => {
    for (const key of ["sk-proj-" + "a".repeat(48), "sk-" + "b".repeat(48)]) {
      const line = `calling the model with ${key}`;
      expect(redactString(line)).not.toContain(key);
      expect(redactString(line)).toContain("[redacted]");
      expect(containsSecret(key)).toBe(true);
    }
  });

  it("scrubs private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nabcdef\n-----END RSA PRIVATE KEY-----";
    expect(redactString(pem)).not.toContain("abcdef");
  });

  it("leaves ordinary text alone", () => {
    const line = "opened PR #12 on acme/web in 4.2s";
    expect(redactString(line)).toBe(line);
  });

  it("walks nested payloads, arrays, and errors", () => {
    const secret = "sk-or-v1-" + "d".repeat(32);
    const payload = {
      job: { id: "job_1", env: { KEY: secret } },
      attempts: [{ err: new Error(`failed with ${secret}`) }],
    };
    const out = JSON.stringify(redactSecrets(payload));
    expect(out).not.toContain(secret);
    expect(out).toContain("job_1");
  });

  it("bounds recursion depth instead of overflowing", () => {
    type Nested = { next?: Nested };
    const root: Nested = {};
    let cursor = root;
    for (let i = 0; i < 50; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(() => redactSecrets(root)).not.toThrow();
  });

  it("detects secrets without mutating them", () => {
    expect(containsSecret("ghp_" + "e".repeat(36))).toBe(true);
    expect(containsSecret("nothing here")).toBe(false);
  });
});

describe("onboarding key validation", () => {
  it("rejects Claude subscription OAuth tokens with a specific message", () => {
    const reason = rejectionReason("sk-ant-oat01-" + "f".repeat(40));
    expect(reason).toMatch(/Console API key/);
  });

  it("accepts a Console API key", () => {
    expect(rejectionReason("sk-ant-api03-" + "g".repeat(40))).toBeNull();
  });

  it("rejects an empty key", () => {
    expect(rejectionReason("   ")).toMatch(/empty/);
  });
});
