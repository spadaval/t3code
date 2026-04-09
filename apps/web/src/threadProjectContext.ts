import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";

import { useComposerDraftStore, type DraftThreadState } from "./composerDraftStore";
import { useProjectById, useThreadById } from "./storeSelectors";
import type { Project, Thread } from "./types";

export interface ThreadProjectContext {
  readonly thread: Thread | undefined;
  readonly draftThread: DraftThreadState | null;
  readonly projectId: ProjectId | null;
  readonly project: Project | undefined;
}

export function resolveThreadProjectContext(input: {
  thread: Thread | undefined;
  draftThread: DraftThreadState | null;
  project: Project | undefined;
}): ThreadProjectContext {
  const projectId = input.thread?.projectId ?? input.draftThread?.projectId ?? null;

  return {
    thread: input.thread,
    draftThread: input.draftThread,
    projectId,
    project: input.project,
  };
}

export function useThreadProjectContext(threadId: ThreadId): ThreadProjectContext {
  const thread = useThreadById(threadId);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const projectId = thread?.projectId ?? draftThread?.projectId ?? null;
  const project = useProjectById(projectId);

  return useMemo(
    () =>
      resolveThreadProjectContext({
        thread,
        draftThread,
        project,
      }),
    [draftThread, project, thread],
  );
}
