import { createRequire } from "node:module";

// libsodium-wrappers 0.7.16 publishes an ESM entry that imports a file it does
// not ship, so a plain `import` fails under Node ESM. The CommonJS build is
// correct on every version, and createRequire always selects it. Revisit when
// the upstream packaging is fixed.
const sodium = createRequire(import.meta.url)(
  "libsodium-wrappers",
) as typeof import("libsodium-wrappers");

/**
 * Credential sealing.
 *
 * A libsodium sealed box is hybrid encryption: libsodium generates an ephemeral
 * keypair per message, derives a shared secret with the master public key, and
 * discards the ephemeral secret. That is the envelope. The practical property we
 * want from it is asymmetry: the control plane needs only the public key to
 * store a customer credential, so an attacker who reaches the API or the
 * database still cannot read one. Only a worker holds the secret key.
 *
 * Blob layout:
 *   magic "HIFI" (4 bytes) | format version (1) | key version (1) | sealed box
 */
const MAGIC = new Uint8Array([0x48, 0x49, 0x46, 0x49]); // "HIFI"
const FORMAT_VERSION = 1;
const HEADER_BYTES = 6;

export interface MasterKeypair {
  publicKey: string;
  secretKey: string;
}

export interface SealedBlob {
  ciphertext: Uint8Array;
  keyVersion: number;
}

let ready = false;

/** Must be awaited once per process before any other function here. */
export async function initCrypto(): Promise<void> {
  if (ready) return;
  await sodium.ready;
  ready = true;
}

function assertReady(): void {
  if (!ready) {
    throw new Error("initCrypto() must be awaited before sealing or unsealing");
  }
}

export function generateMasterKeypair(): MasterKeypair {
  assertReady();
  const pair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL),
    secretKey: sodium.to_base64(pair.privateKey, sodium.base64_variants.ORIGINAL),
  };
}

function decodeKey(value: string, label: string, expectedBytes: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
  if (bytes.length !== expectedBytes) {
    throw new Error(
      `${label} must be ${expectedBytes} bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

/**
 * Seal a plaintext credential. Requires only the public key, so this is safe to
 * call from the API and the dashboard.
 */
export function seal(
  plaintext: string,
  options: { publicKey: string; keyVersion: number },
): SealedBlob {
  assertReady();
  if (plaintext.length === 0) throw new Error("refusing to seal empty plaintext");
  if (!Number.isInteger(options.keyVersion) || options.keyVersion < 1 || options.keyVersion > 255) {
    throw new Error("keyVersion must be an integer in 1..255");
  }

  const publicKey = decodeKey(
    options.publicKey,
    "master public key",
    sodium.crypto_box_PUBLICKEYBYTES,
  );
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(plaintext),
    publicKey,
  );

  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  out[5] = options.keyVersion;
  out.set(sealed, HEADER_BYTES);
  return { ciphertext: out, keyVersion: options.keyVersion };
}

export function readKeyVersion(blob: Uint8Array): number {
  if (blob.length < HEADER_BYTES) throw new Error("sealed blob is truncated");
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (blob[i] !== MAGIC[i]) throw new Error("sealed blob has a bad magic header");
  }
  if (blob[4] !== FORMAT_VERSION) {
    throw new Error(`unsupported sealed blob format: ${String(blob[4])}`);
  }
  return blob[5] as number;
}

/**
 * Unseal into memory. Only ever called on a worker, and the result must never
 * be written to disk, a log line, or an error payload.
 */
export function unseal(
  blob: Uint8Array,
  keyring: { publicKey: string; secretKey: string; keyVersion: number }[],
): string {
  assertReady();
  const version = readKeyVersion(blob);
  const entry = keyring.find((k) => k.keyVersion === version);
  if (!entry) {
    throw new Error(`no master key available for key version ${version}`);
  }

  const publicKey = decodeKey(
    entry.publicKey,
    "master public key",
    sodium.crypto_box_PUBLICKEYBYTES,
  );
  const secretKey = decodeKey(
    entry.secretKey,
    "master secret key",
    sodium.crypto_box_SECRETKEYBYTES,
  );

  let opened: Uint8Array;
  try {
    opened = sodium.crypto_box_seal_open(
      blob.subarray(HEADER_BYTES),
      publicKey,
      secretKey,
    );
  } catch {
    // Deliberately opaque: a decryption failure must not describe the input.
    throw new Error("sealed credential could not be opened");
  }
  return sodium.to_string(opened);
}
