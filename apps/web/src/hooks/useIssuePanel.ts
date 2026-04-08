import type {
  ThreadId,
  BeadsIssueSummary,
  BeadsSwarmSummary,
  OrchestrationSwarmRun,
} from "@t3tools/contracts";
import { useMemo, useCallback, useEffect } from "react";
import {
  useIssuePaneStore,
  getIssuePaneState,
  getIssuesState,
  getCoordinatorState,
  getUIState,
  type IssuePanePanelTab,
  type IssuePaneScope,
  type ThreadIssuesState,
  type ThreadCoordinatorState,
  type ThreadUIState,
} from "~/issuePaneStore";
import { groupIssuesByEpic, partitionCoordinatorSwarms, type EpicGroup } from "~/issuePanel";

// ── Core Issue Panel Hook ──────────────────────────────────────────────

export interface UseIssuePanelReturn {
  // State
  activeTab: IssuePanePanelTab;
  selectedIssueId: string | null;
  search: string;
  scope: IssuePaneScope;

  // Enhanced state access
  issuesState: ThreadIssuesState;
  coordinatorState: ThreadCoordinatorState;
  uiState: ThreadUIState;

  // Actions
  setActiveTab: (tab: IssuePanePanelTab) => void;
  setSelectedIssueId: (issueId: string | null) => void;
  setSearch: (search: string) => void;
  setScope: (scope: IssuePaneScope) => void;

  // Enhanced actions
  actions: {
    issues: ReturnType<typeof useIssuesActions>;
    coordinator: ReturnType<typeof useCoordinatorActions>;
    ui: ReturnType<typeof useUIActions>;
  };

  // Batch update functions
  batchUpdateIssues: (updates: Partial<ThreadIssuesState>) => void;
  batchUpdateCoordinator: (updates: Partial<ThreadCoordinatorState>) => void;
  batchUpdateUI: (updates: Partial<ThreadUIState>) => void;

  // Reset functions
  resetState: () => void;
  resetIssuesState: () => void;
  resetCoordinatorState: () => void;
  resetUIState: () => void;
}

/**
 * Main hook for managing issue panel state across all tabs and contexts.
 * Provides both legacy compatibility and enhanced modular state management.
 */
export function useIssuePanel(threadId: ThreadId): UseIssuePanelReturn {
  const store = useIssuePaneStore();

  // Get current state
  const state = useMemo(() => getIssuePaneState(threadId), [threadId]);
  const issuesState = useMemo(() => getIssuesState(threadId), [threadId]);
  const coordinatorState = useMemo(() => getCoordinatorState(threadId), [threadId]);
  const uiState = useMemo(() => getUIState(threadId), [threadId]);

  // Core actions
  const setActiveTab = useCallback(
    (tab: IssuePanePanelTab) => store.setActivePanelTab(threadId, tab),
    [store, threadId],
  );

  const setSelectedIssueId = useCallback(
    (issueId: string | null) => store.setSelectedIssueId(threadId, issueId),
    [store, threadId],
  );

  const setSearch = useCallback(
    (search: string) => store.setSearch(threadId, search),
    [store, threadId],
  );

  const setScope = useCallback(
    (scope: IssuePaneScope) => store.setScope(threadId, scope),
    [store, threadId],
  );

  // Enhanced action hooks
  const issuesActions = useIssuesActions(threadId);
  const coordinatorActions = useCoordinatorActions(threadId);
  const uiActions = useUIActions(threadId);

  // Batch update functions
  const batchUpdateIssues = useCallback(
    (updates: Partial<ThreadIssuesState>) => store.batchUpdateIssuesState(threadId, updates),
    [store, threadId],
  );

  const batchUpdateCoordinator = useCallback(
    (updates: Partial<ThreadCoordinatorState>) =>
      store.batchUpdateCoordinatorState(threadId, updates),
    [store, threadId],
  );

  const batchUpdateUI = useCallback(
    (updates: Partial<ThreadUIState>) => store.batchUpdateUIState(threadId, updates),
    [store, threadId],
  );

  // Reset functions
  const resetState = useCallback(() => store.resetThreadState(threadId), [store, threadId]);

  const resetIssuesState = useCallback(() => store.resetIssuesState(threadId), [store, threadId]);

  const resetCoordinatorState = useCallback(
    () => store.resetCoordinatorState(threadId),
    [store, threadId],
  );

  const resetUIState = useCallback(() => store.resetUIState(threadId), [store, threadId]);

  return {
    // State
    activeTab: state.activePanelTab,
    selectedIssueId: state.selectedIssueId,
    search: state.search,
    scope: state.scope,

    // Enhanced state access
    issuesState,
    coordinatorState,
    uiState,

    // Actions
    setActiveTab,
    setSelectedIssueId,
    setSearch,
    setScope,

    // Enhanced actions
    actions: {
      issues: issuesActions,
      coordinator: coordinatorActions,
      ui: uiActions,
    },

    // Batch update functions
    batchUpdateIssues,
    batchUpdateCoordinator,
    batchUpdateUI,

    // Reset functions
    resetState,
    resetIssuesState,
    resetCoordinatorState,
    resetUIState,
  };
}

