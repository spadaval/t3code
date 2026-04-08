import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadId, type BeadsIssueSummary } from "@t3tools/contracts";
import {
  useIssuePaneStore,
  getIssuePaneState,
  getIssuesState,
  getCoordinatorState,
  getUIState,
} from "~/issuePaneStore";

// ── Test Setup ──────────────────────────────────────────────────────────

const THREAD_ID = ThreadId.makeUnsafe("test-thread-1");

const _SAMPLE_ISSUES: readonly BeadsIssueSummary[] = [
  {
    id: "issue-1",
    title: "Test Issue 1",
    description: "Test description",
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: new Date("2024-01-01").toISOString(),
    createdBy: null,
    updatedAt: new Date("2024-01-02").toISOString(),
    labels: ["bug", "high-priority"],
    parent: { id: "epic-1", title: "Epic 1" },
  },
  {
    id: "issue-2",
    title: "Test Issue 2",
    description: "Another description",
    notes: null,
    status: "open",
    priority: null,
    issueType: "feature",
    assignee: null,
    owner: null,
    createdAt: new Date("2024-01-02").toISOString(),
    createdBy: null,
    updatedAt: new Date("2024-01-03").toISOString(),
    labels: ["feature"],
    parent: null,
  },
];

describe("Issue Panel Store Integration", () => {
  beforeEach(() => {
    // Reset store state before each test
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("provides default state for new thread", () => {
    const state = getIssuePaneState(THREAD_ID);

    expect(state.activePanelTab).toBe("issues");
    expect(state.selectedIssueId).toBeNull();
    expect(state.search).toBe("");
    expect(state.scope).toBe("active");
  });

  it("manages active tab state", () => {
    const store = useIssuePaneStore.getState();

    store.setActivePanelTab(THREAD_ID, "coordinator");

    const state = getIssuePaneState(THREAD_ID);
    expect(state.activePanelTab).toBe("coordinator");
  });

  it("manages selected issue state", () => {
    const store = useIssuePaneStore.getState();

    store.setSelectedIssueId(THREAD_ID, "issue-1");

    let state = getIssuePaneState(THREAD_ID);
    expect(state.selectedIssueId).toBe("issue-1");

    store.setSelectedIssueId(THREAD_ID, null);

    state = getIssuePaneState(THREAD_ID);
    expect(state.selectedIssueId).toBeNull();
  });

  it("manages search state", () => {
    const store = useIssuePaneStore.getState();

    store.setSearch(THREAD_ID, "bug");

    const state = getIssuePaneState(THREAD_ID);
    expect(state.search).toBe("bug");
  });

  it("manages scope state", () => {
    const store = useIssuePaneStore.getState();

    store.setScope(THREAD_ID, "all");

    const state = getIssuePaneState(THREAD_ID);
    expect(state.scope).toBe("all");
  });

  it("provides enhanced issues state", () => {
    const issuesState = getIssuesState(THREAD_ID);

    expect(issuesState).toBeDefined();
    expect(issuesState.searchQuery).toBe("");
    expect(issuesState.scopeFilter).toBe("active");
    expect(issuesState.selectedLabels).toEqual([]);
    expect(issuesState.sortBy).toBe("updated");
    expect(issuesState.sortDirection).toBe("desc");
    expect(issuesState.groupBy).toBe("none");
    expect(issuesState.showFilters).toBe(false);
    expect(issuesState.viewMode).toBe("list");
  });

  it("provides enhanced coordinator state", () => {
    const coordinatorState = getCoordinatorState(THREAD_ID);

    expect(coordinatorState).toBeDefined();
    expect(coordinatorState.selectedEpicId).toBeNull();
    expect(coordinatorState.showOnlyActive).toBe(false);
    expect(coordinatorState.autoRefresh).toBe(false);
    expect(coordinatorState.refreshInterval).toBe(30);
    expect(coordinatorState.showSwarmDetails).toBe(false);
    expect(coordinatorState.expandedSwarmIds).toEqual([]);
  });

  it("provides enhanced UI state", () => {
    const uiState = getUIState(THREAD_ID);

    expect(uiState).toBeDefined();
    expect(uiState.sidebarCollapsed).toBe(false);
    expect(uiState.detailPanelWidth).toBe(400);
    expect(uiState.lastRefreshTime).toBeNull();
    expect(uiState.loadingStates).toEqual({});
    expect(uiState.errorMessages).toEqual({});
  });

  it("isolates state per thread", () => {
    const threadA = ThreadId.makeUnsafe("thread-a");
    const threadB = ThreadId.makeUnsafe("thread-b");
    const store = useIssuePaneStore.getState();

    store.setActivePanelTab(threadA, "coordinator");
    store.setActivePanelTab(threadB, "issues");

    const stateA = getIssuePaneState(threadA);
    const stateB = getIssuePaneState(threadB);

    expect(stateA.activePanelTab).toBe("coordinator");
    expect(stateB.activePanelTab).toBe("issues");

    store.setSelectedIssueId(threadA, "issue-1");
    store.setSelectedIssueId(threadB, "issue-2");

    const updatedStateA = getIssuePaneState(threadA);
    const updatedStateB = getIssuePaneState(threadB);

    expect(updatedStateA.selectedIssueId).toBe("issue-1");
    expect(updatedStateB.selectedIssueId).toBe("issue-2");
  });
});

describe("Enhanced Issues Actions", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("provides search query actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesSearchQuery(THREAD_ID, "test query");

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.searchQuery).toBe("test query");
  });

  it("provides scope filter actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesScopeFilter(THREAD_ID, "closed");

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.scopeFilter).toBe("closed");
  });

  it("provides label selection actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesSelectedLabels(THREAD_ID, ["bug", "feature"]);

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.selectedLabels).toEqual(["bug", "feature"]);
  });

  it("provides sorting actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesSorting(THREAD_ID, "title", "asc");

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.sortBy).toBe("title");
    expect(issuesState.sortDirection).toBe("asc");
  });

  it("provides grouping actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesGroupBy(THREAD_ID, "status");

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.groupBy).toBe("status");
  });

  it("provides view mode actions", () => {
    const store = useIssuePaneStore.getState();

    store.setIssuesViewMode(THREAD_ID, "cards");

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.viewMode).toBe("cards");
  });

  it("provides toggle label action", () => {
    const store = useIssuePaneStore.getState();

    // Start with empty labels, add one
    store.setIssuesSelectedLabels(THREAD_ID, ["bug"]);

    let issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.selectedLabels).toContain("bug");

    // Remove the label
    store.setIssuesSelectedLabels(THREAD_ID, []);

    issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.selectedLabels).not.toContain("bug");
  });
});

