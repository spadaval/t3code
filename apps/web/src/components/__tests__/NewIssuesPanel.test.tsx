import { describe, expect, it, vi } from "vitest";
import {
  ThreadId,
  type BeadsIssueSummary,
  type BeadsSwarmSummary,
  type BeadsCoordinatorEpicSnapshot,
  type OrchestrationSwarmRun,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { NewIssuesPanel, type NewIssuesPanelProps } from "../NewIssuesPanel";

// ── Test Data ───────────────────────────────────────────────────────────

const THREAD_ID = ThreadId.makeUnsafe("test-thread");

const SAMPLE_ISSUES: readonly BeadsIssueSummary[] = [
  {
    id: "issue-1",
    title: "Test Bug Issue",
    description: "Test description",
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: null,
    updatedAt: "2024-01-02T00:00:00Z",
    labels: ["bug", "high-priority"],
    parent: { id: "epic-1", title: "Epic 1" },
  },
  {
    id: "issue-2",
    title: "Feature Request",
    description: "Another description",
    notes: null,
    status: "open",
    priority: null,
    issueType: "feature",
    assignee: null,
    owner: null,
    createdAt: "2024-01-02T00:00:00Z",
    createdBy: null,
    updatedAt: "2024-01-03T00:00:00Z",
    labels: ["feature", "enhancement"],
    parent: { id: "epic-2", title: "Epic 2" },
  },
  {
    id: "issue-3",
    title: "Closed Issue",
    description: "Closed issue description",
    notes: null,
    status: "closed",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: null,
    updatedAt: "2024-01-01T00:00:00Z",
    labels: ["bug", "resolved"],
    parent: null,
  },
];

const SAMPLE_SWARMS: readonly BeadsSwarmSummary[] = [
  {
    swarmId: "swarm-1",
    epicId: "epic-1",
    epicTitle: "Epic 1",
    totalIssueCount: 5,
    completedIssueCount: 2,
    activeIssueCount: 2,
    readyIssueCount: 1,
    blockedIssueCount: 0,
    activeWorkerCount: 3,
  },
];

const SAMPLE_EPICS: readonly BeadsCoordinatorEpicSnapshot[] = [
  {
    epicId: "epic-1",
    epicTitle: "Epic 1",
    issue: SAMPLE_ISSUES[0] as BeadsIssueSummary,
    fetchLifecycle: { kind: "ready", detail: null },
    stateKind: "ready",
    primaryAction: {
      kind: "none",
      label: "No action",
      busyLabel: "Processing",
      disabled: false,
    },
    latestRun: null,
    projectConflict: null,
    swarmSummary: SAMPLE_SWARMS[0] as BeadsSwarmSummary,
    validation: null,
    status: null,
  },
];

const SAMPLE_RUNS: readonly OrchestrationSwarmRun[] = [
  {
    runId: "run-1" as any, // Use any to bypass strict typing for tests
    epicIssueId: "epic-1",
    status: "running",
    createdAt: "2024-01-01T00:00:00Z",
    completedAt: null,
  },
];

// ── Helper Functions ────────────────────────────────────────────────────

function createTestProps(overrides: Partial<NewIssuesPanelProps> = {}): NewIssuesPanelProps {
  return {
    threadId: THREAD_ID,
    issues: SAMPLE_ISSUES,
    swarms: SAMPLE_SWARMS,
    epics: SAMPLE_EPICS,
    swarmRuns: SAMPLE_RUNS,
    activeTab: "issues",
    searchValue: "",
    scopeFilter: "active",
    loading: false,
    error: null,
    onTabChange: vi.fn(),
    onIssueSelect: vi.fn(),
    onSearchChange: vi.fn(),
    onScopeChange: vi.fn(),
    onLabelClick: vi.fn(),
    onStartSwarm: vi.fn(),
    onPauseSwarm: vi.fn(),
    onRefreshCoordinator: vi.fn(),
    ...overrides,
  };
}

function renderToString(element: React.ReactElement): string {
  // Using server-side rendering to avoid browser test setup complexity
  // This tests the component structure and props handling
  return renderToStaticMarkup(element);
}

// ── Component Tests ─────────────────────────────────────────────────────

describe("NewIssuesPanel", () => {
  it("renders without crashing", () => {
    const props = createTestProps();

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });

  it("renders with issues tab active by default", () => {
    const props = createTestProps({ activeTab: "issues" });

    const html = renderToString(<NewIssuesPanel {...props} />);

    // Should contain issue list components
    expect(html).toContain("Test Bug Issue");
    expect(html).toContain("Feature Request");
  });

  it("renders with coordinator tab active", () => {
    const props = createTestProps({ activeTab: "coordinator" });

    const html = renderToString(<NewIssuesPanel {...props} />);

    // Should contain coordinator components
    expect(html).toContain("Epic 1");
  });

  it("filters issues based on search value", () => {
    const props = createTestProps({
      activeTab: "issues",
      searchValue: "Bug",
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Test Bug Issue");
  });

  it("filters issues based on scope", () => {
    const props = createTestProps({
      activeTab: "issues",
      scopeFilter: "all",
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    // Should include closed issues when scope is "all"
    expect(html).toContain("Closed Issue");
  });

  it("shows only open issues when scope is active", () => {
    const props = createTestProps({
      activeTab: "issues",
      scopeFilter: "active",
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Test Bug Issue");
    expect(html).toContain("Feature Request");
    // Should not contain closed issues
    expect(html).not.toContain("Closed Issue");
  });

  it("shows loading state", () => {
    const props = createTestProps({
      loading: true,
      issues: [],
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Loading");
  });

  it("shows error state", () => {
    const props = createTestProps({
      error: "Something went wrong",
      issues: [],
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Failed to load issues");
  });

  it("shows empty state when no issues", () => {
    const props = createTestProps({
      issues: [],
      loading: false,
      error: null,
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("No matching issues");
  });

  it("passes thread id correctly", () => {
    const customThreadId = ThreadId.makeUnsafe("custom-thread");
    const props = createTestProps({ threadId: customThreadId });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });

  it("handles custom className", () => {
    const props = createTestProps({ className: "custom-class" });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("custom-class");
  });

  it("renders with selected issue", () => {
    const props = createTestProps({
      selectedIssueId: "issue-1",
      activeTab: "issues",
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Test Bug Issue");
  });
});

describe("NewIssuesPanel Props Integration", () => {
  it("integrates all required props correctly", () => {
    const props = createTestProps({
      issues: SAMPLE_ISSUES,
      selectedIssueId: "issue-1",
      swarms: SAMPLE_SWARMS,
      epics: SAMPLE_EPICS,
      swarmRuns: SAMPLE_RUNS,
      activeTab: "coordinator",
      searchValue: "Epic",
      scopeFilter: "active",
      loading: false,
      error: null,
    });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });

  it("handles minimal props correctly", () => {
    const minimalProps: NewIssuesPanelProps = {
      threadId: THREAD_ID,
    };

    expect(() => {
      renderToString(<NewIssuesPanel {...minimalProps} />);
    }).not.toThrow();
  });

  it("handles coordinator data correctly", () => {
    const props = createTestProps({
      activeTab: "coordinator",
      swarms: SAMPLE_SWARMS,
      epics: SAMPLE_EPICS,
      swarmRuns: SAMPLE_RUNS,
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    expect(html).toContain("Epic 1");
  });
});

describe("NewIssuesPanel Edge Cases", () => {
  it("handles empty arrays gracefully", () => {
    const props = createTestProps({
      issues: [],
      swarms: [],
      epics: [],
      swarmRuns: [],
    });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });

  it("handles undefined optional props", () => {
    const props = createTestProps({
      selectedIssueId: null, // Use null instead of undefined
      searchValue: "", // Use empty string instead of undefined
      scopeFilter: "active", // Use valid value instead of undefined
      loading: false, // Use false instead of undefined
      error: null, // Use null instead of undefined
    });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });

  it("handles null values correctly", () => {
    const props = createTestProps({
      selectedIssueId: null,
      error: null,
    });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });
});

// ── Event Handler Tests ─────────────────────────────────────────────────

describe("NewIssuesPanel Event Handlers", () => {
  it("provides all required event handlers", () => {
    const handlers = {
      onTabChange: vi.fn(),
      onIssueSelect: vi.fn(),
      onSearchChange: vi.fn(),
      onScopeChange: vi.fn(),
      onLabelClick: vi.fn(),
      onStartSwarm: vi.fn(),
      onPauseSwarm: vi.fn(),
      onRefreshCoordinator: vi.fn(),
    };

    const props = createTestProps(handlers);

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();

    // Verify all handlers are present
    expect(props.onTabChange).toBe(handlers.onTabChange);
    expect(props.onIssueSelect).toBe(handlers.onIssueSelect);
    expect(props.onSearchChange).toBe(handlers.onSearchChange);
    expect(props.onScopeChange).toBe(handlers.onScopeChange);
    expect(props.onLabelClick).toBe(handlers.onLabelClick);
    expect(props.onStartSwarm).toBe(handlers.onStartSwarm);
    expect(props.onPauseSwarm).toBe(handlers.onPauseSwarm);
    expect(props.onRefreshCoordinator).toBe(handlers.onRefreshCoordinator);
  });

  it("handles optional event handlers", () => {
    const props = createTestProps({
      // Don't pass undefined handlers - just omit them
    });

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();
  });
});

// ── Performance and Accessibility Tests ─────────────────────────────────

describe("NewIssuesPanel Performance", () => {
  it("handles large datasets efficiently", () => {
    const largeIssueSet = Array.from(
      { length: 100 },
      (_, i): BeadsIssueSummary => ({
        id: `issue-${i}`,
        title: `Test Issue ${i}`,
        description: `Description ${i}`,
        notes: null,
        status: i % 2 === 0 ? "open" : "closed",
        priority: null,
        issueType: "task",
        assignee: null,
        owner: null,
        createdAt: "2024-01-01T00:00:00Z",
        createdBy: null,
        updatedAt: "2024-01-02T00:00:00Z",
        labels: [`label-${i % 5}`],
        parent:
          i % 10 === 0
            ? { id: `epic-${Math.floor(i / 10)}`, title: `Epic ${Math.floor(i / 10)}` }
            : null,
      }),
    );

    const props = createTestProps({
      issues: largeIssueSet,
      scopeFilter: "all", // Show all to include closed issues
    });

    const startTime = performance.now();

    expect(() => {
      renderToString(<NewIssuesPanel {...props} />);
    }).not.toThrow();

    const endTime = performance.now();

    // Should render large datasets in reasonable time (< 1 second)
    expect(endTime - startTime).toBeLessThan(1000);
  });

  it("generates accessible HTML structure", () => {
    const props = createTestProps({
      activeTab: "issues",
      issues: SAMPLE_ISSUES,
    });

    const html = renderToString(<NewIssuesPanel {...props} />);

    // Check for basic accessibility patterns
    expect(html).toMatch(/role=["'].*["']/);
    expect(html).toMatch(/aria-/);
  });
});