// ── Issues-specific Actions Hook ────────────────────────────────────────

export function useIssuesActions(threadId: ThreadId) {
  const store = useIssuePaneStore();

  return useMemo(
    () => ({
      setSearchQuery: (query: string) => store.setIssuesSearchQuery(threadId, query),
      setScopeFilter: (scope: IssuePaneScope) => store.setIssuesScopeFilter(threadId, scope),
      setSelectedLabels: (labels: readonly string[]) =>
        store.setIssuesSelectedLabels(threadId, labels),
      setSorting: (
        sortBy: ThreadIssuesState["sortBy"],
        direction: ThreadIssuesState["sortDirection"],
      ) => store.setIssuesSorting(threadId, sortBy, direction),
      setGroupBy: (groupBy: ThreadIssuesState["groupBy"]) =>
        store.setIssuesGroupBy(threadId, groupBy),
      setViewMode: (viewMode: ThreadIssuesState["viewMode"]) =>
        store.setIssuesViewMode(threadId, viewMode),
      toggleFilters: () => store.toggleIssuesFilters(threadId),

      // Convenience actions
      addSelectedLabel: (label: string) => {
        const state = getIssuesState(threadId);
        if (!state.selectedLabels.includes(label)) {
          store.setIssuesSelectedLabels(threadId, [...state.selectedLabels, label]);
        }
      },

      removeSelectedLabel: (label: string) => {
        const state = getIssuesState(threadId);
        store.setIssuesSelectedLabels(
          threadId,
          state.selectedLabels.filter((l) => l !== label),
        );
      },

      clearSelectedLabels: () => store.setIssuesSelectedLabels(threadId, []),

      toggleSortDirection: () => {
        const state = getIssuesState(threadId);
        const newDirection = state.sortDirection === "asc" ? "desc" : "asc";
        store.setIssuesSorting(threadId, state.sortBy, newDirection);
      },
    }),
    [store, threadId],
  );
}

// ── Coordinator-specific Actions Hook ───────────────────────────────────

export function useCoordinatorActions(threadId: ThreadId) {
  const store = useIssuePaneStore();

  return useMemo(
    () => ({
      setSelectedEpicId: (epicId: string | null) =>
        store.setCoordinatorSelectedEpicId(threadId, epicId),
      setShowOnlyActive: (show: boolean) => store.setCoordinatorShowOnlyActive(threadId, show),
      toggleAutoRefresh: () => store.toggleCoordinatorAutoRefresh(threadId),
      setRefreshInterval: (interval: number) =>
        store.setCoordinatorRefreshInterval(threadId, interval),
      toggleSwarmDetails: () => store.toggleCoordinatorSwarmDetails(threadId),
      setExpandedSwarms: (swarmIds: readonly string[]) =>
        store.setCoordinatorExpandedSwarms(threadId, swarmIds),
      toggleSwarmExpanded: (swarmId: string) =>
        store.toggleCoordinatorSwarmExpanded(threadId, swarmId),

      // Convenience actions
      expandAllSwarms: (swarmIds: string[]) =>
        store.setCoordinatorExpandedSwarms(threadId, swarmIds),
      collapseAllSwarms: () => store.setCoordinatorExpandedSwarms(threadId, []),
    }),
    [store, threadId],
  );
}

// ── UI-specific Actions Hook ────────────────────────────────────────────

export function useUIActions(threadId: ThreadId) {
  const store = useIssuePaneStore();

  return useMemo(
    () => ({
      setSidebarCollapsed: (collapsed: boolean) => store.setSidebarCollapsed(threadId, collapsed),
      setDetailPanelWidth: (width: number) => store.setDetailPanelWidth(threadId, width),
      setLoadingState: (actionType: string, loading: boolean) =>
        store.setLoadingState(threadId, actionType, loading),
      setErrorMessage: (actionType: string, error: string | null) =>
        store.setErrorMessage(threadId, actionType, error),
      updateLastRefreshTime: () => store.updateLastRefreshTime(threadId),
      clearAllErrors: () => store.clearAllErrors(threadId),

      // Convenience actions
      toggleSidebar: () => {
        const state = getUIState(threadId);
        store.setSidebarCollapsed(threadId, !state.sidebarCollapsed);
      },

      setError: (actionType: string, error: string) =>
        store.setErrorMessage(threadId, actionType, error),
      clearError: (actionType: string) => store.setErrorMessage(threadId, actionType, null),

      withLoading: async <T>(actionType: string, asyncFn: () => Promise<T>): Promise<T> => {
        store.setLoadingState(threadId, actionType, true);
        store.setErrorMessage(threadId, actionType, null);
        try {
          const result = await asyncFn();
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          store.setErrorMessage(threadId, actionType, message);
          throw error;
        } finally {
          store.setLoadingState(threadId, actionType, false);
        }
      },
    }),
    [store, threadId],
  );
}