describe("Enhanced Coordinator Actions", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("provides epic selection actions", () => {
    const store = useIssuePaneStore.getState();

    store.setCoordinatorSelectedEpicId(THREAD_ID, "epic-1");

    const coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.selectedEpicId).toBe("epic-1");
  });

  it("provides active filter actions", () => {
    const store = useIssuePaneStore.getState();

    store.setCoordinatorShowOnlyActive(THREAD_ID, true);

    const coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.showOnlyActive).toBe(true);
  });

  it("provides auto refresh actions", () => {
    const store = useIssuePaneStore.getState();

    store.toggleCoordinatorAutoRefresh(THREAD_ID);

    let coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.autoRefresh).toBe(true);

    store.toggleCoordinatorAutoRefresh(THREAD_ID);

    coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.autoRefresh).toBe(false);
  });

  it("provides refresh interval actions", () => {
    const store = useIssuePaneStore.getState();

    store.setCoordinatorRefreshInterval(THREAD_ID, 30);

    const coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.refreshInterval).toBe(30);
  });

  it("provides swarm expansion actions", () => {
    const store = useIssuePaneStore.getState();

    store.toggleCoordinatorSwarmExpanded(THREAD_ID, "swarm-1");

    let coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.expandedSwarmIds).toContain("swarm-1");

    store.toggleCoordinatorSwarmExpanded(THREAD_ID, "swarm-1");

    coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.expandedSwarmIds).not.toContain("swarm-1");
  });
});

describe("Enhanced UI Actions", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("provides sidebar actions", () => {
    const store = useIssuePaneStore.getState();

    store.setSidebarCollapsed(THREAD_ID, true);

    const uiState = getUIState(THREAD_ID);
    expect(uiState.sidebarCollapsed).toBe(true);
  });

  it("provides detail panel width actions", () => {
    const store = useIssuePaneStore.getState();

    store.setDetailPanelWidth(THREAD_ID, 500);

    const uiState = getUIState(THREAD_ID);
    expect(uiState.detailPanelWidth).toBe(500);
  });

  it("provides loading state actions", () => {
    const store = useIssuePaneStore.getState();

    store.setLoadingState(THREAD_ID, "search", true);

    const uiState = getUIState(THREAD_ID);
    expect(uiState.loadingStates["search"]).toBe(true);

    store.setLoadingState(THREAD_ID, "search", false);

    const updatedUIState = getUIState(THREAD_ID);
    expect(updatedUIState.loadingStates["search"]).toBe(false);
  });

  it("provides error message actions", () => {
    const store = useIssuePaneStore.getState();

    store.setErrorMessage(THREAD_ID, "search", "Something went wrong");

    const uiState = getUIState(THREAD_ID);
    expect(uiState.errorMessages["search"]).toBe("Something went wrong");

    store.setErrorMessage(THREAD_ID, "search", null);

    const updatedUIState = getUIState(THREAD_ID);
    expect(updatedUIState.errorMessages["search"]).toBeNull();
  });

  it("provides refresh time actions", () => {
    const store = useIssuePaneStore.getState();

    const mockTime = 1234567890;
    vi.spyOn(Date, "now").mockReturnValue(mockTime);

    store.updateLastRefreshTime(THREAD_ID);

    const uiState = getUIState(THREAD_ID);
    expect(uiState.lastRefreshTime).toBe(mockTime);

    vi.restoreAllMocks();
  });
});

