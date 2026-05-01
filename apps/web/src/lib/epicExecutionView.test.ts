import type {
  BeadsCoordinatorEpicSnapshot,
  OrchestrationEpicIssueExecution,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildEpicChildExecutionRows, buildEpicExecutionViewData } from "./epicExecutionView";

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

function makeExecution(
  input: Pick<
    OrchestrationEpicIssueExecution,
    "executionId" | "issueId" | "sequenceNumber" | "status"
  > &
    Partial<OrchestrationEpicIssueExecution>,
): OrchestrationEpicIssueExecution {
  return {
    runId: "run-1" as never,
    workerThreadId: null,
    workspaceKey: "shared",
    workspacePath: null,
    failureContext:
      input.status === "failed"
        ? {
            kind: "worker_failure",
            message: "Worker crashed.",
            issueId: input.issueId,
            executionId: input.executionId,
            workerThreadId: input.workerThreadId ?? null,
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: input.status === "stopped" ? "2026-04-08T00:00:02.000Z" : null,
    completedAt: input.status === "completed" ? "2026-04-08T00:00:02.000Z" : null,
    failedAt: input.status === "failed" ? "2026-04-08T00:00:02.000Z" : null,
    updatedAt: "2026-04-08T00:00:02.000Z",
    ...input,
  };
}

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1" as never,
  epicTitle: "Epic 1",
  issue: null,
  coordinationLoadState: "ready",
  coordinationLoadDetail: null,
  validationState: "valid",
  validationErrors: [],
  coordinationState: "not_started",
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
  execution: {
    state: "ready",
    summary: "Epic is ready to launch.",
    blockingReason: null,
    nextIssue: null,
  },
  commands: [
    {
      kind: "start_epic_run",
      label: "Start run",
      busyLabel: "Starting...",
      disabled: false,
      disabledReason: null,
    },
  ],
  activeRunId: null,
  activeExecutionId: null,
  projectConflict: null,
  summary: null,
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
        summary: null,
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
        summary: null,
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
        summary: null,
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
        summary: null,
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

  it("orders child execution rows by active, predicted, completed, blocked, and unknown work", () => {
    const active = makeIssue("TASK-1", "Active task", 1);
    const readyLowPriority = makeIssue("TASK-2", "Ready low", 2);
    const readyHighPriority = makeIssue("TASK-3", "Ready high", 1);
    const completed = makeIssue("TASK-4", "Completed task", 4);
    const internalBlocked = makeIssue("TASK-5", "Internal blocked", 5);
    const externalBlocked = makeIssue("TASK-6", "External blocked", 6);
    const unknownBlocked = makeIssue("TASK-7", "Unknown blocked", 7);
    const unknown = makeIssue("TASK-8", "Unknown task", 8);

    const rows = buildEpicChildExecutionRows({
      epic: {
        ...BASE_EPIC,
        activeExecutionId: "exec-active" as never,
        validation: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          valid: true,
          errors: [],
          warnings: [],
          readyFronts: [[readyLowPriority, readyHighPriority]],
          maxParallelism: 1,
          estimatedWorkerSessions: 1,
        },
        status: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          completed: [completed],
          active: [active],
          ready: [readyLowPriority, readyHighPriority],
          blocked: [unknownBlocked, internalBlocked, externalBlocked],
          blockedBreakdown: {
            internal: [internalBlocked],
            external: [externalBlocked],
            unknown: [unknownBlocked],
          },
        },
        executions: [
          makeExecution({
            executionId: "exec-active" as never,
            issueId: active.id,
            sequenceNumber: 3,
            status: "running",
            workerThreadId: "thread-active" as never,
          }),
          makeExecution({
            executionId: "exec-completed" as never,
            issueId: completed.id,
            sequenceNumber: 2,
            status: "completed",
          }),
        ],
      },
      children: [
        unknown,
        unknownBlocked,
        externalBlocked,
        internalBlocked,
        completed,
        readyLowPriority,
        readyHighPriority,
        active,
      ],
    });

    expect(rows.map((row) => row.child.id)).toEqual([
      "TASK-1",
      "TASK-3",
      "TASK-2",
      "TASK-4",
      "TASK-5",
      "TASK-6",
      "TASK-7",
      "TASK-8",
    ]);
    expect(rows.map((row) => row.execution.kind)).toEqual([
      "active",
      "next",
      "ready",
      "completed",
      "blocked",
      "blocked",
      "blocked",
      "unknown",
    ]);
    expect(
      rows
        .filter((row) => row.execution.kind === "blocked")
        .map((row) => [row.child.id, row.execution.blockedScope]),
    ).toEqual([
      ["TASK-5", "internal"],
      ["TASK-6", "external"],
      ["TASK-7", "unknown"],
    ]);
    expect(rows.filter((row) => row.execution.isNext)).toHaveLength(1);
    expect(rows.find((row) => row.child.id === "TASK-1")?.execution.workerThreadId).toBe(
      "thread-active",
    );
  });

  it("keeps failed children visible with their failure message", () => {
    const failed = makeIssue("TASK-1", "Failed task", 1);
    const ready = makeIssue("TASK-2", "Ready task", 2);

    const rows = buildEpicChildExecutionRows({
      epic: {
        ...BASE_EPIC,
        status: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          completed: [],
          active: [],
          ready: [ready],
          blocked: [failed],
          blockedBreakdown: { internal: [failed], external: [], unknown: [] },
        },
        executions: [
          makeExecution({
            executionId: "exec-failed" as never,
            issueId: failed.id,
            sequenceNumber: 1,
            status: "failed",
          }),
        ],
      },
      children: [failed, ready],
    });

    expect(rows.map((row) => row.child.id)).toEqual(["TASK-2", "TASK-1"]);
    expect(rows[0]?.execution.kind).toBe("next");
    expect(rows[1]?.execution).toMatchObject({
      kind: "failed",
      label: "Failed",
      failureMessage: "Worker crashed.",
    });
  });

  it("does not mark closed children as next even if validation still reports them ready", () => {
    const closed = makeIssue("TASK-1", "Closed task", 1);
    const ready = makeIssue("TASK-2", "Ready task", 2);

    const rows = buildEpicChildExecutionRows({
      epic: {
        ...BASE_EPIC,
        validation: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          valid: true,
          errors: [],
          warnings: [],
          readyFronts: [[closed, ready]],
          maxParallelism: 1,
          estimatedWorkerSessions: 1,
        },
        status: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          completed: [],
          active: [],
          ready: [closed, ready],
          blocked: [],
          blockedBreakdown: { internal: [], external: [], unknown: [] },
        },
      },
      children: [{ ...closed, status: "closed" }, ready],
    });

    expect(rows.map((row) => [row.child.id, row.execution.kind, row.execution.isNext])).toEqual([
      ["TASK-2", "next", true],
      ["TASK-1", "unknown", false],
    ]);
  });
});
