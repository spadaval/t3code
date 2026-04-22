// @ts-nocheck
import { ProjectId, EpicRunId, type OrchestrationEpicRun } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildCoordinatorEpicSnapshot } from "./coordinatorSnapshots";

const SWARM_SUPPORT = {
  supported: true,
  reason: null,
  backend: {
    kind: "dolt",
    doltMode: null,
    database: null,
    projectId: null,
    role: null,
    bdVersion: null,
  },
} as const;

function makeSwarmRun(overrides: Partial<OrchestrationEpicRun> = {}): OrchestrationEpicRun {
  return {
    runId: EpicRunId.makeUnsafe("run-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    epicIssueId: "EPIC-1",
    status: "running",
    provider: "codex",
    model: "gpt-5.4-mini",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: "buffered",
    runtimeMode: "full-access",
    failureContext: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:01:00.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: "2026-01-01T00:02:00.000Z",
    ...overrides,
  } satisfies OrchestrationEpicRun;
}

describe("buildCoordinatorEpicSnapshot", () => {
  it("keeps tracker state separate from terminal run history", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "boom",
        issueId: null,
        executionId: null,
        workerThreadId: null,
      },
      failedAt: "2026-01-01T00:02:00.000Z",
    });
    const trackerSummary = {
      trackerId: "swarm-1",
      epicId: "EPIC-1",
      epicTitle: "Epic",
      totalIssueCount: 3,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 1,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    const snapshot = buildCoordinatorEpicSnapshot({
      issue: null,
      support: SWARM_SUPPORT,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        valid: true,
        trackerSummary: trackerSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        trackerSummary: trackerSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
        blockedBreakdown: {
          internal: [],
          external: [],
          unknown: [],
        },
      },
      validationError: null,
      statusError: null,
      projectEpicRuns: [failedRun],
      epicRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.validationState).toBe("valid");
    expect(snapshot.coordinationState).toBe("not_started");
    expect(snapshot.runs[0]?.status).toBe("failed");
    expect(snapshot.activeRunId).toBeNull();
    expect(snapshot.primaryAction).toEqual({
      kind: "start_epic_run",
      label: "Start run",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("surfaces invalid tracker state separately from run history", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "boom",
        issueId: null,
        executionId: null,
        workerThreadId: null,
      },
      failedAt: "2026-01-01T00:02:00.000Z",
    });
    const trackerSummary = {
      trackerId: "swarm-1",
      epicId: "EPIC-1",
      epicTitle: "Epic",
      totalIssueCount: 3,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 1,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
    };

    const snapshot = buildCoordinatorEpicSnapshot({
      issue: null,
      support: SWARM_SUPPORT,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        valid: false,
        trackerSummary: trackerSummary,
        errors: ["broken"],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        trackerSummary: trackerSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
        blockedBreakdown: {
          internal: [],
          external: [],
          unknown: [],
        },
      },
      validationError: null,
      statusError: null,
      projectEpicRuns: [failedRun],
      epicRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.validationState).toBe("invalid");
    expect(snapshot.validationErrors).toEqual(["broken"]);
    expect(snapshot.primaryAction).toEqual({
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("preserves backend error detail when validation and status lookups fail", () => {
    const snapshot = buildCoordinatorEpicSnapshot({
      issue: null,
      support: SWARM_SUPPORT,
      validation: null,
      status: null,
      validationError: "Issue 'EPIC-404' was not found.",
      statusError: "Issue 'EPIC-404' was not found.",
      projectEpicRuns: [],
      epicRuns: [],
      epicExecutions: [],
      fallbackEpicId: "EPIC-404",
      fallbackEpicTitle: "Missing epic",
    });

    expect(snapshot.coordinationLoadState).toBe("error");
    expect(snapshot.coordinationLoadDetail).toBe(
      "Epic validation and coordination status request failed: Issue 'EPIC-404' was not found.",
    );
  });

  it("offers restart for worker-failure runs when a fresh ready issue exists", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "Worker crashed",
        issueId: "TASK-1",
        executionId: "exec-1" as never,
        workerThreadId: "thread-1" as never,
      },
      failedAt: "2026-01-01T00:02:00.000Z",
    });

    const snapshot = buildCoordinatorEpicSnapshot({
      issue: null,
      support: SWARM_SUPPORT,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        valid: true,
        trackerSummary: null,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        trackerSummary: null,
        completed: [],
        active: [],
        ready: [
          {
            id: "TASK-2",
            title: "Task 2",
            status: "open",
            priority: 2,
            issueType: "task",
            assignee: null,
            owner: null,
            parent: null,
          },
        ],
        blocked: [],
        blockedBreakdown: {
          internal: [],
          external: [],
          unknown: [],
        },
      },
      validationError: null,
      statusError: null,
      projectEpicRuns: [failedRun],
      epicRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.primaryAction).toEqual({
      kind: "start_epic_run",
      label: "Start run",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("keeps external tracker blockers as coordinator-open actions instead of continue", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "Waiting on external dependency",
        issueId: null,
        executionId: null,
        workerThreadId: null,
      },
      failedAt: "2026-01-01T00:02:00.000Z",
    });

    const snapshot = buildCoordinatorEpicSnapshot({
      issue: null,
      support: SWARM_SUPPORT,
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        valid: true,
        trackerSummary: null,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        trackerSummary: null,
        completed: [],
        active: [],
        ready: [],
        blocked: [
          {
            id: "TASK-9",
            title: "Task 9",
            status: "blocked",
            priority: 9,
            issueType: "task",
            assignee: null,
            owner: null,
            parent: null,
          },
        ],
        blockedBreakdown: {
          internal: [],
          external: [
            {
              id: "TASK-9",
              title: "Task 9",
              status: "blocked",
              priority: 9,
              issueType: "task",
              assignee: null,
              owner: null,
              parent: null,
            },
          ],
          unknown: [],
        },
      },
      validationError: null,
      statusError: null,
      projectEpicRuns: [failedRun],
      epicRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.primaryAction).toEqual({
      kind: "open_coordinator",
      label: "Open epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });
});
