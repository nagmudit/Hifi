import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A guard, not a unit test.
 *
 * The worker's environment holds the customer's model key. Spreading it into a
 * subprocess hands that key to code the customer's repository controls, which
 * is how M2 shipped a leak that undid ADR-002. This fails the build if any
 * product source spreads the parent environment again. Subprocesses must use
 * `childEnv` from `@hifi/core`. Security model control S-14.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SPREAD = /\.\.\.\s*process\.env\b/;

function productSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...productSources(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("subprocess environments", () => {
  it("are never built by spreading the worker's own environment", () => {
    const offenders: string[] = [];
    for (const group of ["apps", "packages"]) {
      for (const pkg of readdirSync(path.join(ROOT, group))) {
        const src = path.join(ROOT, group, pkg, "src");
        try {
          statSync(src);
        } catch {
          continue;
        }
        for (const file of productSources(src)) {
          if (SPREAD.test(readFileSync(file, "utf8"))) {
            offenders.push(path.relative(ROOT, file));
          }
        }
      }
    }
    expect(offenders, "use childEnv from @hifi/core instead").toEqual([]);
  });
});
