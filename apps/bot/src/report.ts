import { STATUS_LABELS, type DiffStat } from "@hifi/core";
import { JobStatus, type Job } from "@hifi/db";
import { EmbedBuilder } from "discord.js";

/**
 * One status message per job, edited in place. Never a new message per
 * transition: a thread that fills with progress lines is noise, and the brief
 * asks for the message to change rather than repeat.
 */

const COLOUR_RUNNING = 0x5865f2;
const COLOUR_DONE = 0x57f287;
const COLOUR_FAILED = 0xed4245;
const COLOUR_STOPPED = 0xfee75c;

/** Discord caps an embed description at 4096 characters. */
const SUMMARY_MAX = 3500;

const RUNNING_STEPS: JobStatus[] = [
  JobStatus.queued,
  JobStatus.preparing,
  JobStatus.planning,
  JobStatus.editing,
  JobStatus.pushing,
  JobStatus.reporting,
];

function progressLine(status: JobStatus): string {
  const reached = RUNNING_STEPS.indexOf(status);
  return RUNNING_STEPS.map((step, i) => {
    if (reached < 0) return "·";
    if (i < reached) return "●";
    if (i === reached) return "◐";
    return "○";
  }).join(" ");
}

function colourFor(status: JobStatus): number {
  if (status === JobStatus.succeeded) return COLOUR_DONE;
  if (status === JobStatus.failed) return COLOUR_FAILED;
  if (status === JobStatus.cancelled || status === JobStatus.timed_out) return COLOUR_STOPPED;
  return COLOUR_RUNNING;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "unknown";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function buildRunningEmbed(job: Job, detail?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(colourFor(job.status))
    .setTitle(STATUS_LABELS[job.status])
    .setDescription(
      [
        progressLine(job.status),
        "",
        detail ?? job.statusDetail ?? "Working on it.",
      ].join("\n"),
    )
    .setFooter({ text: `HiFi · ${job.id}` });
}

export function buildFinalEmbed(job: Job, repoFullName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(colourFor(job.status))
    .setFooter({ text: `HiFi · ${job.id}` });

  if (job.status !== JobStatus.succeeded) {
    return embed
      .setTitle(STATUS_LABELS[job.status])
      .setDescription(job.statusDetail ?? "The job did not finish.")
      .addFields({
        name: "Run",
        value: runField(job),
      });
  }

  // Succeeded with nothing to push: a question answered, or a change that
  // turned out to be unnecessary. The agent's own words are the whole result,
  // so they get the description rather than a one-line status.
  if (!job.prUrl) {
    return embed
      .setTitle("No change needed")
      .setDescription(truncate(job.summary ?? "The agent made no changes.", SUMMARY_MAX))
      .addFields({ name: "Run", value: runField(job) });
  }

  const stat = job.diffStat as unknown as DiffStat | null;
  const files =
    stat && stat.files.length > 0
      ? stat.files
          .slice(0, 10)
          .map((f) => `\`${f.path}\` +${f.additions} −${f.deletions}`)
          .join("\n") + (stat.files.length > 10 ? `\n…and ${stat.files.length - 10} more` : "")
      : "None recorded.";

  return embed
    .setTitle("Done")
    .setURL(job.prUrl ?? null)
    .setDescription(truncate(job.summary ?? "The change is ready to review.", 600))
    .addFields(
      {
        name: "Pull request",
        value: job.prUrl ? `[#${job.prNumber} on ${repoFullName}](${job.prUrl})` : "None",
      },
      { name: "Files", value: truncate(files, 1000) },
      { name: "Run", value: runField(job) },
    );
}

function runField(job: Job): string {
  return [
    `Model: \`${modelOf(job)}\``,
    `Tokens: ${job.tokensIn} in, ${job.tokensOut} out`,
    // No price is recorded for the development model, and a guessed cost is
    // worse than an honest gap. ADR-006.
    "Cost: unknown",
    `Duration: ${formatDuration(job.durationMs)}`,
  ].join("\n");
}

function modelOf(job: Job): string {
  const selection = job.modelSelection as unknown as { model?: string } | null;
  return selection?.model ?? "unknown";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
