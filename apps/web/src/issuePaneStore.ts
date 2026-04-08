import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type IssuePanePanelTab = "issues" | "coordinator";
export type IssuePaneScope = "active" | "all" | "closed";

// ── Core Issue Pane State ──────────────────────────────────────────────

interface ThreadIssuePaneState {
  readonly activePanelTab: IssuePanePanelTab;
  readonly selectedIssueId: string | null;
  readonly search: string;
  readonly scope: IssuePaneScope;
}

// ── Issues-specific State ──────────────────────────────────────────────

interface ThreadIssuesState {
  readonly searchQuery: string;
  readonly scopeFilter: IssuePaneScope;
  readonly selectedLabels: readonly string[];
  readonly sortBy: "updated" | "created" | "title" | "status";
  readonly sortDirection: "asc" | "desc";
  readonly groupBy: "none" | "status" | "labels" | "epic" | "assignee";
  readonly showFilters: boolean;
  readonly viewMode: "list" | "compact" | "cards";
}

// ── Coordinator-specific State ──────────────────────────────────────────

interface ThreadCoordinatorState {
  readonly selectedEpicId: string | null;
  readonly showOnlyActive: boolean;
  readonly autoRefresh: boolean;
  readonly refreshInterval: number; // in seconds
  readonly showSwarmDetails: boolean;
  readonly expandedSwarmIds: readonly string[];
}

// ── UI State Management ─────────────────────────────────────────────────

interface ThreadUIState {
  readonly sidebarCollapsed: boolean;
  readonly detailPanelWidth: number;
  readonly lastRefreshTime: number | null;
  readonly loadingStates: Record<string, boolean>; // keyed by action type
  readonly errorMessages: Record<string, string | null>; // keyed by action type
}

// ── Combined Thread State ───────────────────────────────────────────────

interface EnhancedThreadIssuePaneState {
  // Legacy compatibility
  readonly activePanelTab: IssuePanePanelTab;
  readonly selectedIssueId: string | null;
  readonly search: string;
  readonly scope: IssuePaneScope;

  // Enhanced modular state
  readonly issues: ThreadIssuesState;
  readonly coordinator: ThreadCoordinatorState;
  readonly ui: ThreadUIState;
}

// ── Store Interface ─────────────────────────────────────────────────────

interface IssuePaneStoreState {
  readonly byThreadId: Record<string, EnhancedThreadIssuePaneState>;

  // Legacy actions (maintained for backward compatibility)
  readonly setActivePanelTab: (threadId: ThreadId, tab: IssuePanePanelTab) => void;
  readonly setSelectedIssueId: (threadId: ThreadId, issueId: string | null) => void;
  readonly setSearch: (threadId: ThreadId, search: string) => void;
  readonly setScope: (threadId: ThreadId, scope: IssuePaneScope) => void;

  // Enhanced actions - Issues
  readonly setIssuesSearchQuery: (threadId: ThreadId, query: string) => void;
  readonly setIssuesScopeFilter: (threadId: ThreadId, scope: IssuePaneScope) => void;
  readonly setIssuesSelectedLabels: (threadId: ThreadId, labels: readonly string[]) => void;
  readonly setIssuesSorting: (
    threadId: ThreadId,
    sortBy: ThreadIssuesState["sortBy"],
    direction: ThreadIssuesState["sortDirection"],
  ) => void;
  readonly setIssuesGroupBy: (threadId: ThreadId, groupBy: ThreadIssuesState["groupBy"]) => void;
  readonly setIssuesViewMode: (threadId: ThreadId, viewMode: ThreadIssuesState["viewMode"]) => void;
  readonly toggleIssuesFilters: (threadId: ThreadId) => void;

