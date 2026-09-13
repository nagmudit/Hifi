import { z } from "zod";

/**
 * Zod lives at every trust boundary. This file holds the internal boundaries
 * (queue payloads); inbound webhook and Discord payload schemas live with the
 * app that receives them.
 */

/** Discord snowflakes are numeric strings; they are never safe as JS numbers. */
export const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "not a Discord snowflake");

export const attachmentRef = z.object({
  /** R2 object key. The Discord CDN URL is never persisted: it expires. */
  key: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type AttachmentRef = z.infer<typeof attachmentRef>;

/** The only thing that crosses the queue. Everything else is read from the DB. */
export const jobQueuePayload = z.object({
  jobId: z.string().min(1),
  tenantId: z.string().min(1),
  /** Incremented on retry; the worker uses it to escalate the model tier. */
  attempt: z.number().int().nonnegative().default(0),
  /** Set when resuming a job that was parked in waiting_input. */
  resume: z
    .object({
      answer: z.string().min(1),
      answeredByUserId: z.string().min(1),
    })
    .optional(),
});
export type JobQueuePayload = z.infer<typeof jobQueuePayload>;

export const testSummary = z.object({
  passed: z.number().int().nonnegative().nullable(),
  failed: z.number().int().nonnegative().nullable(),
  skipped: z.number().int().nonnegative().nullable(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  /** Truncated before storage. Full output goes to R2. */
  output: z.string(),
  command: z.string(),
});
export type TestSummary = z.infer<typeof testSummary>;

export const diffStat = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    }),
  ),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
});
export type DiffStat = z.infer<typeof diffStat>;

/** Inputs to model routing, persisted so a decision can be replayed later. */
export const taskSignals = z.object({
  hasImages: z.boolean(),
  promptChars: z.number().int().nonnegative(),
  promptWords: z.number().int().nonnegative(),
  repoFileCount: z.number().int().nonnegative().nullable(),
  isRetry: z.boolean(),
  looksMechanical: z.boolean(),
});
export type TaskSignals = z.infer<typeof taskSignals>;

export const modelSelection = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  tier: z.enum(["cheap", "mid", "frontier"]),
  reason: z.string(),
});
export type ModelSelection = z.infer<typeof modelSelection>;
