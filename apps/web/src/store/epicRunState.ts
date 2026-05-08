import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ProjectId,
} from "@t3tools/contracts";
import {
  applyEpicIssueExecutionLifecycleEvent,
  applyEpicRunLifecycleEvent,
  compareEpicIssueExecutions,
  compareEpicRunsByRequestedAtDesc,
  createRequestedEpicIssueExecution,
  createRequestedEpicRun,
  materializeStartedEpicIssueExecution,
} from "@t3tools/shared/epicRun";

import type { AppState, EnvironmentState } from "../store";

const EMPTY_EPIC_RUN_IDS: OrchestrationEpicRun["runId"][] = [];
const EMPTY_EPIC_ISSUE_EXECUTION_IDS: OrchestrationEpicIssueExecution["executionId"][] = [];

export const initialEpicRunState = {
  epicRunIds: [] as OrchestrationEpicRun["runId"][],
  epicRunIdsByProjectId: {} as Record<ProjectId, OrchestrationEpicRun["runId"][]>,
  epicRunById: {} as Record<OrchestrationEpicRun["runId"], OrchestrationEpicRun>,
  epicIssueExecutionIds: [] as OrchestrationEpicIssueExecution["executionId"][],
  epicIssueExecutionIdsByRunId: {} as Record<
    OrchestrationEpicRun["runId"],
    OrchestrationEpicIssueExecution["executionId"][]
  >,
  epicIssueExecutionById: {} as Record<
    OrchestrationEpicIssueExecution["executionId"],
    OrchestrationEpicIssueExecution
  >,
};

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

export function getEpicRuns(state: EnvironmentState): OrchestrationEpicRun[] {
  return state.epicRunIds.flatMap((runId) => {
    const run = state.epicRunById[runId];
    return run ? [run] : [];
  });
}

export function getEpicIssueExecutions(state: EnvironmentState): OrchestrationEpicIssueExecution[] {
  return state.epicIssueExecutionIds.flatMap((executionId) => {
    const execution = state.epicIssueExecutionById[executionId];
    return execution ? [execution] : [];
  });
}

function sortEpicRunIds(
  ids: ReadonlyArray<OrchestrationEpicRun["runId"]>,
  epicRunById: Readonly<Record<OrchestrationEpicRun["runId"], OrchestrationEpicRun>>,
): OrchestrationEpicRun["runId"][] {
  return [...ids].toSorted((leftId, rightId) =>
    compareEpicRunsByRequestedAtDesc(epicRunById[leftId]!, epicRunById[rightId]!),
  );
}

function sortEpicIssueExecutionIds(
  ids: ReadonlyArray<OrchestrationEpicIssueExecution["executionId"]>,
  epicIssueExecutionById: Readonly<
    Record<OrchestrationEpicIssueExecution["executionId"], OrchestrationEpicIssueExecution>
  >,
): OrchestrationEpicIssueExecution["executionId"][] {
  return [...ids].toSorted((leftId, rightId) =>
    compareEpicIssueExecutions(epicIssueExecutionById[leftId]!, epicIssueExecutionById[rightId]!),
  );
}

export function writeEpicRunState(
  state: EnvironmentState,
  nextRun: OrchestrationEpicRun,
): EnvironmentState {
  const previousRun = state.epicRunById[nextRun.runId];
  if (previousRun === nextRun) {
    return state;
  }

  const epicRunById = {
    ...state.epicRunById,
    [nextRun.runId]: nextRun,
  };

  let epicRunIds = state.epicRunIds;
  let epicRunIdsByProjectId = state.epicRunIdsByProjectId;

  if (!previousRun) {
    epicRunIds = sortEpicRunIds([...state.epicRunIds, nextRun.runId], epicRunById);
    const currentProjectRunIds =
      state.epicRunIdsByProjectId[nextRun.projectId] ?? EMPTY_EPIC_RUN_IDS;
    epicRunIdsByProjectId = {
      ...state.epicRunIdsByProjectId,
      [nextRun.projectId]: sortEpicRunIds([...currentProjectRunIds, nextRun.runId], epicRunById),
    };
  } else if (previousRun.projectId !== nextRun.projectId) {
    const previousProjectRunIds =
      state.epicRunIdsByProjectId[previousRun.projectId] ?? EMPTY_EPIC_RUN_IDS;
    const nextPreviousProjectRunIds = removeId(previousProjectRunIds, nextRun.runId);
    const nextProjectRunIds = state.epicRunIdsByProjectId[nextRun.projectId] ?? EMPTY_EPIC_RUN_IDS;

    epicRunIdsByProjectId = {
      ...state.epicRunIdsByProjectId,
      ...(nextPreviousProjectRunIds.length === 0
        ? (() => {
            const { [previousRun.projectId]: _removedProjectRunIds, ...rest } =
              state.epicRunIdsByProjectId;
            return rest;
          })()
        : { [previousRun.projectId]: nextPreviousProjectRunIds }),
      [nextRun.projectId]: sortEpicRunIds([...nextProjectRunIds, nextRun.runId], epicRunById),
    };
  }

  return {
    ...state,
    epicRunIds,
    epicRunIdsByProjectId,
    epicRunById,
  };
}

