import type { BeadsIssueSortBy, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type IssueListSortBy = BeadsIssueSortBy;

export interface ThreadIssuePaneState {
  readonly selectedIssueId: string | null;
  readonly search: string;
  readonly showClosed: boolean;
  readonly sortBy: IssueListSortBy;
  readonly limit: number;
}

export const DEFAULT_ISSUE_LIST_LIMIT = 200;

interface IssuePaneStoreState {
  readonly byThreadId: Record<string, ThreadIssuePaneState>;
  readonly setSelectedIssueId: (threadId: ThreadId, issueId: string | null) => void;
  readonly setSearch: (threadId: ThreadId, search: string) => void;
  readonly setShowClosed: (threadId: ThreadId, showClosed: boolean) => void;
  readonly setSortBy: (threadId: ThreadId, sortBy: IssueListSortBy) => void;
  readonly showMore: (threadId: ThreadId) => void;
  readonly resetThreadState: (threadId: ThreadId) => void;
}

const DEFAULT_THREAD_ISSUE_PANE_STATE: ThreadIssuePaneState = {
  selectedIssueId: null,
  search: "",
  showClosed: false,
  sortBy: "updated",
  limit: DEFAULT_ISSUE_LIST_LIMIT,
};

function updateThreadState(
  state: IssuePaneStoreState["byThreadId"],
  threadId: ThreadId,
  updater: (current: ThreadIssuePaneState) => ThreadIssuePaneState,
) {
  const key = threadId as string;
  const current = state[key] ?? DEFAULT_THREAD_ISSUE_PANE_STATE;
  const next = updater(current);
  if (next === current) {
    return state;
  }
  return {
    ...state,
    [key]: next,
  };
}

export const useIssuePaneStore = create<IssuePaneStoreState>()((set) => ({
  byThreadId: {},
  setSelectedIssueId: (threadId, selectedIssueId) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.selectedIssueId === selectedIssueId ? current : { ...current, selectedIssueId },
      ),
    })),
  setSearch: (threadId, search) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.search === search
          ? current
          : { ...current, search, limit: DEFAULT_ISSUE_LIST_LIMIT },
      ),
    })),
  setShowClosed: (threadId, showClosed) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.showClosed === showClosed
          ? current
          : { ...current, showClosed, limit: DEFAULT_ISSUE_LIST_LIMIT },
      ),
    })),
  setSortBy: (threadId, sortBy) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) =>
        current.sortBy === sortBy
          ? current
          : { ...current, sortBy, limit: DEFAULT_ISSUE_LIST_LIMIT },
      ),
    })),
  showMore: (threadId) =>
    set((state) => ({
      byThreadId: updateThreadState(state.byThreadId, threadId, (current) => ({
        ...current,
        limit: current.limit + DEFAULT_ISSUE_LIST_LIMIT,
      })),
    })),
  resetThreadState: (threadId) =>
    set((state) => {
      const key = threadId as string;
      if (!(key in state.byThreadId)) {
        return state;
      }
      const next = { ...state.byThreadId };
      delete next[key];
      return { byThreadId: next };
    }),
}));

export function getIssuePaneState(threadId: ThreadId): ThreadIssuePaneState {
  return (
    useIssuePaneStore.getState().byThreadId[threadId as string] ?? DEFAULT_THREAD_ISSUE_PANE_STATE
  );
}
