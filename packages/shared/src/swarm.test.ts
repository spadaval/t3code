import type {
  BeadsSwarmStatus,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  BeadsIssueRelationSummary,
  OrchestrationEvent,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  SwarmRunId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applySwarmRunLifecycleEvent,
  compareSwarmReadyIssues,
  createEmptySwarmProjectionState,
  describeSwarmCoordinatorFetchFailure,
  describeSharedWorkspaceProjectConflict,
  deriveEpicSwarmCoordinatorState,
  deriveSwarmRunExecutionState,
  findConflictingSharedWorkspaceRun,
  getEpicSwarmCoordinatorPrimaryAction,
  listSwarmRuns,
  listSwarmTaskExecutions,
  projectSwarmEvent,
  selectDeterministicReadyIssue,
  selectDeterministicReadyIssueFromList,
  selectLatestSwarmRun,
} from "./swarm";

function makeIssue(id: string, priority: number | null = null): BeadsIssueRelationSummary {
  return {
    id,
    title: id,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  };
}

function makeExecution(
  executionId: string,
  runId: SwarmRunId,
  sequenceNumber: number,
  status: OrchestrationSwarmTaskExecution["status"],
): OrchestrationSwarmTaskExecution {
  return {
    executionId: executionId as never,
    runId,
    issueId: `TASK-${sequenceNumber}`,
    workerThreadId: null,
    sequenceNumber,
    status,
    originalStatus: "open",
    originalAssignee: null,
    lastError: null,
    requestedAt: `2026-04-06T00:00:0${sequenceNumber}.000Z`,
    startedAt: status === "requested" ? null : `2026-04-06T00:00:0${sequenceNumber}.000Z`,
    completedAt: status === "completed" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    failedAt: status === "failed" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    cancelledAt: status === "cancelled" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    updatedAt: `2026-04-06T00:00:2${sequenceNumber}.000Z`,
  };
}

function makeRun(
  runId: string,
  overrides: Partial<OrchestrationSwarmRun> = {},
): OrchestrationSwarmRun {
  return {
    runId: runId as SwarmRunId,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status: "requested",
    schedulerMode: "automatic",
    workspaceMode: "shared",
    provider: "codex",
    model: "gpt-5.4",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    lastError: null,
    requestedAt: "2026-04-06T00:00:00.000Z",
    startedAt: null,
    idledAt: null,
    pausedAt: null,
    blockedAt: null,
    blockedContext: null,
    failedAt: null,
    cancelledAt: null,
    completedAt: null,
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  };
}

function makeSwarmStatus(
  overrides: Partial<BeadsSwarmStatus> = {},
): Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> {
  return {
    swarm: {
      swarmId: "SWARM-1",
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      totalIssueCount: 0,
      completedIssueCount: 0,
      activeIssueCount: 0,
      activeWorkerCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 0,
    },
    ready: [],
    active: [],
    blocked: [],
    ...overrides,
  };
}

function makeSwarmValidation(
  overrides: Partial<BeadsSwarmValidation> = {},
): Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> {
  return {
    valid: true,
    swarm: {
      swarmId: "SWARM-1",
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      totalIssueCount: 0,
      completedIssueCount: 0,
      activeIssueCount: 0,
      activeWorkerCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 0,
    },
    readyFronts: [],
    errors: [],
    warnings: [],
    ...overrides,
  };
}