export function updateEpicRunState(
  state: EnvironmentState,
  runId: OrchestrationEpicRun["runId"],
  updater: (run: OrchestrationEpicRun) => OrchestrationEpicRun,
): EnvironmentState {
  const currentRun = state.epicRunById[runId];
  if (!currentRun) {
    return state;
  }
  const nextRun = updater(currentRun);
  return nextRun === currentRun ? state : writeEpicRunState(state, nextRun);
}

export function touchEpicRunUpdatedAt(
  state: EnvironmentState,
  runId: OrchestrationEpicRun["runId"],
  updatedAt: string,
): EnvironmentState {
  return updateEpicRunState(state, runId, (run) =>
    run.updatedAt === updatedAt
      ? run
      : {
          ...run,
          updatedAt,
        },
  );
}

export function writeEpicIssueExecutionState(
  state: EnvironmentState,
  nextExecution: OrchestrationEpicIssueExecution,
): EnvironmentState {
  const previousExecution = state.epicIssueExecutionById[nextExecution.executionId];
  if (previousExecution === nextExecution) {
    return state;
  }

  const epicIssueExecutionById = {
    ...state.epicIssueExecutionById,
    [nextExecution.executionId]: nextExecution,
  };

  let epicIssueExecutionIds = state.epicIssueExecutionIds;
  let epicIssueExecutionIdsByRunId = state.epicIssueExecutionIdsByRunId;

  const orderingChanged =
    !previousExecution ||
    previousExecution.runId !== nextExecution.runId ||
    previousExecution.sequenceNumber !== nextExecution.sequenceNumber;

  if (!previousExecution) {
    epicIssueExecutionIds = sortEpicIssueExecutionIds(
      [...state.epicIssueExecutionIds, nextExecution.executionId],
      epicIssueExecutionById,
    );
    const currentRunExecutionIds =
      state.epicIssueExecutionIdsByRunId[nextExecution.runId] ?? EMPTY_EPIC_ISSUE_EXECUTION_IDS;
    epicIssueExecutionIdsByRunId = {
      ...state.epicIssueExecutionIdsByRunId,
      [nextExecution.runId]: sortEpicIssueExecutionIds(
        [...currentRunExecutionIds, nextExecution.executionId],
        epicIssueExecutionById,
      ),
    };
  } else if (orderingChanged) {
    epicIssueExecutionIds = sortEpicIssueExecutionIds(
      state.epicIssueExecutionIds,
      epicIssueExecutionById,
    );

    const previousRunExecutionIds =
      state.epicIssueExecutionIdsByRunId[previousExecution.runId] ?? EMPTY_EPIC_ISSUE_EXECUTION_IDS;
    const nextPreviousRunExecutionIds = removeId(
      previousRunExecutionIds,
      nextExecution.executionId,
    );
    const nextRunExecutionIds =
      previousExecution.runId === nextExecution.runId
        ? nextPreviousRunExecutionIds
        : (state.epicIssueExecutionIdsByRunId[nextExecution.runId] ??
          EMPTY_EPIC_ISSUE_EXECUTION_IDS);

    epicIssueExecutionIdsByRunId = {
      ...state.epicIssueExecutionIdsByRunId,
      ...(nextPreviousRunExecutionIds.length === 0
        ? (() => {
            const { [previousExecution.runId]: _removedRunExecutionIds, ...rest } =
              state.epicIssueExecutionIdsByRunId;
            return rest;
          })()
        : {
            [previousExecution.runId]:
              previousExecution.runId === nextExecution.runId
                ? sortEpicIssueExecutionIds(
                    [...nextPreviousRunExecutionIds, nextExecution.executionId],
                    epicIssueExecutionById,
                  )
                : nextPreviousRunExecutionIds,
          }),
      ...(previousExecution.runId === nextExecution.runId
        ? {}
        : {
            [nextExecution.runId]: sortEpicIssueExecutionIds(
              [...nextRunExecutionIds, nextExecution.executionId],
              epicIssueExecutionById,
            ),
          }),
    };
  }

  return {
    ...state,
    epicIssueExecutionIds,
    epicIssueExecutionIdsByRunId,
    epicIssueExecutionById,
  };
}

