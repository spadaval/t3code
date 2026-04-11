import type { OrchestrationEpicRun, OrchestrationEpicIssueExecution } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveCoordinatorEventLog } from "./coordinatorEventLog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RUN = {
  runId: "run-1" as never,
  projectId: "project-1" as never,
  epicIssueId: "EPIC-1",
  status: "completed",
  provider: "codex",
  model: "gpt-5",
  modelOptions: null,
  providerOptions: null,
  assistantDeliveryMode: null,
  runtimeMode: "full-access",
  failureContext: null,
  requestedAt: "2026-04-08T00:00:00.000Z",
  startedAt: "2026-04-08T00:00:01.000Z",
  stopRequestedAt: null,
  stoppedAt: null,
  failedAt: null,
  completedAt: "2026-04-08T00:05:00.000Z",
  updatedAt: "2026-04-08T00:05:00.000Z",
} as unknown as OrchestrationEpicRun;

const BASE_EXECUTION = {
  executionId: "exec-1" as never,
  runId: "run-1" as never,
  issueId: "ISSUE-A",
  workerThreadId: "thread-1" as never,
  sequenceNumber: 1,
  status: "completed",
  workspaceKey: "shared",
  workspacePath: null,
  failureContext: null,
  requestedAt: "2026-04-08T00:00:02.000Z",
  startedAt: "2026-04-08T00:00:03.000Z",
  stopRequestedAt: null,
  stoppedAt: null,
  completedAt: "2026-04-08T00:02:00.000Z",
  failedAt: null,
  updatedAt: "2026-04-08T00:02:00.000Z",
} as unknown as OrchestrationEpicIssueExecution;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveCoordinatorEventLog", () => {
  it("returns empty array for no runs or executions", () => {
    expect(deriveCoordinatorEventLog([], [])).toEqual([]);
  });

  it("derives run lifecycle entries", () => {
    const entries = deriveCoordinatorEventLog([BASE_RUN], []);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("run.requested");
    expect(kinds).toContain("run.started");
    expect(kinds).toContain("run.completed");
  });

  it("uses a simple requested summary", () => {
    const entries = deriveCoordinatorEventLog([BASE_RUN], []);
    const requested = entries.find((e) => e.kind === "run.requested");
    expect(requested?.summary).toBe("Run requested");
  });

  it("includes duration in completed entry", () => {
    const entries = deriveCoordinatorEventLog([BASE_RUN], []);
    const completed = entries.find((e) => e.kind === "run.completed");
    expect(completed?.summary).toContain("4m 59s");
  });

  it("derives execution lifecycle entries", () => {
    const entries = deriveCoordinatorEventLog([], [BASE_EXECUTION]);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("execution.requested");
    expect(kinds).toContain("execution.started");
    expect(kinds).toContain("execution.completed");
  });

  it("includes issue ID and sequence number in execution entries", () => {
    const entries = deriveCoordinatorEventLog([], [BASE_EXECUTION]);
    const started = entries.find((e) => e.kind === "execution.started");
    expect(started?.summary).toContain("ISSUE-A");
    expect(started?.summary).toContain("#1");
    expect(started?.issueId).toBe("ISSUE-A");
    expect(started?.workerThreadId).toBe("thread-1");
  });

  it("sorts entries chronologically", () => {
    const entries = deriveCoordinatorEventLog([BASE_RUN], [BASE_EXECUTION]);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.timestamp >= entries[i - 1]!.timestamp).toBe(true);
    }
  });

  it("produces error-toned entries for failed runs", () => {
    const blockedRun: OrchestrationEpicRun = {
      ...BASE_RUN,
      status: "failed",
      completedAt: null,
      failedAt: "2026-04-08T00:03:00.000Z",
      failureContext: {
        kind: "worker_failure",
        message: "Worker process crashed",
        issueId: "ISSUE-A",
        executionId: "exec-1" as never,
        workerThreadId: "thread-1" as never,
      },
    } as unknown as OrchestrationEpicRun;
    const entries = deriveCoordinatorEventLog([blockedRun], []);
    const blocked = entries.find((e) => e.kind === "run.failed");
    expect(blocked?.tone).toBe("error");
    expect(blocked?.detail).toBe("Worker process crashed");
    expect(blocked?.summary).toContain("Run failed");
  });

  it("produces error-toned entries for failed executions", () => {
    const failedExec: OrchestrationEpicIssueExecution = {
      ...BASE_EXECUTION,
      status: "failed",
      completedAt: null,
      failedAt: "2026-04-08T00:02:00.000Z",
      failureContext: {
        kind: "issue_incomplete",
        message: "Issue not closed after turn",
        issueId: "ISSUE-A",
        executionId: "exec-1" as never,
        workerThreadId: "thread-1" as never,
      },
    } as unknown as OrchestrationEpicIssueExecution;
    const entries = deriveCoordinatorEventLog([], [failedExec]);
    const failed = entries.find((e) => e.kind === "execution.failed");
    expect(failed?.tone).toBe("error");
    expect(failed?.detail).toBe("Issue not closed after turn");
  });

  it("produces warning-toned entries for stopped runs", () => {
    const stoppedRun: OrchestrationEpicRun = {
      ...BASE_RUN,
      status: "stopped",
      completedAt: null,
      stoppedAt: "2026-04-08T00:03:00.000Z",
    } as unknown as OrchestrationEpicRun;
    const entries = deriveCoordinatorEventLog([stoppedRun], []);
    const stopped = entries.find((e) => e.kind === "run.stopped");
    expect(stopped?.tone).toBe("warning");
  });

  it("handles multiple runs and executions", () => {
    const run2: OrchestrationEpicRun = {
      ...BASE_RUN,
      runId: "run-2" as never,
      requestedAt: "2026-04-08T01:00:00.000Z",
      startedAt: "2026-04-08T01:00:01.000Z",
      completedAt: "2026-04-08T01:05:00.000Z",
      updatedAt: "2026-04-08T01:05:00.000Z",
    };
    const exec2: OrchestrationEpicIssueExecution = {
      ...BASE_EXECUTION,
      executionId: "exec-2" as never,
      runId: "run-2" as never,
      sequenceNumber: 2,
      requestedAt: "2026-04-08T01:00:02.000Z",
      startedAt: "2026-04-08T01:00:03.000Z",
      completedAt: "2026-04-08T01:02:00.000Z",
      updatedAt: "2026-04-08T01:02:00.000Z",
    };
    const entries = deriveCoordinatorEventLog([BASE_RUN, run2], [BASE_EXECUTION, exec2]);
    // Should have entries from both runs and both executions.
    expect(entries.filter((e) => e.runId === "run-1").length).toBeGreaterThan(0);
    expect(entries.filter((e) => e.runId === "run-2").length).toBeGreaterThan(0);
    expect(entries.filter((e) => e.executionId === "exec-1").length).toBeGreaterThan(0);
    expect(entries.filter((e) => e.executionId === "exec-2").length).toBeGreaterThan(0);
  });

  it("omits entries for null timestamps", () => {
    const requestedOnlyRun: OrchestrationEpicRun = {
      ...BASE_RUN,
      status: "pending",
      startedAt: null,
      completedAt: null,
    } as unknown as OrchestrationEpicRun;
    const entries = deriveCoordinatorEventLog([requestedOnlyRun], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("run.requested");
  });
});
