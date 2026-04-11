import {
  ProjectId,
  EpicRunId,
  ThreadId,
  type BeadsIssueSummary,
  type OrchestrationEpicRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  collectCoordinatorEpics,
  describeDisabledEpicCoordinatorAction,
  describeSharedWorkspaceProjectConflict,
  deriveCoordinatorFetchLifecycle,
  deriveEpicCoordinatorState,
  findConflictingSharedWorkspaceRun,
  findLatestTrackerRefinementPlan,
  getEpicCoordinatorPrimaryAction,
  isEpicIssueType,
  listEpicChildIssues,
  listEpicDescendantIssues,
  partitionCoordinatorEpics,
  partitionCoordinatorTrackerEpics,
  selectLatestEpicRun,
  type TrackerRefinementPlanCandidate,
} from "./issuePanel";

function makeIssue(
  overrides: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">,
) {
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    description: null,
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    labels: [],
    parent: null,
    ...rest,
  } satisfies BeadsIssueSummary;
}

function makeEpicRun(overrides: Record<string, unknown> = {}): OrchestrationEpicRun {
  return {
    runId: EpicRunId.makeUnsafe("run-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    epicIssueId: "EPIC-1",
    status: "running",
    provider: "codex",
    model: "gpt-5.4-mini",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
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
  } as unknown as OrchestrationEpicRun;
}

const READY_FETCH_LIFECYCLE = {
  kind: "ready",
  detail: null,
} as const;

const STALE_FETCH_LIFECYCLE = {
  kind: "stale",
  detail: "Showing the last known epic-run state while the latest refresh completes.",
} as const;

const TIMEOUT_FETCH_LIFECYCLE = {
  kind: "timeout",
  detail: "Epic validation and status request timed out: Beads command timed out.",
} as const;

describe("deriveCoordinatorFetchLifecycle", () => {
  it("returns loading while swarm support is still pending", () => {
    expect(
      deriveCoordinatorFetchLifecycle({
        support: { pending: true, hasData: false, error: null },
        requireTrackerState: false,
      }),
    ).toEqual({
      kind: "loading",
      detail: null,
    });
  });

  it("returns timeout for validation/status timeout failures without cached data", () => {
    expect(
      deriveCoordinatorFetchLifecycle({
        support: { pending: false, hasData: true, error: null },
        requireTrackerState: true,
        validation: { pending: false, hasData: false, error: "Beads command timed out." },
        status: { pending: false, hasData: false, error: "Beads command timed out." },
      }),
    ).toEqual(TIMEOUT_FETCH_LIFECYCLE);
  });

  it("returns stale when a refresh fails but cached swarm data still exists", () => {
    expect(
      deriveCoordinatorFetchLifecycle({
        support: { pending: false, hasData: true, error: null },
        requireTrackerState: true,
        validation: { pending: false, hasData: true, error: "backend exploded" },
        status: { pending: false, hasData: true, error: null },
      }),
    ).toEqual({
      kind: "stale",
      detail:
        "Showing the last known epic validation because the latest refresh failed: backend exploded",
    });
  });

  it("preserves distinct validation and status backend errors", () => {
    expect(
      deriveCoordinatorFetchLifecycle({
        support: { pending: false, hasData: true, error: null },
        requireTrackerState: true,
        validation: {
          pending: false,
          hasData: false,
          error: "Issue 'EPIC-404' was not found.",
        },
        status: {
          pending: false,
          hasData: false,
          error: "Swarm 'swarm-404' was not found.",
        },
      }),
    ).toEqual({
      kind: "error",
      detail:
        "Epic validation request failed: Issue 'EPIC-404' was not found. Tracker status request failed: Swarm 'swarm-404' was not found.",
    });
  });

  it("returns stale while a background refresh is pending over cached data", () => {
    expect(
      deriveCoordinatorFetchLifecycle({
        support: { pending: false, hasData: true, error: null },
        requireTrackerState: true,
        validation: { pending: true, hasData: true, error: null },
        status: { pending: false, hasData: true, error: null },
      }),
    ).toEqual(STALE_FETCH_LIFECYCLE);
  });
});

describe("listEpicChildIssues", () => {
  it("returns only children of the selected epic", () => {
    const issues = [
      makeIssue({
        id: "epic-1",
        title: "Epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-1", title: "Epic" },
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-2", title: "Other epic" },
      }),
    ];

    expect(listEpicChildIssues({ issues, epicId: "epic-1" })).toEqual([issues[1]]);
    expect(listEpicChildIssues({ issues, epicId: null })).toEqual([]);
  });
});