export function findLatestFailedEpicIssueExecutionForRun(
  state: EnvironmentState,
  runId: OrchestrationEpicRun["runId"],
): OrchestrationEpicIssueExecution | null {
  const executionIds = state.epicIssueExecutionIdsByRunId[runId] ?? EMPTY_EPIC_ISSUE_EXECUTION_IDS;
  let latestFailedExecution: OrchestrationEpicIssueExecution | null = null;

  for (const executionId of executionIds) {
    const execution = state.epicIssueExecutionById[executionId];
    if (!execution || execution.status !== "failed") {
      continue;
    }

    if (
      latestFailedExecution === null ||
      execution.sequenceNumber > latestFailedExecution.sequenceNumber ||
      (execution.sequenceNumber === latestFailedExecution.sequenceNumber &&
        execution.updatedAt > latestFailedExecution.updatedAt)
    ) {
      latestFailedExecution = execution;
    }
  }

  return latestFailedExecution;
}

export function buildEpicRunState(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): Pick<EnvironmentState, "epicRunIds" | "epicRunIdsByProjectId" | "epicRunById"> {
  const epicRunIdsByProjectId: Record<ProjectId, OrchestrationEpicRun["runId"][]> = {};
  const epicRunById = Object.fromEntries(
    epicRuns.map((run) => [run.runId, run] as const),
  ) as Record<OrchestrationEpicRun["runId"], OrchestrationEpicRun>;
  const epicRunIds = sortEpicRunIds(
    epicRuns.map((run) => run.runId),
    epicRunById,
  );

  for (const runId of epicRunIds) {
    const run = epicRunById[runId];
    if (!run) {
      continue;
    }
    epicRunIdsByProjectId[run.projectId] = [
      ...(epicRunIdsByProjectId[run.projectId] ?? EMPTY_EPIC_RUN_IDS),
      runId,
    ];
  }

  return {
    epicRunIds,
    epicRunIdsByProjectId,
    epicRunById,
  };
}

export function buildEpicIssueExecutionState(
  epicIssueExecutions: ReadonlyArray<OrchestrationEpicIssueExecution>,
): Pick<
  EnvironmentState,
  "epicIssueExecutionIds" | "epicIssueExecutionIdsByRunId" | "epicIssueExecutionById"
> {
  const epicIssueExecutionIdsByRunId: Record<
    OrchestrationEpicRun["runId"],
    OrchestrationEpicIssueExecution["executionId"][]
  > = {};
  const epicIssueExecutionById = Object.fromEntries(
    epicIssueExecutions.map((execution) => [execution.executionId, execution] as const),
  ) as Record<OrchestrationEpicIssueExecution["executionId"], OrchestrationEpicIssueExecution>;
  const epicIssueExecutionIds = sortEpicIssueExecutionIds(
    epicIssueExecutions.map((execution) => execution.executionId),
    epicIssueExecutionById,
  );

  for (const executionId of epicIssueExecutionIds) {
    const execution = epicIssueExecutionById[executionId];
    if (!execution) {
      continue;
    }
    epicIssueExecutionIdsByRunId[execution.runId] = [
      ...(epicIssueExecutionIdsByRunId[execution.runId] ?? EMPTY_EPIC_ISSUE_EXECUTION_IDS),
      executionId,
    ];
  }

  return {
    epicIssueExecutionIds,
    epicIssueExecutionIdsByRunId,
    epicIssueExecutionById,
  };
}