// ── Computed State Hooks ────────────────────────────────────────────────

export interface UseFilteredIssuesOptions {
  issues: readonly BeadsIssueSummary[];
  searchQuery?: string;
  scopeFilter?: IssuePaneScope;
  selectedLabels?: readonly string[];
  sortBy?: ThreadIssuesState["sortBy"];
  sortDirection?: ThreadIssuesState["sortDirection"];
}

export function useFilteredIssues(
  threadId: ThreadId,
  options: UseFilteredIssuesOptions,
): {
  filteredIssues: readonly BeadsIssueSummary[];
  totalCount: number;
  epicGroups: readonly EpicGroup[];
} {
  const issuesState = useMemo(() => getIssuesState(threadId), [threadId]);

  return useMemo(() => {
    const {
      issues,
      searchQuery = issuesState.searchQuery,
      scopeFilter = issuesState.scopeFilter,
      selectedLabels = issuesState.selectedLabels,
      sortBy = issuesState.sortBy,
      sortDirection = issuesState.sortDirection,
    } = options;

    let filtered = [...issues];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          issue.description?.toLowerCase().includes(query) ||
          issue.labels?.some((label) => label.toLowerCase().includes(query)),
      );
    }

    // Apply scope filter
    if (scopeFilter !== "all") {
      filtered = filtered.filter((issue) => {
        switch (scopeFilter) {
          case "active":
            return issue.status === "open";
          case "closed":
            return issue.status === "closed";
          default:
            return true;
        }
      });
    }

    // Apply label filter
    if (selectedLabels.length > 0) {
      filtered = filtered.filter((issue) =>
        selectedLabels.some((selectedLabel) =>
          issue.labels?.some((label) => label === selectedLabel),
        ),
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "created":
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "updated":
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
        default:
          comparison = 0;
      }

      return sortDirection === "desc" ? -comparison : comparison;
    });

    const epicGroups = groupIssuesByEpic(filtered);

    return {
      filteredIssues: filtered,
      totalCount: issues.length,
      epicGroups,
    };
  }, [options, issuesState]);
}

export interface UseCoordinatorSummaryOptions {
  swarms: readonly BeadsSwarmSummary[];
  swarmRuns?: readonly OrchestrationSwarmRun[];
  showOnlyActive?: boolean;
}

export function useCoordinatorSummary(threadId: ThreadId, options: UseCoordinatorSummaryOptions) {
  const coordinatorState = useMemo(() => getCoordinatorState(threadId), [threadId]);

  return useMemo(() => {
    const { swarms, showOnlyActive = coordinatorState.showOnlyActive } = options;

    let filteredSwarms = [...swarms];

    if (showOnlyActive) {
      filteredSwarms = filteredSwarms.filter((swarm) => swarm.activeWorkerCount > 0);
    }

    const swarmSections = partitionCoordinatorSwarms(filteredSwarms);
    const totalActiveWorkers = swarms.reduce((sum, swarm) => sum + swarm.activeWorkerCount, 0);
    const totalReadyIssues = swarms.reduce((sum, swarm) => sum + swarm.readyIssueCount, 0);

    return {
      sections: swarmSections,
      totalActiveWorkers,
      totalReadyIssues,
      hasActivity: totalActiveWorkers > 0 || totalReadyIssues > 0,
      filteredSwarms,
    };
  }, [options, coordinatorState]);
}

// ── Auto-refresh Hook ───────────────────────────────────────────────────

export function useAutoRefresh(
  threadId: ThreadId,
  refreshFn: () => void | Promise<void>,
  enabled?: boolean,
) {
  const coordinatorState = useMemo(() => getCoordinatorState(threadId), [threadId]);
  const shouldRefresh = enabled ?? coordinatorState.autoRefresh;
  const interval = coordinatorState.refreshInterval * 1000; // Convert to milliseconds

  useEffect(() => {
    if (!shouldRefresh) return;

    const intervalId = setInterval(() => {
      void refreshFn();
    }, interval);

    return () => clearInterval(intervalId);
  }, [shouldRefresh, interval, refreshFn]);
}
