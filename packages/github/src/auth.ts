import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

import { HifiError } from "@hifi/core";
import { FailureCode } from "@hifi/db";

import { githubRequest } from "./http.js";

export interface InstallationToken {
  token: string;
  expiresAt: Date;
  installationId: number;
  permissions: Record<string, string>;
  repositorySelection: string;
}

export interface AppCredentials {
  appId: string;
  privateKeyPem: string;
}

/** A GitHub App JWT is good for ten minutes; we ask for nine. */
const JWT_LIFETIME_SECONDS = 540;
const CLOCK_SKEW_SECONDS = 60;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppJwt(credentials: AppCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const body = [
    base64url({ alg: "RS256", typ: "JWT" }),
    base64url({
      // Backdated because GitHub rejects a JWT whose iat is in its future.
      iat: now - CLOCK_SKEW_SECONDS,
      exp: now + JWT_LIFETIME_SECONDS,
      iss: credentials.appId,
    }),
  ].join(".");

  try {
    const signer = createSign("RSA-SHA256");
    signer.update(body);
    return `${body}.${signer.sign(credentials.privateKeyPem, "base64url")}`;
  } catch (err) {
    throw new HifiError(
      FailureCode.credential_invalid,
      "GitHub App private key could not sign a token",
      { cause: err },
    );
  }
}

/**
 * Loads the App private key. Locally it is a path to the downloaded .pem; in
 * production it is the key itself, held as a platform secret.
 */
export function loadPrivateKey(source: { pem?: string; pemPath?: string }): string {
  if (source.pem && source.pem.trim().length > 0) return source.pem;
  if (source.pemPath && source.pemPath.trim().length > 0) {
    try {
      return readFileSync(source.pemPath, "utf8");
    } catch (err) {
      throw new HifiError(
        FailureCode.credential_missing,
        `GitHub App private key file could not be read: ${source.pemPath}`,
        { cause: err },
      );
    }
  }
  throw new HifiError(
    FailureCode.credential_missing,
    "No GitHub App private key configured",
  );
}

interface TokenResponse {
  token: string;
  expires_at: string;
  permissions?: Record<string, string>;
  repository_selection?: string;
}

/**
 * Mints an installation token. These last an hour and are minted per job: they
 * are never cached across jobs, which `packages/github/README.md` requires and
 * which is the whole reason the product uses an App rather than a token.
 */
export async function mintInstallationToken(input: {
  appId: string;
  privateKeyPem: string;
  installationId: number | string;
}): Promise<InstallationToken> {
  const jwt = createAppJwt({
    appId: input.appId,
    privateKeyPem: input.privateKeyPem,
  });

  const res = await githubRequest<TokenResponse>({
    method: "POST",
    path: `/app/installations/${input.installationId}/access_tokens`,
    auth: `Bearer ${jwt}`,
  });

  return {
    token: res.token,
    expiresAt: new Date(res.expires_at),
    installationId: Number(input.installationId),
    permissions: res.permissions ?? {},
    repositorySelection: res.repository_selection ?? "unknown",
  };
}

/** Authorization header value for a minted installation token. */
export function tokenAuth(token: string): string {
  return `token ${token}`;
}