function makeSwarmSupport(
  overrides: Partial<BeadsSwarmSupport> = {},
): Pick<BeadsSwarmSupport, "supported"> {
  return {
    supported: true,
    ...overrides,
  };
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
): Extract<OrchestrationEvent, { type: T }> {
  return {
    sequence: 1,
    eventId: "event-1" as never,
    aggregateKind: "swarmRun",
    aggregateId: "run-1" as never,
    occurredAt: "2026-04-06T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as unknown as Extract<OrchestrationEvent, { type: T }>;
}

describe("swarm", () => {
  it("orders ready issues by priority then id", () => {
    expect(
      [
        makeIssue("TASK-3", 2),
        makeIssue("TASK-1", 1),
        makeIssue("TASK-2", 1),
        makeIssue("TASK-4", null),
      ]
        .toSorted(compareSwarmReadyIssues)
        .map((issue) => issue.id),
    ).toEqual(["TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
  });

  it("preserves a shared backend error across validation and status failures", () => {
    expect(
      describeSwarmCoordinatorFetchFailure({
        failures: [
          {
            source: "validation",
            message: "Issue 'EPIC-404' was not found.",
          },
          {
            source: "status",
            message: "Issue 'EPIC-404' was not found.",
          },
        ],
        stale: false,
      }),
    ).toBe("Swarm validation and status request failed: Issue 'EPIC-404' was not found.");
  });

  it("keeps source-specific backend details when validation and status fail differently", () => {
    expect(
      describeSwarmCoordinatorFetchFailure({
        failures: [
          {
            source: "validation",
            message: "Issue 'EPIC-404' was not found.",
          },
          {
            source: "status",
            message: "Swarm 'swarm-404' was not found.",
          },
        ],
        stale: true,
      }),
    ).toBe(
      "Showing the last known swarm state because the latest refresh failed. Swarm validation request failed: Issue 'EPIC-404' was not found. Swarm status request failed: Swarm 'swarm-404' was not found.",
    );
  });

  it("prefers live status ready issues over validation fronts when they disagree", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: { readyFronts: [[makeIssue("TASK-2", 2)]] },
        status: { ready: [makeIssue("TASK-1", 1)] },
      })?.id,
    ).toBe("TASK-1");
  });

  it("falls back to validation fronts when status is unavailable", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: { readyFronts: [[], [makeIssue("TASK-2", 2), makeIssue("TASK-1", 1)]] },
        status: null,
      })?.id,
    ).toBe("TASK-1");
  });

  it("keeps deterministic ordering within status.ready", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: { readyFronts: [[makeIssue("TASK-9", 0)]] },
        status: { ready: [makeIssue("TASK-2", 2), makeIssue("TASK-1", 2), makeIssue("TASK-3", 1)] },
      })?.id,
    ).toBe("TASK-3");
  });

  it("selects deterministically from a plain issue list", () => {
    expect(
      selectDeterministicReadyIssueFromList([makeIssue("TASK-2", 2), makeIssue("TASK-1", 2)])?.id,
    ).toBe("TASK-1");
  });

  it("derives active and latest swarm task executions from execution history", () => {
    const runId = "run-1" as SwarmRunId;

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "active"),
          makeExecution("execution-1", runId, 1, "completed"),
          makeExecution("execution-3", "run-2" as SwarmRunId, 1, "active"),
        ],
      }),
    ).toMatchObject({
      activeExecution: { executionId: "execution-2" },
      currentExecution: { executionId: "execution-2" },
      latestExecution: { executionId: "execution-2" },
      nonTerminalExecutions: [{ executionId: "execution-2" }],
    });
  });

  it("keeps all non-terminal executions for invariant checks", () => {
    const runId = "run-1" as SwarmRunId;

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "requested"),
          makeExecution("execution-1", runId, 1, "active"),
        ],
      }),
    ).toMatchObject({
      activeExecution: { executionId: "execution-1" },
      currentExecution: { executionId: "execution-2" },
    });

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "requested"),
          makeExecution("execution-1", runId, 1, "active"),
        ],
      }).nonTerminalExecutions.map((execution) => execution.executionId),
    ).toEqual(["execution-1", "execution-2"]);
  });

  it("selects the most relevant run and identifies shared-workspace conflicts", () => {
    const requested = makeRun("run-requested", {
      status: "requested",
      updatedAt: "2026-04-06T00:00:03.000Z",
    });
    const completed = makeRun("run-completed", {
      status: "completed",
      updatedAt: "2026-04-06T00:00:04.000Z",
    });
    const conflicting = makeRun("run-conflict", {
      epicIssueId: "EPIC-OTHER",
      status: "running",
      updatedAt: "2026-04-06T00:00:05.000Z",
    });

    expect(selectLatestSwarmRun([completed, requested])).toEqual(requested);
    expect(
      findConflictingSharedWorkspaceRun({
        projectSwarmRuns: [requested, conflicting],
        epicSwarmRuns: [requested],
      }),
    ).toEqual(conflicting);
    expect(describeSharedWorkspaceProjectConflict(conflicting)).toContain("EPIC-OTHER");
  });

  it("projects swarm lifecycle events into normalized state and derives ordered views", () => {
    const requested = projectSwarmEvent(
      createEmptySwarmProjectionState(),
      makeEvent("swarm-run.requested", {
        runId: "run-1" as never,
        projectId: "project-1" as never,
        epicIssueId: "EPIC-1",
        swarmId: "SWARM-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: null,
        runtimeMode: "full-access",
        requestedAt: "2026-04-06T00:00:00.000Z",
        updatedAt: "2026-04-06T00:00:00.000Z",
      }),
    );
    const started = projectSwarmEvent(
      requested,
      makeEvent("swarm-task-execution.started", {
        executionId: "execution-1" as never,
        runId: "run-1" as never,
        startedAt: "2026-04-06T00:00:01.000Z",
        updatedAt: "2026-04-06T00:00:01.000Z",
      }),
    );
    const blocked = projectSwarmEvent(
      started,
      makeEvent("swarm-run.blocked", {
        runId: "run-1" as never,
        reason: "worker exited",
        blockedContext: {
          kind: "worker_failure",
          issueId: "TASK-1",
          executionId: "execution-1" as never,
          workerThreadId: null,
        },
        blockedAt: "2026-04-06T00:00:02.000Z",
        updatedAt: "2026-04-06T00:00:02.000Z",
      }),
    );

    expect(listSwarmRuns(blocked)).toEqual([
      expect.objectContaining({
        runId: "run-1",
        status: "blocked",
        lastError: "worker exited",
      }),
    ]);
    expect(listSwarmTaskExecutions(blocked)).toEqual([
      expect.objectContaining({
        executionId: "execution-1",
        status: "active",
        issueId: "unknown-task",
      }),
    ]);
  });

  it("derives coordinator state from shared swarm inputs", () => {
    expect(
      deriveEpicSwarmCoordinatorState({
        swarmSupport: makeSwarmSupport(),
        status: makeSwarmStatus(),
        validation: makeSwarmValidation(),
        swarmRuns: [
          makeRun("run-requested", {
            status: "requested",
            updatedAt: "2026-04-06T00:00:03.000Z",
          }),
        ],
        fetchLifecycle: { kind: "ready", detail: null },
      }),
    ).toEqual({
      kind: "running",
      latestRun: expect.objectContaining({ runId: "run-requested", status: "requested" }),
      fetchLifecycle: { kind: "ready", detail: null },
    });
  });

  it("keeps coordinator actions aligned for recoverable blocked runs", () => {
    expect(
      getEpicSwarmCoordinatorPrimaryAction({
        swarmSupport: makeSwarmSupport(),
        status: makeSwarmStatus(),
        validation: makeSwarmValidation({
          readyFronts: [[makeIssue("TASK-1", 1)]],
        }),
        swarmRuns: [
          makeRun("run-blocked", {
            status: "blocked",
            blockedContext: {
              kind: "worker_failure",
              issueId: "TASK-1",
              executionId: "execution-1" as never,
              workerThreadId: null,
            },
          }),
        ],
        hasProjectConflict: false,
        fetchLifecycle: { kind: "ready", detail: null },
      }),
    ).toEqual({
      kind: "run_next_swarm_task",
      label: "Run next task",
      busyLabel: "Running...",
      disabled: false,
    });
  });

  it("returns resume for paused runs and coordinator access for cancelled runs", () => {
    expect(
      getEpicSwarmCoordinatorPrimaryAction({
        swarmSupport: makeSwarmSupport(),
        status: makeSwarmStatus(),
        validation: makeSwarmValidation(),
        swarmRuns: [
          makeRun("run-paused", {
            status: "paused",
            pausedAt: "2026-04-06T00:00:02.000Z",
          }),
        ],
        hasProjectConflict: false,
        fetchLifecycle: { kind: "ready", detail: null },
      }),
    ).toEqual({
      kind: "resume_paused_swarm_run",
      label: "Resume epic",
      busyLabel: "Resuming...",
      disabled: false,
    });

    expect(
      getEpicSwarmCoordinatorPrimaryAction({
        swarmSupport: makeSwarmSupport(),
        status: makeSwarmStatus(),
        validation: makeSwarmValidation(),
        swarmRuns: [
          makeRun("run-cancelled", {
            status: "cancelled",
            cancelledAt: "2026-04-06T00:00:02.000Z",
          }),
        ],
        hasProjectConflict: false,
        fetchLifecycle: { kind: "ready", detail: null },
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "Open epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });

  it("clears cancelled metadata when a cancelled run resumes", () => {
    const cancelled = makeRun("run-cancelled", {
      status: "cancelled",
      cancelledAt: "2026-04-06T00:00:02.000Z",
      updatedAt: "2026-04-06T00:00:02.000Z",
    });

    expect(
      applySwarmRunLifecycleEvent(
        cancelled,
        makeEvent("swarm-run.resumed", {
          runId: "run-cancelled" as never,
          resumedAt: "2026-04-06T00:00:03.000Z",
          updatedAt: "2026-04-06T00:00:03.000Z",
        }),
      ),
    ).toMatchObject({
      runId: "run-cancelled",
      status: "running",
      cancelledAt: null,
      blockedContext: null,
    });
  });

  it("prefers opening the active swarm when ready state conflicts with another shared run", () => {
    expect(
      getEpicSwarmCoordinatorPrimaryAction({
        swarmSupport: makeSwarmSupport(),
        status: makeSwarmStatus(),
        validation: makeSwarmValidation(),
        swarmRuns: [],
        hasProjectConflict: true,
        fetchLifecycle: { kind: "ready", detail: null },
      }),
    ).toEqual({
      kind: "open_coordinator",
      label: "View active epic",
      busyLabel: "Opening...",
      disabled: false,
    });
  });
});
