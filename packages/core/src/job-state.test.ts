import { JobStatus } from "@hifi/db";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_STATUSES,
  assertTransition,
  canTransition,
  isTerminal,
  JOB_TRANSITIONS,
  occupiesSlot,
  STATUS_LABELS,
  TERMINAL_STATUSES,
} from "./job-state.js";

const ALL_STATUSES = Object.values(JobStatus);

describe("job state machine", () => {
  it("covers every status in the transition table and the label table", () => {
    for (const status of ALL_STATUSES) {
      expect(JOB_TRANSITIONS[status]).toBeDefined();
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("walks the happy path", () => {
    const path: JobStatus[] = [
      JobStatus.queued,
      JobStatus.claimed,
      JobStatus.preparing,
      JobStatus.planning,
      JobStatus.editing,
      JobStatus.testing,
      JobStatus.capturing,
      JobStatus.pushing,
      JobStatus.reporting,
      JobStatus.succeeded,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i] as JobStatus, path[i + 1] as JobStatus)).toBe(true);
    }
  });

  it("lets a repo with no tests skip testing", () => {
    expect(canTransition(JobStatus.editing, JobStatus.capturing)).toBe(true);
    expect(canTransition(JobStatus.editing, JobStatus.pushing)).toBe(true);
  });

  it("allows exactly one loop back for test repair", () => {
    expect(canTransition(JobStatus.testing, JobStatus.editing)).toBe(true);
  });

  it("parks and resumes a clarification", () => {
    expect(canTransition(JobStatus.planning, JobStatus.waiting_input)).toBe(true);
    expect(canTransition(JobStatus.waiting_input, JobStatus.planning)).toBe(true);
  });

  it("treats terminal statuses as absorbing", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true);
      expect(JOB_TRANSITIONS[status]).toHaveLength(0);
      for (const next of ALL_STATUSES) {
        expect(canTransition(status, next)).toBe(false);
      }
    }
  });

  it("refuses to skip the pull request step", () => {
    expect(canTransition(JobStatus.editing, JobStatus.succeeded)).toBe(false);
    expect(canTransition(JobStatus.queued, JobStatus.reporting)).toBe(false);
    expect(() => assertTransition(JobStatus.queued, JobStatus.succeeded)).toThrow(
      /Illegal job transition/,
    );
  });

  it("can always be cancelled or timed out before it is terminal", () => {
    for (const status of ALL_STATUSES) {
      if (isTerminal(status) || status === JobStatus.reporting) continue;
      expect(canTransition(status, JobStatus.cancelled)).toBe(true);
      if (status !== JobStatus.queued) {
        expect(canTransition(status, JobStatus.timed_out)).toBe(true);
      }
    }
  });

  it("counts only running statuses against the concurrency limit", () => {
    expect(occupiesSlot(JobStatus.editing)).toBe(true);
    // A parked job releases its slot: that is why resuming re-runs from planning.
    expect(occupiesSlot(JobStatus.waiting_input)).toBe(false);
    expect(occupiesSlot(JobStatus.queued)).toBe(false);
    for (const status of TERMINAL_STATUSES) {
      expect(ACTIVE_STATUSES).not.toContain(status);
    }
  });
});