describe("listEpicDescendantIssues", () => {
  it("returns recursive descendants of the selected epic", () => {
    const issues = [
      makeIssue({
        id: "epic-1",
        title: "Epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "story-1",
        title: "Story 1",
        issueType: "feature",
        parent: { id: "epic-1", title: "Epic" },
      }),
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "story-1", title: "Story 1" },
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-1", title: "Epic" },
      }),
    ];

    expect(listEpicDescendantIssues({ issues, epicId: "epic-1" })).toEqual([
      issues[1],
      issues[2],
      issues[3],
    ]);
  });
});

describe("isEpicIssueType", () => {
  it("treats epic issue types case-insensitively", () => {
    expect(isEpicIssueType("epic")).toBe(true);
    expect(isEpicIssueType("Epic")).toBe(true);
    expect(isEpicIssueType("task")).toBe(false);
  });
});

describe("deriveEpicCoordinatorState", () => {
  it("returns checking while swarm support or validation is loading", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: null,
        status: null,
        validation: null,
        epicRuns: [],
        fetchLifecycle: { kind: "loading", detail: null },
      }),
    ).toEqual({
      kind: "checking",
      latestRun: null,
      fetchLifecycle: { kind: "loading", detail: null },
    });
  });

  it("returns timeout when swarm validation/status timed out", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: null,
        validation: null,
        epicRuns: [],
        fetchLifecycle: TIMEOUT_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "timeout",
      latestRun: null,
      fetchLifecycle: TIMEOUT_FETCH_LIFECYCLE,
    });
  });

  it("returns stale when cached swarm state is being refreshed", () => {
    const run = makeEpicRun({
      status: "running",
      runId: EpicRunId.makeUnsafe("run-stale"),
    });

    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: null,
        validation: null,
        epicRuns: [run],
        fetchLifecycle: STALE_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "stale",
      latestRun: run,
      fetchLifecycle: STALE_FETCH_LIFECYCLE,
    });
  });

  it("returns unsupported when swarm support is unavailable", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: false },
        status: null,
        validation: null,
        epicRuns: [],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "unsupported",
      latestRun: null,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it("returns needs_preparation when epic structure is invalid and there is no run history", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: { swarm: null },
        validation: { valid: false, swarm: null },
        epicRuns: [],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "needs_preparation",
      latestRun: null,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it("returns needs_preparation when a swarm exists but beads validation fails", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
        },
        validation: {
          valid: false,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
        },
        epicRuns: [],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "needs_preparation",
      latestRun: null,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it("returns ready when a valid swarm exists and no run has started", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: null,
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "epic-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 1,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 1,
          },
        },
        epicRuns: [],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "ready",
      latestRun: null,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it("returns ready when epic structure is valid even if swarm metadata is still missing", () => {
    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: { swarm: null },
        validation: { valid: true, swarm: null },
        epicRuns: [],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "ready",
      latestRun: null,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it("prefers a non-terminal run over newer historical runs", () => {
    const runningRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-running"),
      status: "running",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const completedRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-completed"),
      status: "completed",
      updatedAt: "2026-01-03T00:00:00.000Z",
      completedAt: "2026-01-03T00:00:00.000Z",
    });

    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: null,
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "epic-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 1,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 1,
          },
        },
        epicRuns: [completedRun, runningRun],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "running",
      latestRun: runningRun,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });

  it.each([
    ["pending", "running"],
    ["running", "running"],
    ["stopping", "stopping"],
    ["failed", "failed"],
    ["stopped", "stopped"],
    ["completed", "completed"],
  ] as const)("maps run status %s to %s", (runStatus, expectedKind) => {
    const run = makeEpicRun({
      status: runStatus,
      ...(runStatus === "failed"
        ? {
            failureContext: {
              kind: "worker_failure",
              message: "boom",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }
        : {}),
      ...(runStatus === "completed" ? { completedAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "stopped" ? { stoppedAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "stopping" ? { stopRequestedAt: "2026-01-01T00:03:00.000Z" } : {}),
    });

    expect(
      deriveEpicCoordinatorState({
        coordinationSupport: { supported: true },
        status: null,
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 1,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 1,
          },
        },
        epicRuns: [run],
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: expectedKind,
      latestRun: run,
      fetchLifecycle: READY_FETCH_LIFECYCLE,
    });
  });
});

