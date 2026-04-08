import {
  ProjectId,
  SwarmRunId,
  ThreadId,
  type BeadsIssueSummary,
  type OrchestrationSwarmRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  collectCoordinatorEpics,
  deriveEpicCoordinatorState,
  findLatestTrackerRefinementPlan,
  getEpicCoordinatorPrimaryAction,
  groupIssuesByEpic,
  isEpicIssueType,
  listEpicChildIssues,
  partitionCoordinatorEpics,
  partitionCoordinatorSwarms,
  selectLatestSwarmRun,
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

function makeSwarmRun(overrides: Partial<OrchestrationSwarmRun> = {}): OrchestrationSwarmRun {
  return {
    runId: SwarmRunId.makeUnsafe("run-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    epicIssueId: "EPIC-1",
    swarmId: "swarm-1",
    status: "running",
    schedulerMode: "automatic",
    workspaceMode: "shared",
    provider: "codex",
    model: "gpt-5.4-mini",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    activeTaskExecutionId: null,
    latestTaskExecutionId: null,
    lastError: null,
    requestedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:01:00.000Z",
    idledAt: null,
    pausedAt: null,
    blockedAt: null,
    blockedContext: null,
    failedAt: null,
    cancelledAt: null,
    completedAt: null,
    updatedAt: "2026-01-01T00:02:00.000Z",
    ...overrides,
  } satisfies OrchestrationSwarmRun;
}

describe("groupIssuesByEpic", () => {
  it("renders epic sections with the epic issue and keeps ungrouped issues flat", () => {
    const issues = [
      makeIssue({
        id: "epic-b",
        title: "Beta epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-b", title: "Beta epic" },
      }),
      makeIssue({
        id: "task-ungrouped",
        title: "Ungrouped task",
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
    ];

    expect(groupIssuesByEpic(issues)).toEqual([
      {
        key: "epic:epic-b",
        epicId: "epic-b",
        epicTitle: "Beta epic",
        issues: [issues[1]],
        epicIssue: issues[0],
      },
      {
        key: "issue:task-ungrouped",
        epicId: null,
        epicTitle: null,
        issues: [issues[2]],
        epicIssue: null,
      },
      {
        key: "epic:epic-a",
        epicId: "epic-a",
        epicTitle: "Alpha epic",
        issues: [issues[3]],
        epicIssue: null,
      },
    ]);
  });

  it("anchors a group at the first child when the epic row appears later", () => {
    const issues = [
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
      makeIssue({
        id: "epic-a",
        title: "Alpha epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
    ];

    expect(groupIssuesByEpic(issues)).toEqual([
      {
        key: "epic:epic-a",
        epicId: "epic-a",
        epicTitle: "Alpha epic",
        issues: [issues[0], issues[2]],
        epicIssue: issues[1],
      },
    ]);
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
        swarmSupport: null,
        status: null,
        validation: null,
        swarmRuns: [],
        isSupportPending: true,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "checking",
      latestRun: null,
    });
  });

  it("returns unsupported when swarm support is unavailable", () => {
    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: false },
        status: null,
        validation: null,
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "unsupported",
      latestRun: null,
    });
  });

  it("returns no_swarm when no swarm exists and there is no run history", () => {
    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: true },
        status: { swarm: null },
        validation: { valid: false, swarm: null },
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "no_swarm",
      latestRun: null,
    });
  });

  it("returns needs_repair when a swarm exists but beads validation fails", () => {
    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: true },
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
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "needs_repair",
      latestRun: null,
    });
  });

  it("returns ready when a valid swarm exists and no run has started", () => {
    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: true },
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
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "ready",
      latestRun: null,
    });
  });

  it("prefers a non-terminal run over newer historical runs", () => {
    const runningRun = makeSwarmRun({
      runId: SwarmRunId.makeUnsafe("run-running"),
      status: "running",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const completedRun = makeSwarmRun({
      runId: SwarmRunId.makeUnsafe("run-completed"),
      status: "completed",
      updatedAt: "2026-01-03T00:00:00.000Z",
      completedAt: "2026-01-03T00:00:00.000Z",
    });

    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: true },
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
        swarmRuns: [completedRun, runningRun],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "running",
      latestRun: runningRun,
    });
  });

  it.each([
    ["requested", "running"],
    ["running", "running"],
    ["idle", "idle"],
    ["paused", "paused"],
    ["blocked", "blocked"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["completed", "completed"],
  ] as const)("maps run status %s to %s", (runStatus, expectedKind) => {
    const run = makeSwarmRun({
      status: runStatus,
      ...(runStatus === "failed" ? { lastError: "boom" } : {}),
      ...(runStatus === "completed" ? { completedAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "cancelled" ? { cancelledAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "paused" ? { pausedAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "blocked" ? { blockedAt: "2026-01-01T00:03:00.000Z" } : {}),
      ...(runStatus === "idle" ? { idledAt: "2026-01-01T00:03:00.000Z" } : {}),
    });

    expect(
      deriveEpicCoordinatorState({
        swarmSupport: { supported: true },
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
        swarmRuns: [run],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: expectedKind,
      latestRun: run,
    });
  });
});

describe("selectLatestSwarmRun", () => {
  it("returns the latest non-terminal run before newer terminal history", () => {
    const runningRun = makeSwarmRun({
      runId: SwarmRunId.makeUnsafe("run-running"),
      status: "running",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    const completedRun = makeSwarmRun({
      runId: SwarmRunId.makeUnsafe("run-completed"),
      status: "completed",
      updatedAt: "2026-01-04T00:00:00.000Z",
      completedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(selectLatestSwarmRun([completedRun, runningRun])).toEqual(runningRun);
  });
});

describe("getEpicCoordinatorPrimaryAction", () => {
  it("disables the CTA while swarm state is still loading", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: null,
        status: null,
        validation: null,
        swarmRuns: [],
        isSupportPending: true,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "checking",
      label: "Checking swarm...",
      disabled: true,
    });
  });

  it("returns Create swarm when the epic has no swarm", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
        status: { swarm: null, ready: [], active: [], blocked: [] },
        validation: { valid: false, swarm: null, readyFronts: [] },
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "create_swarm",
      label: "Create swarm",
      disabled: false,
    });
  });

  it("returns Repair swarm when the epic swarm exists but is invalid", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "repair_swarm",
      label: "Repair swarm",
      disabled: false,
    });
  });

  it("returns Start swarm when the swarm is valid and runnable", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "start_swarm",
      label: "Start swarm",
      disabled: false,
    });
  });

  it("returns Open coordinator when a swarm run already exists", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [makeSwarmRun({ status: "completed" })],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open coordinator",
      disabled: false,
    });
  });

  it("returns Continue swarm for recoverable blocked worker failures when tracker state can advance", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [
          makeSwarmRun({
            status: "blocked",
            blockedAt: "2026-01-01T00:02:00.000Z",
            blockedContext: {
              kind: "worker_failure",
              issueId: "TASK-1",
              executionId: "execution-1" as never,
              workerThreadId: ThreadId.makeUnsafe("thread-worker"),
            },
          }),
        ],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "continue_swarm",
      label: "Continue swarm",
      disabled: false,
    });
  });

  it("disables Continue swarm while tracker state is still blocked after a worker failure", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [
          makeSwarmRun({
            status: "blocked",
            blockedAt: "2026-01-01T00:02:00.000Z",
            blockedContext: {
              kind: "worker_failure",
              issueId: "TASK-1",
              executionId: "execution-1" as never,
              workerThreadId: ThreadId.makeUnsafe("thread-worker"),
            },
          }),
        ],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "continue_swarm",
      label: "Continue swarm",
      disabled: true,
    });
  });

  it("keeps Open coordinator for generic tracker-blocked runs", () => {
    expect(
      getEpicCoordinatorPrimaryAction({
        swarmSupport: { supported: true },
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
        swarmRuns: [
          makeSwarmRun({
            status: "blocked",
            blockedAt: "2026-01-01T00:02:00.000Z",
            blockedContext: {
              kind: "tracker_waiting",
              issueId: null,
              executionId: null,
              workerThreadId: null,
            },
          }),
        ],
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open coordinator",
      disabled: false,
    });
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
        swarmRuns: [
          makeSwarmRun({
            epicIssueId: "EPIC-3",
            swarmId: "swarm-3",
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
        { id: "needs-repair", stateKind: "needs_repair" as const },
        { id: "running", stateKind: "running" as const },
        { id: "completed", stateKind: "completed" as const },
        { id: "idle", stateKind: "idle" as const },
      ]),
    ).toEqual({
      needsAttention: [
        { id: "needs-repair", stateKind: "needs_repair" },
        { id: "idle", stateKind: "idle" },
      ],
      active: [{ id: "running", stateKind: "running" }],
      history: [{ id: "completed", stateKind: "completed" }],
    });
  });
});

describe("partitionCoordinatorSwarms", () => {
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

    expect(partitionCoordinatorSwarms(swarms)).toEqual({
      runningSwarms: [swarms[2], swarms[1]],
      readyToRunSwarms: [swarms[0], swarms[3]],
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
          implementedAt: null,
          implementationThreadId: null,
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
          implementedAt: null,
          implementationThreadId: null,
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
      implementedAt: null,
      implementationThreadId: null,
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
                implementedAt: null,
                implementationThreadId: null,
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
                implementedAt: null,
                implementationThreadId: null,
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
