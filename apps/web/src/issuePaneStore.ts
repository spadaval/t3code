import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type IssuePanePanelTab = "issues" | "coordinator";
export type IssuePaneScope = "active" | "all" | "closed";

interface ThreadIssuePaneState {
  readonly activePanelTab: IssuePanePanelTab;
  readonly selectedIssueId: string | null;
  readonly search: string;
  readonly scope: IssuePaneScope;
}

interface IssuePaneStoreState {
  readonly byThreadId: Record<string, ThreadIssuePaneState>;
  readonly setActivePanelTab: (threadId: ThreadId, tab: IssuePanePanelTab) => void;
  readonly setSelectedIssueId: (threadId: ThreadId, issueId: string | null) => void;
  readonly setSearch: (threadId: ThreadId, search: string) => void;
  readonly setScope: (threadId: ThreadId, scope: IssuePaneScope) => void;
}

const DEFAULT_THREAD_STATE: ThreadIssuePaneState = {
  activePanelTab: "issues",
  selectedIssueId: null,
  search: "",
  scope: "active",
};

function updateThreadState(
  state: IssuePaneStoreState["byThreadId"],
  threadId: ThreadId,
  updater: (current: ThreadIssuePaneState) => ThreadIssuePaneState,
) {
  const key = threadId as string;
  const current = state[key] ?? DEFAULT_THREAD_STATE;
  const next = updater(current);
  if (next === current) {
    return state;
  }
  return {
    ...state,
    [key]: next,
  };
}

export const useIssuePaneStore = create<IssuePaneStoreState>((set) => ({
  byThreadId: {},
  setActivePanelTab: (threadId, activePanelTab) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.activePanelTab === activePanelTab ? current : { ...current, activePanelTab },
      ),
    })),
  setSelectedIssueId: (threadId, selectedIssueId) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.selectedIssueId === selectedIssueId ? current : { ...current, selectedIssueId },
      ),
    })),
  setSearch: (threadId, search) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.search === search ? current : { ...current, search },
      ),
    })),
  setScope: (threadId, scope) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.scope === scope ? current : { ...current, scope },
      ),
    })),
}));

export function getIssuePaneState(threadId: ThreadId): ThreadIssuePaneState {
  return useIssuePaneStore.getState().byThreadId[threadId as string] ?? DEFAULT_THREAD_STATE;
}