describe("selectLatestEpicRun", () => {
  it("returns the latest non-terminal run before newer terminal history", () => {
    const runningRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-running"),
      status: "running",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const completedRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-completed"),
      status: "completed",
      updatedAt: "2026-01-04T00:00:00.000Z",
      completedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(selectLatestEpicRun([completedRun, runningRun])).toEqual(runningRun);
  });
});

describe("getEpicCoordinatorPrimaryAction", () => {
  it("disables the CTA while swarm state is still loading", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: null,
        status: null,
        validation: null,
        epicRuns: [],
        projectConflict: null,
        fetchLifecycle: { kind: "loading", detail: null },
      }),
    ).toEqual({
      kind: "checking",
      label: "Checking epic...",
      busyLabel: "Checking...",
      disabled: true,
    });
  });

  it("returns Retry epic status when fetches timed out", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: null,
        validation: null,
        epicRuns: [],
        projectConflict: null,
        fetchLifecycle: TIMEOUT_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "refresh_epic_status",
      label: "Retry epic status",
      busyLabel: "Retrying...",
      disabled: false,
    });
  });

  it("returns Open prep thread when epic structure is invalid and no swarm exists", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: { valid: false, swarm: null, readyFronts: [] },
        epicRuns: [],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("returns Open prep thread when the epic swarm exists but is invalid", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          ready: [],
          active: [],
          blocked: [],
        },
        validation: {
          valid: false,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("returns Start epic when the swarm is valid and runnable", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 2,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("returns Start epic again when only terminal run history exists", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [makeEpicRun({ status: "completed" })],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("returns Stop run for active runs and Start epic again after stopped history", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "running",
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "stop_epic_run",
      label: "Stop run",
      busyLabel: "Stopping...",
      disabled: false,
    });

    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "stopped",
            stoppedAt: "2026-01-01T00:02:00.000Z",
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("keeps Open epic for non-terminal runs that are still settling", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "stopping",
            stopRequestedAt: "2026-01-01T00:02:00.000Z",
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("returns Start epic when the latest run failed but the swarm is still valid", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          ready: [],
          active: [],
          blocked: [],
        },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "worker_failure",
              message: "boom",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("returns Open prep thread when the latest run failed and validation is now broken", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          ready: [],
          active: [],
          blocked: [],
        },
        validation: {
          valid: false,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "worker_failure",
              message: "boom",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("returns Open prep thread when the latest run failed and epic structure is invalid", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: { valid: false, swarm: null, readyFronts: [] },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "worker_failure",
              message: "boom",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("returns Start epic for recoverable worker failures when tracker state can advance", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
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
          active: [],
          blocked: [],
        },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [
            [
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
          ],
        },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "worker_failure",
              message: "worker exited",
              issueId: "TASK-1",
              executionId: "execution-1" as never,
              workerThreadId: ThreadId.makeUnsafe("thread-worker"),
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    });
  });

  it("keeps Open epic while tracker state is still blocked after a worker failure", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          ready: [],
          active: [],
          blocked: [
            {
              id: "TASK-1",
              title: "Task 1",
              status: "open",
              priority: 1,
              issueType: "task",
              assignee: null,
              owner: null,
              parent: null,
            },
          ],
        },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "worker_failure",
              message: "worker exited",
              issueId: "TASK-1",
              executionId: "execution-1" as never,
              workerThreadId: ThreadId.makeUnsafe("thread-worker"),
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("keeps Open epic for generic tracker-blocked runs", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: {
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          ready: [],
          active: [],
          blocked: [
            {
              id: "TASK-9",
              title: "Task 9",
              status: "open",
              priority: 9,
              issueType: "task",
              assignee: null,
              owner: null,
              parent: null,
            },
          ],
        },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [
          makeEpicRun({
            status: "failed",
            failureContext: {
              kind: "environment_failure",
              message: "blocked by tracker state",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }),
        ],
        projectConflict: null,
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("redirects ready epics to the active shared-workspace run for the project", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        coordinationSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          readyFronts: [],
        },
        epicRuns: [],
        projectConflict: describeSharedWorkspaceProjectConflict(
          makeEpicRun({
            runId: EpicRunId.makeUnsafe("run-blocking"),
            epicIssueId: "EPIC-OTHER",
            status: "running",
          }),
        ),
        fetchLifecycle: READY_FETCH_LIFECYCLE,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "View active epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });
});

describe("describeDisabledEpicCoordinatorAction", () => {
  it("returns a loading detail while epic state is still being fetched", () => {
    expect(
      describeDisabledEpicCoordinatorAction({
        epic: null,
      }),
    ).toBe("Checking epic status.");
  });

  it("returns the unsupported coordination reason when epic actions are unavailable", () => {
    expect(
      describeDisabledEpicCoordinatorAction({
        epic: {
          primaryAction: {
            kind: "unsupported",
            label: "Epic coordination unavailable",
            busyLabel: "Epic coordination unavailable",
            disabled: true,
          },
          trackerLoadState: "ready",
          trackerLoadDetail: null,
          coordinationSupported: false,
          coordinationUnsupportedReason: "Shared workspaces are disabled for this backend.",
          status: null,
        },
      }),
    ).toBe("Shared workspaces are disabled for this backend.");
  });

  it("keeps the generic open-epic explanation for blocked tracker state", () => {
    expect(
      describeDisabledEpicCoordinatorAction({
        epic: {
          primaryAction: {
            kind: "open_coordinator",
            label: "Open epic",
            busyLabel: "Opening...",
            disabled: false,
          },
          trackerLoadState: "ready",
          trackerLoadDetail: null,
          coordinationSupported: true,
          coordinationUnsupportedReason: null,
          status: {
            epicId: "EPIC-1",
            epicTitle: "Epic 1",
            swarm: null,
            completed: [],
            active: [],
            ready: [],
            blocked: [
              {
                id: "TASK-9",
                title: "Blocked task",
                status: "blocked",
                priority: null,
                issueType: "task",
                assignee: null,
                owner: null,
                parent: null,
              },
            ],
            blockedBreakdown: {
              internal: [],
              external: [],
              unknown: [
                {
                  id: "TASK-9",
                  title: "Blocked task",
                  status: "blocked",
                  priority: null,
                  issueType: "task",
                  assignee: null,
                  owner: null,
                  parent: null,
                },
              ],
            },
          },
        },
      }),
    ).toBeNull();
  });
});

describe("findConflictingSharedWorkspaceRun", () => {
  it("returns the latest conflicting shared-workspace run from the same project", () => {
    const blockingRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-blocking"),
      epicIssueId: "EPIC-BLOCKING",
      status: "running",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const currentEpicRun = makeEpicRun({
      runId: EpicRunId.makeUnsafe("run-current"),
      epicIssueId: "EPIC-1",
      status: "completed",
      completedAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(
      findConflictingSharedWorkspaceRun({
        projectEpicRuns: [currentEpicRun, blockingRun],
        epicRuns: [currentEpicRun],
      }),
    ).toEqual(describeSharedWorkspaceProjectConflict(blockingRun));
  });
});

describe("collectCoordinatorEpics", () => {
  it("deduplicates epics across issue rows, swarm summaries, and run history", () => {
    const epicIssue = makeIssue({
      id: "EPIC-1",
      title: "Epic from issues",
      issueType: "epic",
    });

    expect(
      collectCoordinatorEpics({
        epicIssues: [epicIssue],
        swarms: [
          {
            swarmId: "swarm-1",
            epicId: "EPIC-1",
            epicTitle: "Epic from swarm",
            totalIssueCount: 3,
            completedIssueCount: 0,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
          {
            swarmId: "swarm-2",
            epicId: "EPIC-2",
            epicTitle: "Epic from swarm only",
            totalIssueCount: 2,
            completedIssueCount: 0,
            activeIssueCount: 0,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
        ],
        epicRuns: [
          makeEpicRun({
            epicIssueId: "EPIC-3",
          }),
        ],
      }),
    ).toEqual([
      {
        epicId: "EPIC-1",
        epicTitle: "Epic from issues",
        issue: epicIssue,
      },
      {
        epicId: "EPIC-2",
        epicTitle: "Epic from swarm only",
        issue: null,
      },
      {
        epicId: "EPIC-3",
        epicTitle: "EPIC-3",
        issue: null,
      },
    ]);
  });
});

describe("partitionCoordinatorEpics", () => {
  it("groups states into needs-attention, active, and history buckets", () => {
    expect(
      partitionCoordinatorEpics([
        {
          id: "invalid",
          trackerLoadState: "ready" as const,
          coordinationSupported: true,
          validationState: "invalid" as const,
          projectConflict: null,
          activeRunId: null,
          trackerState: "not_started" as const,
          runs: [],
        },
        {
          id: "running",
          trackerLoadState: "ready" as const,
          coordinationSupported: true,
          validationState: "valid" as const,
          projectConflict: null,
          activeRunId: "run-1" as never,
          trackerState: "in_progress" as const,
          runs: [
            {
              ...makeEpicRun({
                runId: "run-1" as never,
                status: "running",
              }),
            },
          ],
        },
        {
          id: "completed",
          trackerLoadState: "ready" as const,
          coordinationSupported: true,
          validationState: "valid" as const,
          projectConflict: null,
          activeRunId: null,
          trackerState: "completed" as const,
          runs: [],
        },
        {
          id: "idle",
          trackerLoadState: "ready" as const,
          coordinationSupported: true,
          validationState: "valid" as const,
          projectConflict: null,
          activeRunId: null,
          trackerState: "not_started" as const,
          runs: [],
        },
      ]),
    ).toEqual({
      needsAttention: [
        {
          id: "invalid",
          trackerLoadState: "ready",
          coordinationSupported: true,
          validationState: "invalid",
          projectConflict: null,
          activeRunId: null,
          trackerState: "not_started",
          runs: [],
        },
      ],
      active: [
        {
          id: "running",
          trackerLoadState: "ready",
          coordinationSupported: true,
          validationState: "valid",
          projectConflict: null,
          activeRunId: "run-1",
          trackerState: "in_progress",
          runs: [
            expect.objectContaining({
              runId: "run-1",
              status: "running",
            }),
          ],
        },
      ],
      history: [
        {
          id: "completed",
          trackerLoadState: "ready",
          coordinationSupported: true,
          validationState: "valid",
          projectConflict: null,
          activeRunId: null,
          trackerState: "completed",
          runs: [],
        },
        {
          id: "idle",
          trackerLoadState: "ready",
          coordinationSupported: true,
          validationState: "valid",
          projectConflict: null,
          activeRunId: null,
          trackerState: "not_started",
          runs: [],
        },
      ],
    });
  });
});

describe("partitionCoordinatorEpics", () => {
  it("partitions and sorts running and ready swarms", () => {
    const swarms = [
      {
        swarmId: "swarm-ready-a",
        epicId: "EPIC-3",
        epicTitle: "Alpha ready",
        totalIssueCount: 5,
        completedIssueCount: 1,
        activeIssueCount: 0,
        readyIssueCount: 3,
        blockedIssueCount: 1,
        activeWorkerCount: 0,
      },
      {
        swarmId: "swarm-running-b",
        epicId: "EPIC-2",
        epicTitle: "Bravo running",
        totalIssueCount: 7,
        completedIssueCount: 2,
        activeIssueCount: 2,
        readyIssueCount: 2,
        blockedIssueCount: 1,
        activeWorkerCount: 1,
      },
      {
        swarmId: "swarm-running-a",
        epicId: "EPIC-1",
        epicTitle: "Alpha running",
        totalIssueCount: 9,
        completedIssueCount: 4,
        activeIssueCount: 3,
        readyIssueCount: 1,
        blockedIssueCount: 1,
        activeWorkerCount: 2,
      },
      {
        swarmId: "swarm-ready-b",
        epicId: "EPIC-4",
        epicTitle: "Zulu ready",
        totalIssueCount: 4,
        completedIssueCount: 0,
        activeIssueCount: 0,
        readyIssueCount: 1,
        blockedIssueCount: 0,
        activeWorkerCount: 0,
      },
      {
        swarmId: "swarm-idle",
        epicId: "EPIC-5",
        epicTitle: "Idle",
        totalIssueCount: 4,
        completedIssueCount: 4,
        activeIssueCount: 0,
        readyIssueCount: 0,
        blockedIssueCount: 0,
        activeWorkerCount: 0,
      },
    ];

    expect(partitionCoordinatorTrackerEpics(swarms)).toEqual({
      runningEpics: [swarms[2], swarms[1]],
      readyToRunEpics: [swarms[0], swarms[3]],
    });
  });
});

function makeTrackerThread(
  overrides: Partial<TrackerRefinementPlanCandidate>,
): TrackerRefinementPlanCandidate {
  return {
    id: ThreadId.makeUnsafe("thread-default"),
    projectId: ProjectId.makeUnsafe("project-default"),
    title: "Thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    issueLink: null,
    proposedPlans: [],
    ...overrides,
  };
}

describe("findLatestTrackerRefinementPlan", () => {
  it("returns the latest tracker refinement plan for the selected epic", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const olderThread = makeTrackerThread({
      id: ThreadId.makeUnsafe("thread-1"),
      projectId,
      title: "Older planned refine",
      issueLink: { issueId: "EPIC-1" },
      proposedPlans: [
        {
          id: "plan-1",
          planMarkdown: "Older plan",
          planIntent: "tracker-refinement",
          followUpOutcome: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    const newerThread = makeTrackerThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId,
      title: "Newer planned refine",
      issueLink: { issueId: "EPIC-1" },
      proposedPlans: [
        {
          id: "plan-2",
          planMarkdown: "Newer plan",
          planIntent: "tracker-refinement",
          followUpOutcome: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });

    expect(
      findLatestTrackerRefinementPlan({
        threads: [olderThread, newerThread],
        projectId,
        issueId: "EPIC-1",
      }),
    ).toEqual({
      threadId: ThreadId.makeUnsafe("thread-2"),
      threadTitle: "Newer planned refine",
      planId: "plan-2",
      planMarkdown: "Newer plan",
      followUpOutcome: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("ignores non-matching issues and non-tracker plans", () => {
    const projectId = ProjectId.makeUnsafe("project-1");

    expect(
      findLatestTrackerRefinementPlan({
        threads: [
          makeTrackerThread({
            projectId,
            issueLink: { issueId: "EPIC-1" },
            proposedPlans: [
              {
                id: "plan-code",
                planMarkdown: "Implementation plan",
                planIntent: "code-implementation",
                followUpOutcome: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          makeTrackerThread({
            projectId,
            issueLink: { issueId: "EPIC-2" },
            proposedPlans: [
              {
                id: "plan-other-epic",
                planMarkdown: "Other epic",
                planIntent: "tracker-refinement",
                followUpOutcome: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        ],
        projectId,
        issueId: "EPIC-1",
      }),
    ).toBeNull();
  });
});
