# @hifi/crypto

Credential sealing and log redaction. A leaf package: it depends on nothing else in the monorepo.

## Owns
- `seal` and `unseal`. A libsodium sealed box is hybrid encryption with a per-message ephemeral keypair, which gives the property we want: sealing needs only the public key, so the control plane can store a customer credential it cannot read. Only workers hold the secret key.
- Key rotation through `keyVersion`, carried in the blob header so a keyring can hold several master keys at once.
- `redactSecrets`, the last line of defence before a log sink, and `rejectionReason`, the onboarding guard that refuses Claude subscription OAuth tokens.

## Must never
- Log, persist, or include plaintext in an error message. `unseal` failures are deliberately opaque about their input.
- Weaken the redactor list. Add prefixes, never remove them.
- Be treated as the primary control. The primary control is that secrets are never handed to anything that logs.

## Commands
```
pnpm --filter @hifi/crypto keygen   # print a master keypair for a new environment
```
