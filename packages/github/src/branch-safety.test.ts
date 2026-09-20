import { BRANCH_PREFIX, HifiError } from "@hifi/core";
import { FailureCode } from "@hifi/db";
import { describe, expect, it } from "vitest";

import {
  assertBranchWritable,
  assertRepoAllowed,
  buildBranchName,
} from "./branch-safety.js";

const DEFAULTS = { defaultBranch: "main", protectedBranches: ["release", "develop"] };

function check(targetBranch: string, overrides: Partial<typeof DEFAULTS> = {}) {
  return () => assertBranchWritable({ ...DEFAULTS, ...overrides, targetBranch });
}

describe("assertBranchWritable", () => {
  it("allows a branch under the HiFi prefix", () => {
    expect(check("hifi/fix-the-typo-a1b2c3d4")).not.toThrow();
    expect(BRANCH_PREFIX).toBe("hifi");
  });

  it("refuses the default branch", () => {
    expect(check("main")).toThrow(/default branch|only branches under/);
  });

  it("refuses the default branch even under a different case", () => {
    expect(check("Main", { defaultBranch: "main" })).toThrow();
    expect(check("hifi/x", { defaultBranch: "hifi/X" })).toThrow(/default branch/);
  });

  it("refuses a protected branch", () => {
    expect(check("hifi/x", { protectedBranches: ["hifi/x"] })).toThrow(/protected branch/);
    expect(check("hifi/x", { protectedBranches: ["HIFI/X"] })).toThrow(/protected branch/);
  });

  it("refuses anything outside the prefix, however innocent", () => {
    for (const branch of ["develop", "feature/thing", "hifi", "hifix/thing", "x-hifi/thing"]) {
      expect(check(branch), branch).toThrow(/only branches under hifi\//);
    }
  });

  it("refuses names git itself would reject", () => {
    const bad = [
      "hifi/has space",
      "hifi/../escape",
      "hifi/trailing/",
      "hifi//empty",
      "hifi/thing.lock",
      "hifi/at@{1}",
      "hifi/tilde~1",
      "hifi/caret^",
      "hifi/colon:",
      "hifi/question?",
      "hifi/star*",
      "hifi/bracket[",
      "hifi/back\\slash",
      "hifi/tab\tname",
      "hifi/null\u0000byte",
    ];
    for (const branch of bad) {
      expect(check(branch), branch).toThrow(HifiError);
    }
  });

  it("refuses an empty, padded, or absurdly long name", () => {
    expect(check("")).toThrow(/empty/);
    expect(check("   ")).toThrow();
    expect(check(" hifi/x ")).toThrow();
    expect(check(`hifi/${"a".repeat(300)}`)).toThrow(/longer than/);
  });

  it("refuses a leading slash", () => {
    expect(check("/hifi/x")).toThrow();
  });

  it("carries the protected_branch failure code, not a generic error", () => {
    try {
      assertBranchWritable({ ...DEFAULTS, targetBranch: "main" });
      expect.unreachable("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(HifiError);
      expect((err as HifiError).code).toBe(FailureCode.protected_branch);
    }
  });

  it("does not leak the branch name into the user-facing message", () => {
    try {
      assertBranchWritable({ ...DEFAULTS, targetBranch: "main" });
      expect.unreachable("should have refused");
    } catch (err) {
      expect((err as HifiError).userMessage).toBe("Refused to write to that branch.");
    }
  });

  it("treats an empty protected list as no second opinion, not as permission", () => {
    expect(check("main", { protectedBranches: [] })).toThrow();
    expect(check("release", { protectedBranches: [] })).toThrow();
  });
});

describe("assertRepoAllowed", () => {
  it("allows the bound repository, ignoring case", () => {
    expect(() => assertRepoAllowed("acme/web", "acme/web")).not.toThrow();
    expect(() => assertRepoAllowed("Acme/Web", "acme/web")).not.toThrow();
  });

  it("refuses any other repository", () => {
    expect(() => assertRepoAllowed("acme/other", "acme/web")).toThrow(/bound to/);
    expect(() => assertRepoAllowed("evil/web", "acme/web")).toThrow(/bound to/);
  });
});

describe("buildBranchName", () => {
  it("builds a readable branch under the prefix", () => {
    expect(buildBranchName("Fix the typo in the headline", "job_a1b2c3d4e5")).toBe(
      "hifi/fix-the-typo-in-the-headline-joba1b2c",
    );
  });

  it("always produces a branch that passes the safety check", () => {
    const prompts = [
      "Fix the typo in the headline",
      "   ",
      "!!!",
      "Add annual billing at 10x the monthly price, with tests",
      "emoji 🎉 and symbols &*()",
      "a".repeat(500),
    ];
    for (const prompt of prompts) {
      const branch = buildBranchName(prompt, "job_abcdef12");
      expect(() => assertBranchWritable({ ...DEFAULTS, targetBranch: branch }), prompt).not.toThrow();
    }
  });

  it("falls back to a usable name when the prompt yields no slug", () => {
    expect(buildBranchName("!!!", "job_abcdef12")).toBe("hifi/task-jobabcde");
  });
});
