import type { OrchestrationEpicIssueExecution, OrchestrationEpicRun } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  compareRunsByRecency,
  deriveProgressFromExecutions,
  executionStatusBadgeVariant,
  formatDuration,
  formatExecutionStatus,
  formatRunStatus,
  getActiveRun,
  getLatestRun,
  runStatusBadgeVariant,
  shouldCollapseRunByDefault,
  shouldCollapseRunHistoryByDefault,
  summarizeExecution,
  summarizeRun,
} from "./epicRunPresentation";

function makeRun(
  runId: string,
  status: OrchestrationEpicRun["status"],
  overrides: Partial<OrchestrationEpicRun> = {},
): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status,
    provider: "codex" as never,
    model: "gpt-5.4",
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
    completedAt: null,
    updatedAt: "2026-04-08T00:00:05.000Z",
    ...overrides,
  };
}

function makeExecution(
  executionId: string,
  issueId: string,
  status: OrchestrationEpicIssueExecution["status"],
  overrides: Partial<OrchestrationEpicIssueExecution> = {},
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: "run-1" as never,
    issueId,
    workerThreadId: null,
    sequenceNumber: 1,
    status,
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    updatedAt: "2026-04-08T00:00:05.000Z",
    ...overrides,
  };
}

describe("epicRunPresentation", () => {
  it("formats statuses and badge variants consistently", () => {
    expect(formatRunStatus("pending")).toBe("Pending");
    expect(formatExecutionStatus("launching")).toBe("Launching");
    expect(runStatusBadgeVariant("running")).toBe("info");
    expect(runStatusBadgeVariant("pending")).toBe("secondary");
    expect(executionStatusBadgeVariant("running")).toBe("info");
    expect(executionStatusBadgeVariant("launching")).toBe("secondary");
  });

  it("orders runs by recency and resolves active/latest runs", () => {
    const older = makeRun("run-older", "completed", {
      requestedAt: "2026-04-08T00:00:00.000Z",
      updatedAt: "2026-04-08T00:01:00.000Z",
    });
    const newer = makeRun("run-newer", "failed", {
      requestedAt: "2026-04-08T00:02:00.000Z",
      updatedAt: "2026-04-08T00:03:00.000Z",
      failureContext: {
        kind: "worker_failure",
        issueId: "ISSUE-1",
        executionId: null,
        workerThreadId: null,
        message: "boom",
      },
    });
    const active = makeRun("run-active", "running", {
      requestedAt: "2026-04-08T00:04:00.000Z",
      updatedAt: "2026-04-08T00:05:00.000Z",
    });

    expect(compareRunsByRecency(active, newer)).toBeLessThan(0);
    expect(getLatestRun([older, active, newer])?.runId).toBe("run-active");
    expect(getActiveRun({ runs: [older, newer, active] })?.runId).toBe("run-active");
    expect(getActiveRun({ runs: [older, active], activeRunId: "run-older" as never })?.runId).toBe(
      "run-older",
    );
  });

  it("derives run and execution summaries for shared presentation", () => {
    expect(
      summarizeRun({
        run: makeRun("run-1", "running"),
        progress: {
          activeWorkerCount: 2,
          activeIssueCount: 2,
          completedIssueCount: 1,
          totalIssueCount: 4,
        },
      }),
    ).toBe("2 workers active");

    expect(
      summarizeRun({
        run: makeRun("run-2", "failed", {
          failureContext: {
            kind: "worker_failure",
            issueId: "ISSUE-1",
            executionId: null,
            workerThreadId: null,
            message: "Worker crashed",
          },
        }),
        progress: {
          activeWorkerCount: 0,
          activeIssueCount: 0,
          completedIssueCount: 1,
          totalIssueCount: 4,
        },
      }),
    ).toBe("Worker crashed");

    expect(
      summarizeExecution(
        makeExecution("exec-1", "ISSUE-1", "completed", {
          completedAt: "2026-04-08T00:00:10.000Z",
        }),
      ),
    ).toBe("Completed in 9.0s");

    expect(
      summarizeExecution(
        makeExecution("exec-2", "ISSUE-2", "failed", {
          failedAt: "2026-04-08T00:00:04.000Z",
          failureContext: {
            kind: "worker_failure",
            issueId: "ISSUE-2",
            executionId: "exec-2" as never,
            workerThreadId: null,
            message: "Agent crashed",
          },
        }),
      ),
    ).toBe("Agent crashed");
  });

  it("derives progress from latest execution per issue", () => {
    const progress = deriveProgressFromExecutions({
      executions: [
        makeExecution("exec-1", "ISSUE-1", "running", {
          sequenceNumber: 1,
          updatedAt: "2026-04-08T00:00:05.000Z",
        }),
        makeExecution("exec-2", "ISSUE-1", "completed", {
          sequenceNumber: 2,
          updatedAt: "2026-04-08T00:00:10.000Z",
          completedAt: "2026-04-08T00:00:10.000Z",
        }),
        makeExecution("exec-3", "ISSUE-2", "failed", {
          sequenceNumber: 1,
          failedAt: "2026-04-08T00:00:03.000Z",
          failureContext: {
            kind: "worker_failure",
            issueId: "ISSUE-2",
            executionId: "exec-3" as never,
            workerThreadId: null,
            message: "boom",
          },
        }),
      ],
    });

    expect(progress).toMatchObject({
      totalIssueCount: 2,
      completedIssueCount: 1,
      activeIssueCount: 0,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
      isComplete: false,
    });
  });

  it("applies collapse defaults to historical terminal runs", () => {
    expect(shouldCollapseRunByDefault(makeRun("run-1", "completed"))).toBe(true);
    expect(shouldCollapseRunByDefault(makeRun("run-2", "running"))).toBe(false);
    expect(
      shouldCollapseRunHistoryByDefault({
        runs: [makeRun("run-1", "completed"), makeRun("run-2", "failed")],
      }),
    ).toBe(true);
    expect(
      shouldCollapseRunHistoryByDefault({
        runs: [makeRun("run-1", "completed"), makeRun("run-2", "running")],
      }),
    ).toBe(false);
  });

  it("formats durations predictably", () => {
    expect(formatDuration("2026-04-08T00:00:01.000Z", "2026-04-08T00:00:10.000Z")).toBe("9.0s");
  });
});