  // Enhanced actions - Coordinator
  readonly setCoordinatorSelectedEpicId: (threadId: ThreadId, epicId: string | null) => void;
  readonly setCoordinatorShowOnlyActive: (threadId: ThreadId, showOnlyActive: boolean) => void;
  readonly toggleCoordinatorAutoRefresh: (threadId: ThreadId) => void;
  readonly setCoordinatorRefreshInterval: (threadId: ThreadId, interval: number) => void;
  readonly toggleCoordinatorSwarmDetails: (threadId: ThreadId) => void;
  readonly setCoordinatorExpandedSwarms: (threadId: ThreadId, swarmIds: readonly string[]) => void;
  readonly toggleCoordinatorSwarmExpanded: (threadId: ThreadId, swarmId: string) => void;

  // Enhanced actions - UI
  readonly setSidebarCollapsed: (threadId: ThreadId, collapsed: boolean) => void;
  readonly setDetailPanelWidth: (threadId: ThreadId, width: number) => void;
  readonly setLoadingState: (threadId: ThreadId, actionType: string, loading: boolean) => void;
  readonly setErrorMessage: (threadId: ThreadId, actionType: string, error: string | null) => void;
  readonly updateLastRefreshTime: (threadId: ThreadId) => void;
  readonly clearAllErrors: (threadId: ThreadId) => void;

  // Batch actions for performance
  readonly batchUpdateIssuesState: (
    threadId: ThreadId,
    updates: Partial<ThreadIssuesState>,
  ) => void;
  readonly batchUpdateCoordinatorState: (
    threadId: ThreadId,
    updates: Partial<ThreadCoordinatorState>,
  ) => void;
  readonly batchUpdateUIState: (threadId: ThreadId, updates: Partial<ThreadUIState>) => void;

  // Reset actions
  readonly resetThreadState: (threadId: ThreadId) => void;
  readonly resetIssuesState: (threadId: ThreadId) => void;
  readonly resetCoordinatorState: (threadId: ThreadId) => void;
  readonly resetUIState: (threadId: ThreadId) => void;
}

// ── Default States ──────────────────────────────────────────────────────

const DEFAULT_ISSUES_STATE: ThreadIssuesState = {
  searchQuery: "",
  scopeFilter: "active",
  selectedLabels: [],
  sortBy: "updated",
  sortDirection: "desc",
  groupBy: "none",
  showFilters: false,
  viewMode: "list",
};

const DEFAULT_COORDINATOR_STATE: ThreadCoordinatorState = {
  selectedEpicId: null,
  showOnlyActive: false,
  autoRefresh: false,
  refreshInterval: 30,
  showSwarmDetails: false,
  expandedSwarmIds: [],
};

const DEFAULT_UI_STATE: ThreadUIState = {
  sidebarCollapsed: false,
  detailPanelWidth: 400,
  lastRefreshTime: null,
  loadingStates: {},
  errorMessages: {},
};

const DEFAULT_ENHANCED_THREAD_STATE: EnhancedThreadIssuePaneState = {
  // Legacy compatibility
  activePanelTab: "issues",
  selectedIssueId: null,
  search: "",
  scope: "active",

  // Enhanced modular state
  issues: DEFAULT_ISSUES_STATE,
  coordinator: DEFAULT_COORDINATOR_STATE,
  ui: DEFAULT_UI_STATE,
};

// Legacy compatibility (kept for potential rollback)
const _DEFAULT_THREAD_STATE: ThreadIssuePaneState = {
  activePanelTab: "issues",
  selectedIssueId: null,
  search: "",
  scope: "active",
};

// ── State Update Utilities ──────────────────────────────────────────────

function updateThreadState(
  state: IssuePaneStoreState["byThreadId"],
  threadId: ThreadId,
  updater: (current: EnhancedThreadIssuePaneState) => EnhancedThreadIssuePaneState,
) {
  const key = threadId as string;
  const current = state[key] ?? DEFAULT_ENHANCED_THREAD_STATE;
  const next = updater(current);
  if (next === current) {
    return state;
  }
  return {
    ...state,
    [key]: next,
  };
}

