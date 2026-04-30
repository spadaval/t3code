import { EnvironmentId, EpicIssueExecutionId, EpicRunId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { AppState, EnvironmentState } from "./store";
import {
  createEpicIssueExecutionsSelectorForRun,
  createEpicRunsSelectorForProject,
} from "./storeSelectors";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const runId1 = EpicRunId.make("run-1");
const runId2 = EpicRunId.make("run-2");
const executionId1 = EpicIssueExecutionId.make("execution-1");
const executionId2 = EpicIssueExecutionId.make("execution-2");

function makeEnvironmentState(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  return {
    projectIds: [],
    projectById: {},
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: {},
    epicRunIds: [],
    epicRunIdsByProjectId: {},
    epicRunById: {},
    epicIssueExecutionIds: [],
    epicIssueExecutionIdsByRunId: {},
    epicIssueExecutionById: {},
    bootstrapComplete: true,
    ...overrides,
  };
}

function makeState(environmentState: EnvironmentState): AppState {
  return {
    activeEnvironmentId: environmentId,
    environmentStateById: {
      [environmentId]: environmentState,
    },
  };
}

describe("epic run selectors", () => {
  it("returns epic runs in requested-at descending order and preserves references across wrapper states", () => {
    const selector = createEpicRunsSelectorForProject(projectId);
    const environmentState = makeEnvironmentState({
      epicRunIds: [runId2, runId1],
      epicRunIdsByProjectId: {
        [projectId]: [runId2, runId1],
      },
      epicRunById: {
        [runId1]: {
          runId: runId1,
          projectId,
          epicIssueId: "EPIC-1",
          status: "completed",
          provider: "codex" as never,
          model: "gpt-5-codex",
          modelOptions: null,
          providerOptions: null,
          assistantDeliveryMode: null,
          runtimeMode: "full-access",
          failureContext: null,
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: null,
          stopRequestedAt: null,
          stoppedAt: null,
          failedAt: null,
          completedAt: "2026-02-27T00:01:00.000Z",
          updatedAt: "2026-02-27T00:01:00.000Z",
        },
        [runId2]: {
          runId: runId2,
          projectId,
          epicIssueId: "EPIC-2",
          status: "running",
          provider: "codex" as never,
          model: "gpt-5-codex",
          modelOptions: null,
          providerOptions: null,
          assistantDeliveryMode: null,
          runtimeMode: "full-access",
          failureContext: null,
          requestedAt: "2026-02-27T00:02:00.000Z",
          startedAt: "2026-02-27T00:02:05.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          failedAt: null,
          completedAt: null,
          updatedAt: "2026-02-27T00:02:05.000Z",
        },
      },
    });
    const state = makeState(environmentState);
    const wrappedState: AppState = {
      ...state,
      environmentStateById: { ...state.environmentStateById },
    };

    const first = selector(state);
    const second = selector(wrappedState);

    expect(first.map((run) => run.runId)).toEqual([runId2, runId1]);
    expect(second).toBe(first);
  });

  it("returns run-scoped issue executions in sequence order and preserves references across wrapper states", () => {
    const selector = createEpicIssueExecutionsSelectorForRun(runId1);
    const environmentState = makeEnvironmentState({
      epicIssueExecutionIds: [executionId1, executionId2],
      epicIssueExecutionIdsByRunId: {
        [runId1]: [executionId1, executionId2],
      },
      epicIssueExecutionById: {
        [executionId1]: {
          executionId: executionId1,
          runId: runId1,
          issueId: "ISSUE-1",
          workerThreadId: null,
          sequenceNumber: 1,
          status: "completed",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-02-27T00:00:00.000Z",
          startedAt: "2026-02-27T00:00:01.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: "2026-02-27T00:00:02.000Z",
          failedAt: null,
          updatedAt: "2026-02-27T00:00:02.000Z",
        },
        [executionId2]: {
          executionId: executionId2,
          runId: runId1,
          issueId: "ISSUE-2",
          workerThreadId: null,
          sequenceNumber: 2,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-02-27T00:03:00.000Z",
          startedAt: "2026-02-27T00:03:01.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: "2026-02-27T00:03:01.000Z",
        },
      },
    });
    const state = makeState(environmentState);
    const wrappedState: AppState = {
      ...state,
      environmentStateById: { ...state.environmentStateById },
    };

    const first = selector(state);
    const second = selector(wrappedState);

    expect(first.map((execution) => execution.executionId)).toEqual([executionId1, executionId2]);
    expect(second).toBe(first);
  });
});
