import type {
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";
import {
  selectEnvironmentState,
  selectEpicIssueExecutionsForRun as selectEpicIssueExecutionsForRunFromStore,
  selectEpicRunsForProject as selectEpicRunsForProjectFromStore,
  type AppState,
  type EnvironmentState,
} from "./store";
import { type Project, type Thread } from "./types";
import { getThreadFromEnvironmentState } from "./threadDerivation";
import { useStore } from "./store";

type EpicRunSelectorEntry = readonly [
  EnvironmentState,
  ReadonlyArray<OrchestrationEpicRun["runId"]> | undefined,
];
type EpicIssueExecutionSelectorEntry = readonly [
  EnvironmentState,
  ReadonlyArray<OrchestrationEpicIssueExecution["executionId"]> | undefined,
];

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

function createScopedThreadSelector(
  resolveRef: (state: AppState) => ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousThreadId: ThreadId | undefined;
  let previousThread: Thread | undefined;

  return (state) => {
    const ref = resolveRef(state);
    if (!ref) {
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    if (
      previousThread &&
      previousEnvironmentState === environmentState &&
      previousThreadId === ref.threadId
    ) {
      return previousThread;
    }

    previousEnvironmentState = environmentState;
    previousThreadId = ref.threadId;
    previousThread = getThreadFromEnvironmentState(environmentState, ref.threadId);
    return previousThread;
  };
}

export function createThreadSelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector(() => ref);
}

export function createThreadSelectorAcrossEnvironments(
  threadId: ThreadId | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector((state) => {
    if (!threadId) {
      return undefined;
    }

    for (const [environmentId, environmentState] of Object.entries(
      state.environmentStateById,
    ) as Array<[ScopedThreadRef["environmentId"], EnvironmentState]>) {
      if (environmentState.threadShellById[threadId]) {
        return {
          environmentId,
          threadId,
        };
      }
    }
    return undefined;
  });
}

export function createProjectSelectorAcrossEnvironments(
  projectId: string | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) => {
    if (!projectId) {
      return undefined;
    }

    for (const environmentState of Object.values(state.environmentStateById)) {
      const project =
        environmentState.projectById[projectId as keyof typeof environmentState.projectById];
      if (project) {
        return project;
      }
    }

    return undefined;
  };
}

export function createEpicRunsSelectorForProject(
  projectId: ProjectId | null | undefined,
): (state: AppState) => OrchestrationEpicRun[] {
  let previousEnvironmentEntries: ReadonlyArray<EpicRunSelectorEntry> | undefined;
  let previousRuns: OrchestrationEpicRun[] = [];

  return (state) => {
    if (!projectId) {
      return [];
    }

    const environmentEntries: EpicRunSelectorEntry[] = [];
    for (const environmentState of Object.values(state.environmentStateById)) {
      const runIds = environmentState.epicRunIdsByProjectId[projectId];
      if (runIds) {
        environmentEntries.push([environmentState, runIds] as const);
      }
    }

    if (
      previousEnvironmentEntries &&
      previousEnvironmentEntries.length === environmentEntries.length &&
      environmentEntries.every(
        ([environmentState, runIds], index) =>
          previousEnvironmentEntries?.[index]?.[0] === environmentState &&
          previousEnvironmentEntries?.[index]?.[1] === runIds,
      )
    ) {
      return previousRuns;
    }

    previousEnvironmentEntries = environmentEntries;
    previousRuns = selectEpicRunsForProjectFromStore(state, projectId);
    return previousRuns;
  };
}

export function createEpicIssueExecutionsSelectorForRun(
  runId: OrchestrationEpicRun["runId"] | null | undefined,
): (state: AppState) => OrchestrationEpicIssueExecution[] {
  let previousEnvironmentEntries: ReadonlyArray<EpicIssueExecutionSelectorEntry> | undefined;
  let previousExecutions: OrchestrationEpicIssueExecution[] = [];

  return (state) => {
    if (!runId) {
      return [];
    }

    const environmentEntries: EpicIssueExecutionSelectorEntry[] = [];
    for (const environmentState of Object.values(state.environmentStateById)) {
      const executionIds = environmentState.epicIssueExecutionIdsByRunId[runId];
      if (executionIds) {
        environmentEntries.push([environmentState, executionIds] as const);
      }
    }

    if (
      previousEnvironmentEntries &&
      previousEnvironmentEntries.length === environmentEntries.length &&
      environmentEntries.every(
        ([environmentState, executionIds], index) =>
          previousEnvironmentEntries?.[index]?.[0] === environmentState &&
          previousEnvironmentEntries?.[index]?.[1] === executionIds,
      )
    ) {
      return previousExecutions;
    }

    previousEnvironmentEntries = environmentEntries;
    previousExecutions = selectEpicIssueExecutionsForRunFromStore(state, runId);
    return previousExecutions;
  };
}

export function useProjectById(projectId: string | null | undefined): Project | undefined {
  return useStore(useMemo(() => createProjectSelectorAcrossEnvironments(projectId), [projectId]));
}

export function useEpicRunsForProject(
  projectId: ProjectId | null | undefined,
): OrchestrationEpicRun[] {
  return useStore(useMemo(() => createEpicRunsSelectorForProject(projectId), [projectId]));
}

export function useEpicIssueExecutionsForRun(
  runId: OrchestrationEpicRun["runId"] | null | undefined,
): OrchestrationEpicIssueExecution[] {
  return useStore(useMemo(() => createEpicIssueExecutionsSelectorForRun(runId), [runId]));
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  return useStore(useMemo(() => createThreadSelectorAcrossEnvironments(threadId), [threadId]));
}

export function useWorkerThreadState(threadId: ThreadId | null | undefined) {
  const thread = useThreadById(threadId);
  return useMemo(() => {
    if (!thread) {
      return undefined;
    }
    return {
      environmentId: thread.environmentId,
      activities: thread.activities,
      session: thread.session,
      turnDiffSummaries: thread.turnDiffSummaries,
    };
  }, [thread]);
}