function updateNestedState<K extends keyof EnhancedThreadIssuePaneState>(
  state: IssuePaneStoreState["byThreadId"],
  threadId: ThreadId,
  key: K,
  updater: (current: EnhancedThreadIssuePaneState[K]) => EnhancedThreadIssuePaneState[K],
) {
  return updateThreadState(state, threadId, (threadState) => {
    const currentNested = threadState[key];
    const nextNested = updater(currentNested);
    if (nextNested === currentNested) {
      return threadState;
    }
    return {
      ...threadState,
      [key]: nextNested,
    };
  });
}

// ── Store Implementation ────────────────────────────────────────────────

export const useIssuePaneStore = create<IssuePaneStoreState>()(
  subscribeWithSelector((set) => ({
    byThreadId: {},

    // Legacy actions (backward compatibility)
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
        byThreadId: updateThreadState(state.byThreadId, threadId, (current) => {
          const updated = current.search === search ? current : { ...current, search };
          // Also update the enhanced search query for consistency
          return {
            ...updated,
            issues: {
              ...updated.issues,
              searchQuery: search,
            },
          };
        }),
      })),

    setScope: (threadId, scope) =>
      set((state) => ({
        byThreadId: updateThreadState(state.byThreadId, threadId, (current) => {
          const updated = current.scope === scope ? current : { ...current, scope };
          // Also update the enhanced scope filter for consistency
          return {
            ...updated,
            issues: {
              ...updated.issues,
              scopeFilter: scope,
            },
          };
        }),
      })),

    // Enhanced actions - Issues
    setIssuesSearchQuery: (threadId, query) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.searchQuery === query ? issues : { ...issues, searchQuery: query },
        ),
      })),

    setIssuesScopeFilter: (threadId, scopeFilter) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.scopeFilter === scopeFilter ? issues : { ...issues, scopeFilter },
        ),
      })),

    setIssuesSelectedLabels: (threadId, labels) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.selectedLabels === labels ? issues : { ...issues, selectedLabels: labels },
        ),
      })),

    setIssuesSorting: (threadId, sortBy, sortDirection) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.sortBy === sortBy && issues.sortDirection === sortDirection
            ? issues
            : { ...issues, sortBy, sortDirection },
        ),
      })),

    setIssuesGroupBy: (threadId, groupBy) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.groupBy === groupBy ? issues : { ...issues, groupBy },
        ),
      })),

    setIssuesViewMode: (threadId, viewMode) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) =>
          issues.viewMode === viewMode ? issues : { ...issues, viewMode },
        ),
      })),

    toggleIssuesFilters: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) => ({
          ...issues,
          showFilters: !issues.showFilters,
        })),
      })),

    // Enhanced actions - Coordinator
    setCoordinatorSelectedEpicId: (threadId, epicId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) =>
          coordinator.selectedEpicId === epicId
            ? coordinator
            : { ...coordinator, selectedEpicId: epicId },
        ),
      })),

    setCoordinatorShowOnlyActive: (threadId, showOnlyActive) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) =>
          coordinator.showOnlyActive === showOnlyActive
            ? coordinator
            : { ...coordinator, showOnlyActive },
        ),
      })),

    toggleCoordinatorAutoRefresh: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) => ({
          ...coordinator,
          autoRefresh: !coordinator.autoRefresh,
        })),
      })),

    setCoordinatorRefreshInterval: (threadId, interval) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) =>
          coordinator.refreshInterval === interval
            ? coordinator
            : { ...coordinator, refreshInterval: interval },
        ),
      })),

    toggleCoordinatorSwarmDetails: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) => ({
          ...coordinator,
          showSwarmDetails: !coordinator.showSwarmDetails,
        })),
      })),

    setCoordinatorExpandedSwarms: (threadId, swarmIds) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) =>
          coordinator.expandedSwarmIds === swarmIds
            ? coordinator
            : { ...coordinator, expandedSwarmIds: swarmIds },
        ),
      })),

    toggleCoordinatorSwarmExpanded: (threadId, swarmId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) => {
          const isExpanded = coordinator.expandedSwarmIds.includes(swarmId);
          const expandedSwarmIds = isExpanded
            ? coordinator.expandedSwarmIds.filter((id) => id !== swarmId)
            : [...coordinator.expandedSwarmIds, swarmId];
          return { ...coordinator, expandedSwarmIds };
        }),
      })),

    // Enhanced actions - UI
    setSidebarCollapsed: (threadId, collapsed) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) =>
          ui.sidebarCollapsed === collapsed ? ui : { ...ui, sidebarCollapsed: collapsed },
        ),
      })),

    setDetailPanelWidth: (threadId, width) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) =>
          ui.detailPanelWidth === width ? ui : { ...ui, detailPanelWidth: width },
        ),
      })),

    setLoadingState: (threadId, actionType, loading) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) => ({
          ...ui,
          loadingStates: {
            ...ui.loadingStates,
            [actionType]: loading,
          },
        })),
      })),

    setErrorMessage: (threadId, actionType, error) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) => ({
          ...ui,
          errorMessages: {
            ...ui.errorMessages,
            [actionType]: error,
          },
        })),
      })),

    updateLastRefreshTime: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) => ({
          ...ui,
          lastRefreshTime: Date.now(),
        })),
      })),

    clearAllErrors: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) => ({
          ...ui,
          errorMessages: {},
        })),
      })),

    // Batch actions for performance
    batchUpdateIssuesState: (threadId, updates) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "issues", (issues) => ({
          ...issues,
          ...updates,
        })),
      })),

    batchUpdateCoordinatorState: (threadId, updates) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "coordinator", (coordinator) => ({
          ...coordinator,
          ...updates,
        })),
      })),

    batchUpdateUIState: (threadId, updates) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", (ui) => ({
          ...ui,
          ...updates,
        })),
      })),

    // Reset actions
    resetThreadState: (threadId) =>
      set((state) => ({
        byThreadId: updateThreadState(
          state.byThreadId,
          threadId,
          () => DEFAULT_ENHANCED_THREAD_STATE,
        ),
      })),

    resetIssuesState: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(
          state.byThreadId,
          threadId,
          "issues",
          () => DEFAULT_ISSUES_STATE,
        ),
      })),

    resetCoordinatorState: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(
          state.byThreadId,
          threadId,
          "coordinator",
          () => DEFAULT_COORDINATOR_STATE,
        ),
      })),

    resetUIState: (threadId) =>
      set((state) => ({
        byThreadId: updateNestedState(state.byThreadId, threadId, "ui", () => DEFAULT_UI_STATE),
      })),
  })),
);