describe("Batch Operations", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("provides batch update for issues state", () => {
    const store = useIssuePaneStore.getState();

    store.batchUpdateIssuesState(THREAD_ID, {
      searchQuery: "test",
      scopeFilter: "closed",
      sortBy: "title",
      viewMode: "cards",
    });

    const issuesState = getIssuesState(THREAD_ID);
    expect(issuesState.searchQuery).toBe("test");
    expect(issuesState.scopeFilter).toBe("closed");
    expect(issuesState.sortBy).toBe("title");
    expect(issuesState.viewMode).toBe("cards");
  });

  it("provides batch update for coordinator state", () => {
    const store = useIssuePaneStore.getState();

    store.batchUpdateCoordinatorState(THREAD_ID, {
      selectedEpicId: "epic-1",
      showOnlyActive: true,
      autoRefresh: true,
      refreshInterval: 60,
    });

    const coordinatorState = getCoordinatorState(THREAD_ID);
    expect(coordinatorState.selectedEpicId).toBe("epic-1");
    expect(coordinatorState.showOnlyActive).toBe(true);
    expect(coordinatorState.autoRefresh).toBe(true);
    expect(coordinatorState.refreshInterval).toBe(60);
  });

  it("provides batch update for UI state", () => {
    const store = useIssuePaneStore.getState();

    store.batchUpdateUIState(THREAD_ID, {
      sidebarCollapsed: true,
      detailPanelWidth: 600,
      loadingStates: { search: true, refresh: false },
      errorMessages: { search: "Error occurred" },
    });

    const uiState = getUIState(THREAD_ID);
    expect(uiState.sidebarCollapsed).toBe(true);
    expect(uiState.detailPanelWidth).toBe(600);
    expect(uiState.loadingStates["search"]).toBe(true);
    expect(uiState.loadingStates["refresh"]).toBe(false);
    expect(uiState.errorMessages["search"]).toBe("Error occurred");
  });
});

describe("Reset Operations", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({ byThreadId: {} });
  });

  it("resets thread state completely", () => {
    const store = useIssuePaneStore.getState();

    // Set some state first
    store.setActivePanelTab(THREAD_ID, "coordinator");
    store.setSelectedIssueId(THREAD_ID, "issue-1");
    store.setIssuesSearchQuery(THREAD_ID, "test");

    // Verify state was set
    let state = getIssuePaneState(THREAD_ID);
    expect(state.activePanelTab).toBe("coordinator");
    expect(state.selectedIssueId).toBe("issue-1");

    // Reset and verify defaults
    store.resetThreadState(THREAD_ID);

    state = getIssuePaneState(THREAD_ID);
    expect(state.activePanelTab).toBe("issues");
    expect(state.selectedIssueId).toBeNull();
    expect(state.search).toBe("");
  });

  it("resets just issues state", () => {
    const store = useIssuePaneStore.getState();

    // Set some state first
    store.setActivePanelTab(THREAD_ID, "coordinator");
    store.setIssuesSearchQuery(THREAD_ID, "test");
    store.setIssuesViewMode(THREAD_ID, "cards");

    // Reset just issues state
    store.resetIssuesState(THREAD_ID);

    // Check that core state remains but issues state is reset
    const state = getIssuePaneState(THREAD_ID);
    const issuesState = getIssuesState(THREAD_ID);

    expect(state.activePanelTab).toBe("coordinator"); // Should remain
    expect(issuesState.searchQuery).toBe(""); // Should be reset
    expect(issuesState.viewMode).toBe("list"); // Should be reset
  });

  it("resets just coordinator state", () => {
    const store = useIssuePaneStore.getState();

    // Set some state first
    store.setActivePanelTab(THREAD_ID, "coordinator");
    store.setCoordinatorSelectedEpicId(THREAD_ID, "epic-1");
    store.setCoordinatorShowOnlyActive(THREAD_ID, true);

    // Reset just coordinator state
    store.resetCoordinatorState(THREAD_ID);

    // Check that core state remains but coordinator state is reset
    const state = getIssuePaneState(THREAD_ID);
    const coordinatorState = getCoordinatorState(THREAD_ID);

    expect(state.activePanelTab).toBe("coordinator"); // Should remain
    expect(coordinatorState.selectedEpicId).toBeNull(); // Should be reset
    expect(coordinatorState.showOnlyActive).toBe(false); // Should be reset
  });

  it("resets just UI state", () => {
    const store = useIssuePaneStore.getState();

    // Set some state first
    store.setActivePanelTab(THREAD_ID, "coordinator");
    store.setSidebarCollapsed(THREAD_ID, true);
    store.setDetailPanelWidth(THREAD_ID, 600);

    // Reset just UI state
    store.resetUIState(THREAD_ID);

    // Check that core state remains but UI state is reset
    const state = getIssuePaneState(THREAD_ID);
    const uiState = getUIState(THREAD_ID);

    expect(state.activePanelTab).toBe("coordinator"); // Should remain
    expect(uiState.sidebarCollapsed).toBe(false); // Should be reset
    expect(uiState.detailPanelWidth).toBe(400); // Should be reset
  });
});
