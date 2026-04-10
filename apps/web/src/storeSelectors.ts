import { type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import {
  selectProjectById,
  selectSidebarThreadSummaryById,
  selectThreadById,
  useStore,
} from "./store";
import { type Project, type SidebarThreadSummary, type Thread } from "./types";

export function useProjectById(projectId: Project["id"] | null | undefined): Project | undefined {
  const selector = useMemo(() => selectProjectById(projectId), [projectId]);
  return useStore(selector);
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  const selector = useMemo(() => selectThreadById(threadId), [threadId]);
  return useStore(selector);
}

export function useSidebarThreadSummaryById(
  threadId: ThreadId | null | undefined,
): SidebarThreadSummary | undefined {
  const selector = useMemo(() => selectSidebarThreadSummaryById(threadId), [threadId]);
  return useStore(selector);
}

/**
 * Select a worker thread's activities and session state by its thread ID.
 * Returns undefined if the thread is not found in the store.
 */
export function useWorkerThreadState(threadId: ThreadId | null | undefined) {
  const thread = useThreadById(threadId);
  return useMemo(() => {
    if (!thread) return undefined;
    return {
      activities: thread.activities,
      session: thread.session,
      turnDiffSummaries: thread.turnDiffSummaries,
    };
  }, [thread]);
}