export function applyEpicOrchestrationEvent(
  state: EnvironmentState,
  event: OrchestrationEvent,
): EnvironmentState | null {
  switch (event.type) {
    case "epic-run.requested":
      return writeEpicRunState(state, createRequestedEpicRun(event.payload));
    case "epic-run.started":
      return updateEpicRunState(state, event.payload.runId, (run) =>
        applyEpicRunLifecycleEvent(run, event),
      );
    case "epic-run.failed":
      return updateEpicRunState(state, event.payload.runId, (run) => {
        const fallbackExecution = findLatestFailedEpicIssueExecutionForRun(
          state,
          event.payload.runId,
        );
        return applyEpicRunLifecycleEvent(run, {
          ...event,
          payload: {
            ...event.payload,
            issueId: event.payload.issueId ?? fallbackExecution?.issueId ?? null,
            executionId: event.payload.executionId ?? fallbackExecution?.executionId ?? null,
            workerThreadId:
              event.payload.workerThreadId ?? fallbackExecution?.workerThreadId ?? null,
          },
        });
      });
    case "epic-run.stopped":
    case "epic-run.completed":
      return updateEpicRunState(state, event.payload.runId, (run) =>
        applyEpicRunLifecycleEvent(run, event),
      );
    case "epic-issue-execution.requested":
      return writeEpicIssueExecutionState(
        touchEpicRunUpdatedAt(state, event.payload.runId, event.payload.updatedAt),
        createRequestedEpicIssueExecution(event.payload),
      );
    case "epic-issue-execution.started":
      return writeEpicIssueExecutionState(
        touchEpicRunUpdatedAt(state, event.payload.runId, event.payload.updatedAt),
        materializeStartedEpicIssueExecution({
          event,
          existingExecution: state.epicIssueExecutionById[event.payload.executionId] ?? null,
        }),
      );
    case "epic-issue-execution.completed":
    case "epic-issue-execution.failed":
    case "epic-issue-execution.stopped": {
      const nextState = touchEpicRunUpdatedAt(state, event.payload.runId, event.payload.updatedAt);
      const execution = nextState.epicIssueExecutionById[event.payload.executionId];
      return execution
        ? writeEpicIssueExecutionState(
            nextState,
            applyEpicIssueExecutionLifecycleEvent(execution, event),
          )
        : nextState;
    }
    default:
      return null;
  }
}

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEpicRunsAcrossEnvironments(state: AppState): OrchestrationEpicRun[] {
  return getEnvironmentEntries(state)
    .flatMap(([, environmentState]) => getEpicRuns(environmentState))
    .toSorted(compareEpicRunsByRequestedAtDesc);
}

export function selectEpicIssueExecutionsAcrossEnvironments(
  state: AppState,
): OrchestrationEpicIssueExecution[] {
  return getEnvironmentEntries(state)
    .flatMap(([, environmentState]) => getEpicIssueExecutions(environmentState))
    .toSorted(compareEpicIssueExecutions);
}

export function selectEpicRunsForProject(
  state: AppState,
  projectId: ProjectId | null | undefined,
): OrchestrationEpicRun[] {
  if (!projectId) {
    return [];
  }

  return getEnvironmentEntries(state)
    .flatMap(([, environmentState]) => {
      const runIds = environmentState.epicRunIdsByProjectId[projectId] ?? EMPTY_EPIC_RUN_IDS;
      return runIds.flatMap((runId) => {
        const run = environmentState.epicRunById[runId];
        return run ? [run] : [];
      });
    })
    .toSorted(compareEpicRunsByRequestedAtDesc);
}

export function selectEpicIssueExecutionsForRun(
  state: AppState,
  runId: OrchestrationEpicRun["runId"] | null | undefined,
): OrchestrationEpicIssueExecution[] {
  if (!runId) {
    return [];
  }

  return getEnvironmentEntries(state)
    .flatMap(([, environmentState]) => {
      const executionIds =
        environmentState.epicIssueExecutionIdsByRunId[runId] ?? EMPTY_EPIC_ISSUE_EXECUTION_IDS;
      return executionIds.flatMap((executionId) => {
        const execution = environmentState.epicIssueExecutionById[executionId];
        return execution ? [execution] : [];
      });
    })
    .toSorted(compareEpicIssueExecutions);
}
