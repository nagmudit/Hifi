import { JobStatus, type Job } from "@hifi/db";
import { describe, expect, it } from "vitest";

import { buildFinalEmbed, buildRunningEmbed } from "./report.js";

/**
 * The report is the only part of the product most people will ever read, so it
 * gets tested like a product surface. No database and no Discord: these build
 * plain objects from a job row.
 */
function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_test",
    status: JobStatus.succeeded,
    statusDetail: null,
    summary: null,
    prUrl: null,
    prNumber: null,
    diffStat: null,
    tokensIn: 1000,
    tokensOut: 50,
    durationMs: 42_000,
    modelSelection: { model: "gpt-5-mini" },
    ...overrides,
  } as unknown as Job;
}

function data(embed: ReturnType<typeof buildFinalEmbed>) {
  return embed.toJSON();
}

describe("final report", () => {
  it("shows the agent's answer when there was nothing to push", () => {
    const answer = "It is a Next.js App Router site with one pure pricing module.";
    const embed = data(buildFinalEmbed(job({ summary: answer }), "acme/web"));

    expect(embed.title).toBe("No change needed");
    expect(embed.description).toBe(answer);
    // No pull request to link to, and no file list to show.
    expect(embed.fields?.map((f) => f.name)).toEqual(["Run"]);
    expect(embed.url).toBeUndefined();
  });

  it("reports duration and tokens rather than leaving them unknown", () => {
    const embed = data(buildFinalEmbed(job({ summary: "Nothing to do." }), "acme/web"));
    const run = embed.fields?.[0]?.value ?? "";
    expect(run).toContain("42s");
    expect(run).toContain("1000 in, 50 out");
    expect(run).toContain("gpt-5-mini");
    // A price is never invented for a model with no recorded cost.
    expect(run).toContain("Cost: unknown");
  });

  it("truncates an answer that would exceed the Discord embed limit", () => {
    const embed = data(buildFinalEmbed(job({ summary: "x".repeat(9000) }), "acme/web"));
    expect((embed.description ?? "").length).toBeLessThanOrEqual(4096);
    expect(embed.description?.endsWith("…")).toBe(true);
  });

  it("links the pull request when there is one", () => {
    const embed = data(
      buildFinalEmbed(
        job({
          summary: "Replaced the typo.",
          prUrl: "https://github.com/acme/web/pull/7",
          prNumber: 7,
          diffStat: {
            files: [{ path: "app/page.tsx", additions: 1, deletions: 1 }],
            totalAdditions: 1,
            totalDeletions: 1,
          } as unknown as Job["diffStat"],
        }),
        "acme/web",
      ),
    );

    expect(embed.title).toBe("Done");
    expect(embed.fields?.map((f) => f.name)).toEqual(["Pull request", "Files", "Run"]);
    expect(embed.fields?.[0]?.value).toContain("#7 on acme/web");
    expect(embed.fields?.[1]?.value).toContain("app/page.tsx");
  });

  it("describes a failure without pretending it produced something", () => {
    const embed = data(
      buildFinalEmbed(
        job({ status: JobStatus.failed, statusDetail: "The agent ran out of time." }),
        "acme/web",
      ),
    );

    expect(embed.title).toBe("Failed");
    expect(embed.description).toBe("The agent ran out of time.");
    expect(embed.fields?.map((f) => f.name)).toEqual(["Run"]);
  });

  it("shows progress while the job is still running", () => {
    const embed = data(buildRunningEmbed(job({ status: JobStatus.editing }), "Writing code"));
    expect(embed.title).toBe("Writing code");
    expect(embed.description).toContain("Writing code");
    // A progress line, not a wall of text.
    expect(embed.description?.split("\n")[0]).toMatch(/^[●◐○ ]+$/);
  });
});
