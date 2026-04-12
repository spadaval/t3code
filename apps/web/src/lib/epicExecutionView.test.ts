import type { BeadsCoordinatorEpicSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildEpicExecutionViewData } from "./epicExecutionView";

function makeIssue(id: string, title: string, priority: number | null = null) {
  return {
    id,
    title,
    description: null,
    notes: null,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2026-04-08T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-04-08T00:00:00.000Z",
    labels: [],
    parent: null,
    dependencyCount: 0,
    dependentCount: 0,
    commentCount: 0,
  } as const;
}

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1" as never,
  epicTitle: "Epic 1",
  issue: null,
  trackerLoadState: "ready",
  trackerLoadDetail: null,
  coordinationSupported: true,
  coordinationUnsupportedReason: null,
  validationState: "valid",
  validationErrors: [],
  trackerState: "not_started",
  progress: {
    totalIssueCount: 3,
    completedIssueCount: 0,
    readyIssueCount: 3,
    activeIssueCount: 0,
    blockedIssueCount: 0,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: 0,
    activeWorkerCount: 0,
    isComplete: false,
  },
  primaryAction: {
    kind: "start_epic_run",
    label: "Start run",
    busyLabel: "Starting...",
    disabled: false,
  },
  activeRunId: null,
  activeExecutionId: null,
  projectConflict: null,
  trackerSummary: null,
  validation: null,
  status: null,
  runs: [],
  executions: [],
};

describe("buildEpicExecutionViewData", () => {
  it("orders predictions deterministically from ready fronts", () => {
    const task1 = makeIssue("TASK-1", "First task", 1);
    const task2 = makeIssue("TASK-2", "Second task", 2);
    const task3 = makeIssue("TASK-3", "Third task", 3);

    const data = buildEpicExecutionViewData({
      ...BASE_EPIC,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        trackerSummary: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[task2, task1], [task3]],
        maxParallelism: 1,
        estimatedWorkerSessions: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        trackerSummary: null,
        completed: [],
        active: [],
        ready: [task2, task1],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      },
    });

    expect(data.predicted.map((item) => item.issueId)).toEqual(["TASK-1", "TASK-2", "TASK-3"]);
    expect(data.predicted.map((item) => item.waveIndex)).toEqual([0, 0, 1]);
  });

  it("separates the active execution from prediction and history lists", () => {
    const task1 = makeIssue("TASK-1", "First task", 1);
    const task2 = makeIssue("TASK-2", "Second task", 2);

    const data = buildEpicExecutionViewData({
      ...BASE_EPIC,
      activeExecutionId: "exec-2" as never,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        trackerSummary: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[task1, task2]],
        maxParallelism: 1,
        estimatedWorkerSessions: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        trackerSummary: null,
        completed: [],
        active: [task1],
        ready: [task2],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      },
      executions: [
        {
          executionId: "exec-1" as never,
          runId: "run-1" as never,
          issueId: "TASK-2",
          workerThreadId: null,
          sequenceNumber: 1,
          status: "failed",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: {
            kind: "worker_failure",
            message: "Worker crashed.",
            issueId: "TASK-2",
            executionId: "exec-1" as never,
            workerThreadId: null,
          },
          requestedAt: "2026-04-08T00:00:00.000Z",
          startedAt: "2026-04-08T00:00:01.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: "2026-04-08T00:00:02.000Z",
          updatedAt: "2026-04-08T00:00:02.000Z",
        },
        {
          executionId: "exec-2" as never,
          runId: "run-2" as never,
          issueId: "TASK-1",
          workerThreadId: "thread-1" as never,
          sequenceNumber: 2,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-04-08T00:00:03.000Z",
          startedAt: "2026-04-08T00:00:04.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: "2026-04-08T00:00:04.000Z",
        },
      ],
    });

    expect(data.activeExecution?.issueId).toBe("TASK-1");
    expect(data.predicted.map((item) => item.issueId)).toEqual(["TASK-2"]);
    expect(data.history).toHaveLength(1);
    expect(data.history[0]).toMatchObject({
      issueId: "TASK-2",
      title: "Second task",
      failureMessage: "Worker crashed.",
    });
  });
});
