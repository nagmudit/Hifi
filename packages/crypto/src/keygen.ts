import { generateMasterKeypair, initCrypto } from "./seal.js";

/**
 * One-off helper: prints a master keypair for a new environment.
 *
 *   pnpm --filter @hifi/crypto keygen
 *
 * The public key goes everywhere. The secret key goes to workers only, as a Fly
 * secret, and never into .env in a shared environment.
 */
await initCrypto();
const pair = generateMasterKeypair();
process.stdout.write(
  [
    "HIFI_MASTER_PUBLIC_KEY=" + pair.publicKey,
    "HIFI_MASTER_SECRET_KEY=" + pair.secretKey,
    "HIFI_MASTER_KEY_VERSION=1",
    "",
  ].join("\n"),
);