// ── Enhanced State Selectors ────────────────────────────────────────────

export function getIssuePaneState(threadId: ThreadId): EnhancedThreadIssuePaneState {
  return (
    useIssuePaneStore.getState().byThreadId[threadId as string] ?? DEFAULT_ENHANCED_THREAD_STATE
  );
}

// Legacy compatibility
export function getLegacyIssuePaneState(threadId: ThreadId): ThreadIssuePaneState {
  const enhanced = getIssuePaneState(threadId);
  return {
    activePanelTab: enhanced.activePanelTab,
    selectedIssueId: enhanced.selectedIssueId,
    search: enhanced.search,
    scope: enhanced.scope,
  };
}

export function getIssuesState(threadId: ThreadId): ThreadIssuesState {
  return getIssuePaneState(threadId).issues;
}

export function getCoordinatorState(threadId: ThreadId): ThreadCoordinatorState {
  return getIssuePaneState(threadId).coordinator;
}

export function getUIState(threadId: ThreadId): ThreadUIState {
  return getIssuePaneState(threadId).ui;
}

// ── Type Exports for External Use ───────────────────────────────────────

export type {
  ThreadIssuePaneState,
  EnhancedThreadIssuePaneState,
  ThreadIssuesState,
  ThreadCoordinatorState,
  ThreadUIState,
  IssuePaneStoreState,
};
