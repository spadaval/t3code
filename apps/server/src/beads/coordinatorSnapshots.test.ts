import { ProjectId, SwarmRunId, type OrchestrationSwarmRun } from "@t3tools/contracts";
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

function makeSwarmRun(overrides: Partial<OrchestrationSwarmRun> = {}): OrchestrationSwarmRun {
  return {
    runId: SwarmRunId.makeUnsafe("run-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    epicIssueId: "EPIC-1",
    status: "running",
    schedulerMode: "automatic",
    workspaceMode: "shared",
    provider: "codex",
    model: "gpt-5.4-mini",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: "buffered",
    runtimeMode: "full-access",
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

describe("buildCoordinatorEpicSnapshot", () => {
  it("returns Retry swarm for failed runs when the swarm is still valid", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      lastError: "boom",
      failedAt: "2026-01-01T00:02:00.000Z",
    });
    const swarmSummary = {
      swarmId: "swarm-1",
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
        swarm: swarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
      },
      validationError: null,
      statusError: null,
      projectSwarmRuns: [failedRun],
      epicSwarmRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.stateKind).toBe("failed");
    expect(snapshot.primaryAction).toEqual({
      kind: "start_swarm",
      label: "Retry swarm",
      busyLabel: "Retrying...",
      disabled: false,
    });
  });

  it("returns Repair swarm for failed runs when validation is broken", () => {
    const failedRun = makeSwarmRun({
      status: "failed",
      lastError: "boom",
      failedAt: "2026-01-01T00:02:00.000Z",
    });
    const swarmSummary = {
      swarmId: "swarm-1",
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
        swarm: swarmSummary,
        errors: ["broken"],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
      },
      validationError: null,
      statusError: null,
      projectSwarmRuns: [failedRun],
      epicSwarmRuns: [failedRun],
      epicExecutions: [],
      fallbackEpicId: "EPIC-1",
      fallbackEpicTitle: "Epic",
    });

    expect(snapshot.stateKind).toBe("failed");
    expect(snapshot.primaryAction).toEqual({
      kind: "repair_swarm",
      label: "Repair swarm",
      busyLabel: "Starting...",
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
      projectSwarmRuns: [],
      epicSwarmRuns: [],
      epicExecutions: [],
      fallbackEpicId: "EPIC-404",
      fallbackEpicTitle: "Missing epic",
    });

    expect(snapshot.fetchLifecycle).toEqual({
      kind: "error",
      detail: "Swarm validation and status request failed: Issue 'EPIC-404' was not found.",
    });
    expect(snapshot.stateKind).toBe("error");
  });
});
