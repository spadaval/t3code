import type { OrchestrationSwarmRun, OrchestrationSwarmTaskExecution } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveCoordinatorEventLog } from "./coordinatorEventLog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RUN: OrchestrationSwarmRun = {
  runId: "run-1" as never,
  projectId: "project-1" as never,
  epicIssueId: "EPIC-1",
  status: "completed",
  schedulerMode: "semi-automatic",
  workspaceMode: "shared",
  provider: "codex",
  model: "gpt-5",
  modelOptions: null,
  providerOptions: null,
  assistantDeliveryMode: null,
  runtimeMode: "full-access",
  lastError: null,
  requestedAt: "2026-04-08T00:00:00.000Z",
  startedAt: "2026-04-08T00:00:01.000Z",
  idledAt: null,
  pausedAt: null,
  blockedAt: null,
  blockedContext: null,
  failedAt: null,
  cancelledAt: null,
  completedAt: "2026-04-08T00:05:00.000Z",
  updatedAt: "2026-04-08T00:05:00.000Z",
};

const BASE_EXECUTION: OrchestrationSwarmTaskExecution = {
  executionId: "exec-1" as never,
  runId: "run-1" as never,
  issueId: "ISSUE-A",
  workerThreadId: "thread-1" as never,
  sequenceNumber: 1,
  status: "completed",
  originalStatus: "open",
  originalAssignee: null,
  lastError: null,
  requestedAt: "2026-04-08T00:00:02.000Z",
  startedAt: "2026-04-08T00:00:03.000Z",
  completedAt: "2026-04-08T00:02:00.000Z",
  failedAt: null,
  cancelledAt: null,
  updatedAt: "2026-04-08T00:02:00.000Z",
};

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

  it("includes scheduler mode in requested entry", () => {
    const entries = deriveCoordinatorEventLog([BASE_RUN], []);
    const requested = entries.find((e) => e.kind === "run.requested");
    expect(requested?.summary).toContain("semi-automatic");
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

  it("produces error-toned entries for blocked runs", () => {
    const blockedRun: OrchestrationSwarmRun = {
      ...BASE_RUN,
      status: "blocked",
      completedAt: null,
      blockedAt: "2026-04-08T00:03:00.000Z",
      blockedContext: {
        kind: "worker_failure",
        issueId: "ISSUE-A",
        executionId: "exec-1" as never,
        workerThreadId: "thread-1" as never,
      },
      lastError: "Worker process crashed",
    };
    const entries = deriveCoordinatorEventLog([blockedRun], []);
    const blocked = entries.find((e) => e.kind === "run.blocked");
    expect(blocked?.tone).toBe("error");
    expect(blocked?.detail).toBe("Worker process crashed");
    expect(blocked?.summary).toContain("Worker failed");
  });

  it("produces error-toned entries for failed executions", () => {
    const failedExec: OrchestrationSwarmTaskExecution = {
      ...BASE_EXECUTION,
      status: "failed",
      completedAt: null,
      failedAt: "2026-04-08T00:02:00.000Z",
      lastError: "Issue not closed after turn",
    };
    const entries = deriveCoordinatorEventLog([], [failedExec]);
    const failed = entries.find((e) => e.kind === "execution.failed");
    expect(failed?.tone).toBe("error");
    expect(failed?.detail).toBe("Issue not closed after turn");
  });

  it("produces warning-toned entries for cancelled runs", () => {
    const cancelledRun: OrchestrationSwarmRun = {
      ...BASE_RUN,
      status: "cancelled",
      completedAt: null,
      cancelledAt: "2026-04-08T00:03:00.000Z",
    };
    const entries = deriveCoordinatorEventLog([cancelledRun], []);
    const cancelled = entries.find((e) => e.kind === "run.cancelled");
    expect(cancelled?.tone).toBe("warning");
  });

  it("handles multiple runs and executions", () => {
    const run2: OrchestrationSwarmRun = {
      ...BASE_RUN,
      runId: "run-2" as never,
      requestedAt: "2026-04-08T01:00:00.000Z",
      startedAt: "2026-04-08T01:00:01.000Z",
      completedAt: "2026-04-08T01:05:00.000Z",
      updatedAt: "2026-04-08T01:05:00.000Z",
    };
    const exec2: OrchestrationSwarmTaskExecution = {
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
    const requestedOnlyRun: OrchestrationSwarmRun = {
      ...BASE_RUN,
      status: "requested",
      startedAt: null,
      completedAt: null,
    };
    const entries = deriveCoordinatorEventLog([requestedOnlyRun], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("run.requested");
  });
});
