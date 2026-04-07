import "../index.css";

import { ThreadId, type BeadsIssueSummary } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const THREAD_ID = ThreadId.makeUnsafe("thread-issues-panel");
const TEST_CWD = "/repo/project";

const testState = vi.hoisted(() => ({
  issueListFetching: false,
  issueListRefetchSpy: vi.fn(() => Promise.resolve()),
  issueListIssues: [] as BeadsIssueSummary[],
}));

function makeIssue(
  overrides: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">,
): BeadsIssueSummary {
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    description: null,
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    labels: [],
    parent: null,
    ...rest,
  };
}

vi.mock("@tanstack/react-pacer", () => ({
  useDebouncedValue: (value: string) => [value],
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");

  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useMutation: vi.fn(() => ({
      mutateAsync: vi.fn(),
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({})),
    useQuery: vi.fn((options: { queryKey?: readonly unknown[] }) => {
      if (options.queryKey?.[1] === "issues") {
        return {
          data: {
            issues: testState.issueListIssues,
          },
          isPending: false,
          isError: false,
          error: null,
          isFetching: testState.issueListFetching,
          refetch: testState.issueListRefetchSpy,
        };
      }

      return {
        data: null,
        isPending: false,
        isError: false,
        error: null,
        isFetching: false,
        refetch: vi.fn(),
      };
    }),
  };
});

vi.mock("~/composerDraftStore", () => ({
  useComposerThreadDraft: vi.fn(() => ({
    activeProvider: null,
    prompt: "",
    runtimeMode: null,
  })),
  useEffectiveComposerModelState: vi.fn(() => ({
    modelOptions: null,
    selectedModel: "gpt-5.4-mini",
  })),
}));

vi.mock("~/hooks/useSettings", () => ({
  useSettings: vi.fn(() => ({
    timestampFormat: "absolute",
  })),
}));

vi.mock("~/issuePanel", async () => {
  const actual = await vi.importActual<typeof import("~/issuePanel")>("~/issuePanel");

  return {
    ...actual,
    findLatestTrackerRefinementPlan: vi.fn(() => null),
    getEpicCoordinatorImplementAction: vi.fn(() => ({
      kind: "implement",
      label: "Implement",
      disabled: false,
    })),
  };
});

vi.mock("~/issueThreads", () => ({
  listIssueLinkedThreads: vi.fn(() => []),
}));

vi.mock("~/lib/beadsReactQuery", () => ({
  beadsIssueDetailOptions: vi.fn(() => ({ queryKey: ["beads", "issue"] })),
  beadsQueryIssuesOptions: vi.fn(() => ({ queryKey: ["beads", "issues"] })),
  beadsSwarmSupportOptions: vi.fn(() => ({ queryKey: ["beads", "swarm-support"] })),
  beadsEpicSwarmValidationOptions: vi.fn(() => ({
    queryKey: ["beads", "epic-swarm-validation"],
  })),
  beadsEpicSwarmStatusOptions: vi.fn(() => ({ queryKey: ["beads", "epic-swarm-status"] })),
  beadsListSwarmsOptions: vi.fn(() => ({ queryKey: ["beads", "swarms"] })),
  beadsStartEpicPlannedRefineMutationOptions: vi.fn(() => ({})),
  beadsStartEpicPlanImplementationMutationOptions: vi.fn(() => ({})),
  beadsStartEpicQuickRefineMutationOptions: vi.fn(() => ({})),
  beadsStartWorkflowMutationOptions: vi.fn(() => ({})),
}));

vi.mock("~/providerModels", () => ({
  getProviderModels: vi.fn(() => []),
  resolveSelectableProvider: vi.fn((_, provider) => provider ?? "codex"),
}));

vi.mock("~/rpc/serverState", () => ({
  useServerConfig: vi.fn(() => ({
    providers: [],
  })),
}));

vi.mock("~/store", () => ({
  useStore: (selector: (state: { threads: [] }) => unknown) => selector({ threads: [] }),
}));

vi.mock("~/storeSelectors", () => ({
  useThreadById: vi.fn(() => null),
}));

vi.mock("./chat/composerProviderRegistry", () => ({
  getComposerProviderState: vi.fn(() => ({
    provider: "codex",
    promptEffort: null,
    modelOptionsForDispatch: undefined,
  })),
}));

vi.mock("./ChatView.logic", () => ({
  threadHasStarted: vi.fn(() => false),
}));

import { IssuesPanel } from "./IssuesPanel";

function getRefreshButton(): HTMLButtonElement {
  const button = document.querySelector('button[aria-label="Refresh issues"]');
  expect(button, 'Expected to find button with aria-label "Refresh issues"').toBeTruthy();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected "Refresh issues" control to be an HTMLButtonElement');
  }
  return button;
}

describe("IssuesPanel refresh button", () => {
  beforeEach(() => {
    testState.issueListFetching = false;
    testState.issueListRefetchSpy.mockClear();
    testState.issueListIssues = [
      makeIssue({
        id: "t3code-123",
        title: "Issue row",
      }),
    ];
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders an explicit refresh button and refetches the issue list on click", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={null}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      const refreshButton = getRefreshButton();

      expect(refreshButton.disabled).toBe(false);
      refreshButton.click();

      expect(testState.issueListRefetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      screen.unmount();
    }
  });

  it("disables the refresh button while the issue list query is already fetching", async () => {
    testState.issueListFetching = true;

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={null}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      const refreshButton = getRefreshButton();

      expect(refreshButton.disabled).toBe(true);
      expect(refreshButton.querySelector(".animate-spin")).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it("renders epic groups separately from other issues with a divider and group spacing", async () => {
    testState.issueListIssues = [
      makeIssue({
        id: "epic-alpha",
        title: "Alpha epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-alpha-1",
        title: "Alpha task",
        parent: { id: "epic-alpha", title: "Alpha epic" },
      }),
      makeIssue({
        id: "epic-beta",
        title: "Beta epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-beta-1",
        title: "Beta task",
        parent: { id: "epic-beta", title: "Beta epic" },
      }),
      makeIssue({
        id: "task-standalone",
        title: "Standalone task",
      }),
    ];

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={null}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      const epicSection = document.querySelector('[data-issues-section="epic-groups"]');
      const divider = document.querySelector('[data-issues-divider="epic-other"]');
      const otherSection = document.querySelector('[data-issues-section="other-issues"]');
      const epicGroups = epicSection?.querySelectorAll("[data-epic-group]");
      const epicHeaders = epicSection?.querySelectorAll("[data-epic-header]");
      const epicChildContainers = epicSection?.querySelectorAll("[data-epic-children]");
      const alphaSelectButton = document.querySelector(
        'button[aria-label="Select issue epic-alpha: Alpha epic"]',
      );
      const alphaCollapseButton = document.querySelector(
        'button[aria-label="Collapse epic group Alpha epic"]',
      );

      expect(epicSection).toBeTruthy();
      expect(epicSection?.className).toContain("space-y-4");
      expect(epicGroups).toHaveLength(2);
      expect(epicHeaders).toHaveLength(2);
      expect(epicChildContainers).toHaveLength(2);
      expect(epicChildContainers?.[0]?.className).toContain("pl-4");
      expect(epicChildContainers?.[0]?.textContent).toContain("Alpha task");
      expect(epicChildContainers?.[1]?.textContent).toContain("Beta task");
      expect(alphaSelectButton).toBeTruthy();
      expect(alphaCollapseButton).toBeTruthy();
      expect(divider).toBeTruthy();
      expect(divider?.className).toContain("border-t");
      expect(otherSection).toBeTruthy();
      expect(otherSection?.textContent).toContain("Standalone task");
      expect(otherSection?.textContent).not.toContain("Alpha epic");
      expect(otherSection?.textContent).not.toContain("Beta epic");
    } finally {
      screen.unmount();
    }
  });
});
