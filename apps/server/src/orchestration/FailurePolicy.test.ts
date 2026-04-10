import { describe, expect, it } from "vitest";

import {
  describeIssueNotClosedForCompletedExecution,
  describeRequestedExecutionTimeout,
  isRequestedExecutionTimedOut,
  truncateSwarmFailureDetail,
} from "./FailurePolicy.ts";

describe("FailurePolicy", () => {
  it("treats invalid requestedAt timestamps as timed out", () => {
    expect(
      isRequestedExecutionTimedOut({
        requestedAt: "not-a-date",
        nowMs: 10_000,
        timeoutMs: 5_000,
      }),
    ).toBe(true);
  });

  it("describes launch timeout with the observed state and duration", () => {
    expect(
      describeRequestedExecutionTimeout({
        executionId: "exec-1" as never,
        issueId: "TASK-1",
        workerThreadId: "thread-1" as never,
        sessionStatus: "idle",
        latestTurnState: null,
        timeoutSeconds: 60,
      }),
    ).toContain("within 60 seconds");
  });

  it("keeps the worker and issue identifiers in incomplete completion failures", () => {
    expect(
      describeIssueNotClosedForCompletedExecution({
        issueId: "TASK-1",
        currentStatus: "open",
        workerThreadId: "thread-1" as never,
      }),
    ).toContain("Worker thread 'thread-1' completed, but issue 'TASK-1' is still 'open'.");
  });

  it("truncates failure detail without losing the prefix", () => {
    expect(truncateSwarmFailureDetail("abcdef", 5)).toBe("ab...");
  });
});
