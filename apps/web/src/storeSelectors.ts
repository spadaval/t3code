import { type ScopedProjectRef, type ScopedThreadRef, type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { selectEnvironmentState, type AppState, type EnvironmentState } from "./store";
import { type Project, type SidebarThreadSummary, type Thread } from "./types";
import { getThreadFromEnvironmentState } from "./threadDerivation";
import { useStore } from "./store";

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

export function createSidebarThreadSummarySelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => SidebarThreadSummary | undefined {
  return (state) =>
    ref
      ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
      : undefined;
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

export function useProjectById(projectId: string | null | undefined): Project | undefined {
  return useStore(useMemo(() => createProjectSelectorAcrossEnvironments(projectId), [projectId]));
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
