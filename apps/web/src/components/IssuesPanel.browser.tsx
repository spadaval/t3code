import "../index.css";

import { ProjectId, ThreadId, type BeadsIssueSummary } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useIssuePaneStore } from "~/issuePaneStore";

const THREAD_ID = ThreadId.makeUnsafe("thread-issues-panel");
const TEST_CWD = "/repo/project";

const testState = vi.hoisted(() => ({
  issueListFetching: false,
  issueListRefetchSpy: vi.fn(() => Promise.resolve()),
  issueListIssues: [] as BeadsIssueSummary[],
  issueDetail: null as Record<string, unknown> | null,
  issueDetailsById: {} as Record<string, Record<string, unknown> | null>,
  swarmSupport: null as Record<string, unknown> | null,
  swarmValidation: null as Record<string, unknown> | null,
  swarmStatus: null as Record<string, unknown> | null,
  swarmRuns: [] as Record<string, unknown>[],
  swarmTaskExecutions: [] as Record<string, unknown>[],
  swarmValidationByEpicId: {} as Record<string, Record<string, unknown> | null>,
  swarmStatusByEpicId: {} as Record<string, Record<string, unknown> | null>,
  navigateSpy: vi.fn(() => Promise.resolve()),
  invalidateQueriesSpy: vi.fn(() => Promise.resolve()),
  startIssueWorkflowSpy: vi.fn(() =>
    Promise.resolve({ threadId: "thread-workflow", created: true }),
  ),
  startEpicQuickRefineSpy: vi.fn(() => Promise.resolve()),
  startEpicPlannedRefineSpy: vi.fn(() => Promise.resolve()),
  startEpicPlanImplementationSpy: vi.fn(() => Promise.resolve()),
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

function makeIssueDetail(
  overrides: Partial<Record<string, unknown>> & Pick<BeadsIssueSummary, "id" | "title">,
) {
  return {
    ...makeIssue(overrides),
    comments: [],
    history: [],
    dependencies: [],
    ...overrides,
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
    useNavigate: () => testState.navigateSpy,
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");

  return {
    ...actual,
    useMutation: vi.fn((options?: { __tag?: string }) => ({
      mutateAsync:
        options?.__tag === "start-issue-workflow"
          ? testState.startIssueWorkflowSpy
          : options?.__tag === "start-epic-quick-refine"
            ? testState.startEpicQuickRefineSpy
            : options?.__tag === "start-epic-planned-refine"
              ? testState.startEpicPlannedRefineSpy
              : options?.__tag === "start-epic-plan-implementation"
                ? testState.startEpicPlanImplementationSpy
                : vi.fn(),
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: testState.invalidateQueriesSpy,
    })),
    useQueries: vi.fn(({ queries }: { queries: Array<{ queryKey?: readonly unknown[] }> }) =>
      queries.map((query) => {
        const epicId = query.queryKey?.[2];

        if (query.queryKey?.[1] === "epic-swarm-validation") {
          return {
            data:
              (typeof epicId === "string" ? testState.swarmValidationByEpicId[epicId] : null) ??
              testState.swarmValidation,
            isPending: false,
            isError: false,
            error: null,
            isFetching: false,
            refetch: vi.fn(),
          };
        }

        if (query.queryKey?.[1] === "epic-swarm-status") {
          return {
            data:
              (typeof epicId === "string" ? testState.swarmStatusByEpicId[epicId] : null) ??
              testState.swarmStatus,
            isPending: false,
            isError: false,
            error: null,
            isFetching: false,
            refetch: vi.fn(),
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
    ),
    useQuery: vi.fn((options: { queryKey?: readonly unknown[] }) => {
      if (options.queryKey?.[1] === "issues") {
        const issueTypesKey = options.queryKey?.[2];
        const filteredIssues =
          typeof issueTypesKey === "string" && issueTypesKey.length > 0
            ? testState.issueListIssues.filter((issue) =>
                issueTypesKey.split(",").includes(issue.issueType),
              )
            : testState.issueListIssues;
        return {
          data: {
            issues: filteredIssues,
          },
          isPending: false,
          isError: false,
          error: null,
          isFetching: testState.issueListFetching,
          refetch: testState.issueListRefetchSpy,
        };
      }

      if (options.queryKey?.[1] === "issue") {
        const issueId = options.queryKey?.[2];
        return {
          data:
            (typeof issueId === "string" ? testState.issueDetailsById[issueId] : null) ??
            testState.issueDetail,
          isPending: false,
          isError: false,
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (options.queryKey?.[1] === "swarm-support") {
        return {
          data: testState.swarmSupport,
          isPending: false,
          isError: false,
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (options.queryKey?.[1] === "epic-swarm-validation") {
        const epicId = options.queryKey?.[2];
        return {
          data:
            (typeof epicId === "string" ? testState.swarmValidationByEpicId[epicId] : null) ??
            testState.swarmValidation,
          isPending: false,
          isError: false,
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }

      if (options.queryKey?.[1] === "epic-swarm-status") {
        const epicId = options.queryKey?.[2];
        return {
          data:
            (typeof epicId === "string" ? testState.swarmStatusByEpicId[epicId] : null) ??
            testState.swarmStatus,
          isPending: false,
          isError: false,
          error: null,
          isFetching: false,
          refetch: vi.fn(),
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
    enableAssistantStreaming: false,
  })),
}));

vi.mock("~/issuePanel", async () => {
  const actual = await vi.importActual<typeof import("~/issuePanel")>("~/issuePanel");

  return {
    ...actual,
    findLatestTrackerRefinementPlan: vi.fn(() => null),
  };
});

vi.mock("~/issueThreads", () => ({
  listIssueLinkedThreads: vi.fn(() => []),
}));

vi.mock("~/lib/beadsReactQuery", () => ({
  beadsQueryKeys: {
    all: ["beads"],
  },
  beadsIssueDetailOptions: vi.fn((input?: { issueId?: string | null } | null) => ({
    queryKey: ["beads", "issue", input?.issueId ?? null],
  })),
  beadsQueryIssuesOptions: vi.fn((input?: { issueTypes?: string[] }) => ({
    queryKey: ["beads", "issues", input?.issueTypes?.join(",") ?? ""],
  })),
  beadsSwarmSupportOptions: vi.fn(() => ({ queryKey: ["beads", "swarm-support"] })),
  beadsEpicSwarmValidationOptions: vi.fn((input?: { epicIssueId?: string | null } | null) => ({
    queryKey: ["beads", "epic-swarm-validation", input?.epicIssueId ?? null],
  })),
  beadsEpicSwarmStatusOptions: vi.fn((input?: { epicIssueId?: string | null } | null) => ({
    queryKey: ["beads", "epic-swarm-status", input?.epicIssueId ?? null],
  })),
  beadsListSwarmsOptions: vi.fn(() => ({ queryKey: ["beads", "swarms"] })),
  beadsStartEpicPlannedRefineMutationOptions: vi.fn(() => ({
    __tag: "start-epic-planned-refine",
  })),
  beadsStartEpicPlanImplementationMutationOptions: vi.fn(() => ({
    __tag: "start-epic-plan-implementation",
  })),
  beadsStartEpicQuickRefineMutationOptions: vi.fn(() => ({
    __tag: "start-epic-quick-refine",
  })),
  beadsStartWorkflowMutationOptions: vi.fn(() => ({
    __tag: "start-issue-workflow",
  })),
}));

vi.mock("~/providerModels", () => ({
  getDefaultServerModel: vi.fn(() => "gpt-5.4-mini"),
  getProviderModels: vi.fn(() => []),
  resolveSelectableProvider: vi.fn((_, provider) => provider ?? "codex"),
}));

vi.mock("~/rpc/serverState", () => ({
  useServerConfig: vi.fn(() => ({
    providers: [],
  })),
  resetServerStateForTests: vi.fn(),
}));

vi.mock("~/store", () => ({
  useStore: (
    selector: (state: {
      threads: [];
      swarmRuns: typeof testState.swarmRuns;
      swarmTaskExecutions: typeof testState.swarmTaskExecutions;
    }) => unknown,
  ) =>
    selector({
      threads: [],
      swarmRuns: testState.swarmRuns,
      swarmTaskExecutions: testState.swarmTaskExecutions,
    }),
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

function getButtonByText(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `Expected to find button with text "${label}"`).toBeTruthy();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected "${label}" control to be an HTMLButtonElement`);
  }
  return button;
}

function getTabByText(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button, `Expected to find tab with text "${label}"`).toBeTruthy();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected "${label}" tab to be an HTMLButtonElement`);
  }
  return button;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    testState.issueDetail = null;
    testState.issueDetailsById = {};
    testState.swarmSupport = null;
    testState.swarmValidation = null;
    testState.swarmStatus = null;
    testState.swarmRuns = [];
    testState.swarmTaskExecutions = [];
    testState.swarmValidationByEpicId = {};
    testState.swarmStatusByEpicId = {};
    testState.navigateSpy.mockClear();
    testState.invalidateQueriesSpy.mockClear();
    testState.startIssueWorkflowSpy.mockClear();
    testState.startEpicQuickRefineSpy.mockClear();
    testState.startEpicPlannedRefineSpy.mockClear();
    testState.startEpicPlanImplementationSpy.mockClear();
    useIssuePaneStore.setState({ byThreadId: {} });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows Create swarm for epics with no swarm", async () => {
    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-1",
        title: "Epic row",
        issueType: "epic",
      }),
    ];
    testState.issueDetail = makeIssueDetail({
      id: "EPIC-1",
      title: "Epic row",
      issueType: "epic",
    });
    testState.swarmSupport = { supported: true };
    testState.swarmValidation = {
      valid: false,
      swarm: null,
      errors: ["Epic is missing a swarm."],
      warnings: [],
      readyFronts: [],
      estimatedWorkerSessions: 0,
      maxParallelism: 0,
    };
    testState.swarmStatus = {
      swarm: null,
      completed: [],
      active: [],
      ready: [],
      blocked: [],
    };
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "EPIC-1");

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
      expect(document.body.textContent).toContain("Create swarm");
      expect(document.body.textContent).toContain("No swarm exists for this epic yet.");
    } finally {
      screen.unmount();
    }
  });

  it("shows Repair swarm for epics with invalid swarms", async () => {
    const swarmSummary = {
      swarmId: "swarm-repair",
      epicId: "EPIC-REPAIR",
      epicTitle: "Repair epic",
      totalIssueCount: 3,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 1,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-REPAIR",
        title: "Repair epic",
        issueType: "epic",
      }),
    ];
    testState.issueDetail = makeIssueDetail({
      id: "EPIC-REPAIR",
      title: "Repair epic",
      issueType: "epic",
    });
    testState.swarmSupport = { supported: true };
    testState.swarmValidation = {
      valid: false,
      swarm: swarmSummary,
      errors: ["Swarm validation failed."],
      warnings: [],
      readyFronts: [],
      estimatedWorkerSessions: 1,
      maxParallelism: 1,
    };
    testState.swarmStatus = {
      swarm: swarmSummary,
      completed: [],
      active: [],
      ready: [],
      blocked: [makeIssue({ id: "TASK-BLOCKED", title: "Blocked task" })],
    };
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "EPIC-REPAIR");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Repair swarm");
      expect(document.body.textContent).toContain(
        "needs repair before coordinated implementation can start",
      );
    } finally {
      screen.unmount();
    }
  });

  it("shows Open coordinator when the epic already has swarm run history", async () => {
    const swarmSummary = {
      swarmId: "swarm-1",
      epicId: "EPIC-1",
      epicTitle: "Epic row",
      totalIssueCount: 2,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 1,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-1",
        title: "Epic row",
        issueType: "epic",
      }),
    ];
    testState.issueDetail = makeIssueDetail({
      id: "EPIC-1",
      title: "Epic row",
      issueType: "epic",
    });
    testState.swarmSupport = { supported: true };
    testState.swarmValidation = {
      valid: true,
      swarm: swarmSummary,
      errors: [],
      warnings: [],
      readyFronts: [],
      estimatedWorkerSessions: 1,
      maxParallelism: 1,
    };
    testState.swarmStatus = {
      swarm: swarmSummary,
      completed: [],
      active: [],
      ready: [],
      blocked: [],
    };
    testState.swarmRuns = [
      {
        runId: "run-1",
        projectId: "project-1",
        epicIssueId: "EPIC-1",
        swarmId: "swarm-1",
        status: "completed",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: null,
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: null,
        lastError: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: "2026-01-01T00:02:00.000Z",
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ];
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "EPIC-1");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Open coordinator");
      expect(document.body.textContent).toContain("The latest swarm run completed.");
    } finally {
      screen.unmount();
    }
  });

  it("shows recoverable worker-failure actions for an epic and refreshes swarm status manually", async () => {
    const swarmSummary = {
      swarmId: "swarm-recoverable",
      epicId: "EPIC-RECOVER",
      epicTitle: "Recoverable epic",
      totalIssueCount: 3,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-RECOVER",
        title: "Recoverable epic",
        issueType: "epic",
      }),
    ];
    testState.issueDetail = makeIssueDetail({
      id: "EPIC-RECOVER",
      title: "Recoverable epic",
      issueType: "epic",
    });
    testState.swarmSupport = { supported: true };
    testState.swarmValidation = {
      epicId: "EPIC-RECOVER",
      epicTitle: "Recoverable epic",
      valid: true,
      swarm: swarmSummary,
      errors: [],
      warnings: [],
      readyFronts: [],
      estimatedWorkerSessions: 1,
      maxParallelism: 1,
    };
    testState.swarmStatus = {
      epicId: "EPIC-RECOVER",
      epicTitle: "Recoverable epic",
      swarm: swarmSummary,
      completed: [],
      active: [],
      ready: [],
      blocked: [makeIssue({ id: "TASK-1", title: "Blocked task" })],
    };
    testState.swarmRuns = [
      {
        runId: "run-recoverable",
        projectId: "project-1",
        epicIssueId: "EPIC-RECOVER",
        swarmId: "swarm-recoverable",
        status: "blocked",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: null,
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: "execution-1",
        lastError: "Worker crashed",
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: "2026-01-01T00:02:00.000Z",
        blockedContext: {
          kind: "worker_failure",
          issueId: "TASK-1",
          executionId: "execution-1",
          workerThreadId: "thread-worker",
        },
        failedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ];
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "EPIC-RECOVER");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Continue swarm");
      expect(document.body.textContent).toContain("Refresh swarm status");
      const continueButton = getButtonByText("Continue swarm");
      expect(continueButton.disabled).toBe(true);
    } finally {
      screen.unmount();
    }
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

  it("switches to Coordinator, opens an epic, and transitions footer actions to a child issue", async () => {
    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-1",
        title: "Epic row",
        issueType: "epic",
      }),
      makeIssue({
        id: "TASK-1",
        title: "Child task",
        parent: { id: "EPIC-1", title: "Epic row" },
      }),
    ];
    testState.issueDetailsById = {
      "EPIC-1": makeIssueDetail({
        id: "EPIC-1",
        title: "Epic row",
        issueType: "epic",
      }),
      "TASK-1": makeIssueDetail({
        id: "TASK-1",
        title: "Child task",
        parent: { id: "EPIC-1", title: "Epic row" },
      }),
    };
    testState.swarmSupport = { supported: true };
    testState.swarmValidationByEpicId = {
      "EPIC-1": {
        epicId: "EPIC-1",
        epicTitle: "Epic row",
        valid: false,
        swarm: null,
        errors: ["Epic is missing a swarm."],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 0,
        maxParallelism: 0,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-1": {
        epicId: "EPIC-1",
        epicTitle: "Epic row",
        swarm: null,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
      },
    };

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      getTabByText("Coordinator").click();
      await flushPromises();

      expect(getTabByText("Coordinator").getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector('[role="tabpanel"][aria-label="Coordinator"]')).toBeTruthy();

      getButtonByText("Open epic").click();
      await flushPromises();

      expect(getTabByText("Issues").getAttribute("aria-selected")).toBe("true");
      expect(useIssuePaneStore.getState().byThreadId[THREAD_ID]?.selectedIssueId).toBe("EPIC-1");
      expect(document.body.textContent).toContain("Quick refine");
      expect(document.body.textContent).toContain("Planned refine");
      expect(document.body.textContent).toContain("Create swarm");
      expect(document.body.textContent).toContain("Children (1)");

      const childIssueButton = document.querySelector(
        'button[aria-label="Select issue TASK-1: Child task"]',
      );
      expect(childIssueButton).toBeTruthy();
      if (!(childIssueButton instanceof HTMLButtonElement)) {
        throw new Error("Expected child issue row selector to be an HTMLButtonElement");
      }
      childIssueButton.click();
      await flushPromises();

      expect(useIssuePaneStore.getState().byThreadId[THREAD_ID]?.selectedIssueId).toBe("TASK-1");
      expect(document.body.textContent).toContain("Refine");
      expect(document.body.textContent).toContain("Implement");
      expect(document.body.textContent).not.toContain("Quick refine");
      expect(document.body.textContent).not.toContain("Planned refine");
      expect(document.body.textContent).not.toContain("Create swarm");
    } finally {
      screen.unmount();
    }
  });

  it("starts epic plan implementation from the issue footer", async () => {
    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-PLAN",
        title: "Plan epic",
        issueType: "epic",
      }),
    ];
    testState.issueDetailsById = {
      "EPIC-PLAN": makeIssueDetail({
        id: "EPIC-PLAN",
        title: "Plan epic",
        issueType: "epic",
      }),
    };
    testState.swarmSupport = { supported: true };
    testState.swarmValidation = {
      valid: false,
      swarm: null,
      errors: ["Epic is missing a swarm."],
      warnings: [],
      readyFronts: [],
      estimatedWorkerSessions: 0,
      maxParallelism: 0,
    };
    testState.swarmStatus = {
      swarm: null,
      completed: [],
      active: [],
      ready: [],
      blocked: [],
    };
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "EPIC-PLAN");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      getButtonByText("Create swarm").click();
      await flushPromises();

      expect(testState.startEpicPlanImplementationSpy).toHaveBeenCalledWith({
        cwd: TEST_CWD,
        projectId: "project-1",
        epicIssueId: "EPIC-PLAN",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4-mini",
        },
        runtimeMode: "full-access",
      });
      expect(testState.invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: ["beads"],
      });
    } finally {
      screen.unmount();
    }
  });

  it("starts issue implementation from the task footer", async () => {
    testState.issueListIssues = [
      makeIssue({
        id: "TASK-IMPLEMENT",
        title: "Implement me",
      }),
    ];
    testState.issueDetailsById = {
      "TASK-IMPLEMENT": makeIssueDetail({
        id: "TASK-IMPLEMENT",
        title: "Implement me",
      }),
    };
    useIssuePaneStore.getState().setSelectedIssueId(THREAD_ID, "TASK-IMPLEMENT");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      getButtonByText("Implement").click();
      await flushPromises();

      expect(testState.startIssueWorkflowSpy).toHaveBeenCalledWith({
        cwd: TEST_CWD,
        projectId: "project-1",
        issueId: "TASK-IMPLEMENT",
        workflow: "solve",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4-mini",
        },
        runtimeMode: "full-access",
      });
    } finally {
      screen.unmount();
    }
  });

  it("opens the start swarm sheet from a ready coordinator card", async () => {
    const swarmSummary = {
      swarmId: "swarm-ready",
      epicId: "EPIC-READY",
      epicTitle: "Ready epic",
      totalIssueCount: 3,
      completedIssueCount: 0,
      activeIssueCount: 0,
      readyIssueCount: 2,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-READY",
        title: "Ready epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmValidationByEpicId = {
      "EPIC-READY": {
        epicId: "EPIC-READY",
        epicTitle: "Ready epic",
        valid: true,
        swarm: swarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-READY": {
        epicId: "EPIC-READY",
        epicTitle: "Ready epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [
          makeIssue({
            id: "TASK-1",
            title: "Ready task",
          }),
        ],
        blocked: [],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      getButtonByText("Start swarm").click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.body.textContent).toContain("Shared workspace");
      expect(document.body.textContent).toContain("Scheduler mode");
      expect(document.body.textContent).toContain("automatic");
      expect(document.body.textContent).toContain("Assistant delivery mode");
    } finally {
      screen.unmount();
    }
  });

  it("surfaces project-level shared-workspace conflicts on ready coordinator cards", async () => {
    const readySwarmSummary = {
      swarmId: "swarm-ready",
      epicId: "EPIC-READY",
      epicTitle: "Ready epic",
      totalIssueCount: 3,
      completedIssueCount: 0,
      activeIssueCount: 0,
      readyIssueCount: 2,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-READY",
        title: "Ready epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "EPIC-BLOCKING",
        title: "Blocking epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmRuns = [
      {
        runId: "run-blocking",
        projectId: "project-1",
        epicIssueId: "EPIC-BLOCKING",
        swarmId: "swarm-blocking",
        status: "running",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: null,
        lastError: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ];
    testState.swarmValidationByEpicId = {
      "EPIC-READY": {
        epicId: "EPIC-READY",
        epicTitle: "Ready epic",
        valid: true,
        swarm: readySwarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-READY": {
        epicId: "EPIC-READY",
        epicTitle: "Ready epic",
        swarm: readySwarmSummary,
        completed: [],
        active: [],
        ready: [
          makeIssue({
            id: "TASK-READY",
            title: "Ready task",
          }),
        ],
        blocked: [],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Shared workspace busy");
      expect(document.body.textContent).toContain("EPIC-BLOCKING");
      expect(document.body.textContent).toContain("Open active swarm");
      expect(document.body.textContent).not.toContain("Start swarm");
    } finally {
      screen.unmount();
    }
  });

  it("renders idle coordinator cards with ready previews and a continue CTA", async () => {
    const swarmSummary = {
      swarmId: "swarm-idle",
      epicId: "EPIC-IDLE",
      epicTitle: "Idle epic",
      totalIssueCount: 4,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 2,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-IDLE",
        title: "Idle epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmRuns = [
      {
        runId: "run-idle",
        projectId: "project-1",
        epicIssueId: "EPIC-IDLE",
        swarmId: "swarm-idle",
        status: "idle",
        schedulerMode: "semi-automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: "execution-1",
        lastError: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: "2026-01-01T00:02:00.000Z",
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ];
    testState.swarmValidationByEpicId = {
      "EPIC-IDLE": {
        epicId: "EPIC-IDLE",
        epicTitle: "Idle epic",
        valid: true,
        swarm: swarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-IDLE": {
        epicId: "EPIC-IDLE",
        epicTitle: "Idle epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [
          makeIssue({
            id: "TASK-NEXT-1",
            title: "First ready issue",
          }),
          makeIssue({
            id: "TASK-NEXT-2",
            title: "Second ready issue",
          }),
        ],
        blocked: [],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Ready for next issue");
      expect(document.body.textContent).toContain("Semi-automatic");
      expect(document.body.textContent).toContain("First ready issue");
      expect(document.body.textContent).toContain("Second ready issue");
      expect(document.body.textContent).toContain("Continue");
    } finally {
      screen.unmount();
    }
  });

  it("renders a recoverable worker-failure coordinator card with manual recovery controls", async () => {
    const swarmSummary = {
      swarmId: "swarm-blocked",
      epicId: "EPIC-BLOCKED",
      epicTitle: "Blocked epic",
      totalIssueCount: 4,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-BLOCKED",
        title: "Blocked epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmRuns = [
      {
        runId: "run-blocked",
        projectId: "project-1",
        epicIssueId: "EPIC-BLOCKED",
        swarmId: "swarm-blocked",
        status: "blocked",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: null,
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: "execution-1",
        lastError: "Worker crashed",
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: "2026-01-01T00:02:00.000Z",
        blockedContext: {
          kind: "worker_failure",
          issueId: "TASK-1",
          executionId: "execution-1",
          workerThreadId: "thread-worker",
        },
        failedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
    ];
    testState.swarmValidationByEpicId = {
      "EPIC-BLOCKED": {
        epicId: "EPIC-BLOCKED",
        epicTitle: "Blocked epic",
        valid: true,
        swarm: swarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-BLOCKED": {
        epicId: "EPIC-BLOCKED",
        epicTitle: "Blocked epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [makeIssue({ id: "TASK-1", title: "Blocked task" })],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      expect(document.body.textContent).toContain("Recoverable worker failure");
      expect(document.body.textContent).toContain(
        "Resolve the tracker state, refresh, then continue the run.",
      );
      expect(document.body.textContent).toContain("Open failed worker");
      expect(document.body.textContent).toContain("Refresh status");
      const continueButton = getButtonByText("Continue");
      expect(continueButton.disabled).toBe(true);
    } finally {
      screen.unmount();
    }
  });

  it("renders coordinator run history rows and worker execution details", async () => {
    const swarmSummary = {
      swarmId: "swarm-history",
      epicId: "EPIC-HISTORY",
      epicTitle: "History epic",
      totalIssueCount: 2,
      completedIssueCount: 2,
      activeIssueCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-HISTORY",
        title: "History epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmRuns = [
      {
        runId: "run-history",
        projectId: "project-1",
        epicIssueId: "EPIC-HISTORY",
        swarmId: "swarm-history",
        status: "completed",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: "execution-history",
        lastError: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: "2026-01-01T00:03:00.000Z",
        updatedAt: "2026-01-01T00:03:00.000Z",
      },
    ];
    testState.swarmTaskExecutions = [
      {
        executionId: "execution-history",
        runId: "run-history",
        issueId: "TASK-HISTORY",
        workerThreadId: "thread-worker-1",
        sequenceNumber: 1,
        status: "completed",
        lastError: null,
        startedAt: "2026-01-01T00:01:00.000Z",
        completedAt: "2026-01-01T00:02:30.000Z",
        failedAt: null,
        cancelledAt: null,
        updatedAt: "2026-01-01T00:02:30.000Z",
      },
    ];
    testState.swarmValidationByEpicId = {
      "EPIC-HISTORY": {
        epicId: "EPIC-HISTORY",
        epicTitle: "History epic",
        valid: true,
        swarm: swarmSummary,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-HISTORY": {
        epicId: "EPIC-HISTORY",
        epicTitle: "History epic",
        swarm: swarmSummary,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      getButtonByText("View history").click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.body.textContent).toContain("Timeline");
      expect(document.body.textContent).toContain("Executions (1)");
      expect(document.body.textContent).toContain("run-history");
      expect(document.body.textContent).toContain("TASK-HISTORY");
      expect(document.body.textContent).toContain("Open worker thread");
    } finally {
      screen.unmount();
    }
  });

  it("groups coordinator cards into needs-attention, active, and history sections", async () => {
    const runningSwarm = {
      swarmId: "swarm-running",
      epicId: "EPIC-RUNNING",
      epicTitle: "Running epic",
      totalIssueCount: 4,
      completedIssueCount: 1,
      activeIssueCount: 1,
      readyIssueCount: 1,
      blockedIssueCount: 0,
      activeWorkerCount: 1,
    };
    const historySwarm = {
      swarmId: "swarm-history",
      epicId: "EPIC-HISTORY",
      epicTitle: "History epic",
      totalIssueCount: 2,
      completedIssueCount: 2,
      activeIssueCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    };

    testState.issueListIssues = [
      makeIssue({
        id: "EPIC-NO-SWARM",
        title: "No swarm epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "EPIC-RUNNING",
        title: "Running epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "EPIC-HISTORY",
        title: "History epic",
        issueType: "epic",
      }),
    ];
    testState.swarmSupport = { supported: true };
    testState.swarmRuns = [
      {
        runId: "run-running",
        projectId: "project-1",
        epicIssueId: "EPIC-RUNNING",
        swarmId: "swarm-running",
        status: "running",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: null,
        lastError: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      },
      {
        runId: "run-history",
        projectId: "project-1",
        epicIssueId: "EPIC-HISTORY",
        swarmId: "swarm-history",
        status: "completed",
        schedulerMode: "semi-automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5.4-mini",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        activeTaskExecutionId: null,
        latestTaskExecutionId: null,
        lastError: null,
        requestedAt: "2026-01-01T00:03:00.000Z",
        startedAt: "2026-01-01T00:04:00.000Z",
        idledAt: null,
        pausedAt: null,
        blockedAt: null,
        blockedContext: null,
        failedAt: null,
        cancelledAt: null,
        completedAt: "2026-01-01T00:05:00.000Z",
        updatedAt: "2026-01-01T00:05:00.000Z",
      },
    ];
    testState.swarmValidationByEpicId = {
      "EPIC-RUNNING": {
        epicId: "EPIC-RUNNING",
        epicTitle: "Running epic",
        valid: true,
        swarm: runningSwarm,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
      "EPIC-HISTORY": {
        epicId: "EPIC-HISTORY",
        epicTitle: "History epic",
        valid: true,
        swarm: historySwarm,
        errors: [],
        warnings: [],
        readyFronts: [],
        estimatedWorkerSessions: 1,
        maxParallelism: 1,
      },
    };
    testState.swarmStatusByEpicId = {
      "EPIC-RUNNING": {
        epicId: "EPIC-RUNNING",
        epicTitle: "Running epic",
        swarm: runningSwarm,
        completed: [],
        active: [makeIssue({ id: "TASK-ACTIVE", title: "Active task" })],
        ready: [makeIssue({ id: "TASK-READY", title: "Ready task" })],
        blocked: [],
      },
      "EPIC-HISTORY": {
        epicId: "EPIC-HISTORY",
        epicTitle: "History epic",
        swarm: historySwarm,
        completed: [],
        active: [],
        ready: [],
        blocked: [],
      },
    };
    useIssuePaneStore.getState().setActivePanelTab(THREAD_ID, "coordinator");

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <IssuesPanel
        activeThreadId={THREAD_ID}
        cwd={TEST_CWD}
        projectId={ProjectId.makeUnsafe("project-1")}
        projectDefaultModelSelection={null}
        onClose={() => {}}
      />,
      { container: host },
    );

    try {
      const needsAttentionHeading = [...document.querySelectorAll("h3")].find((candidate) =>
        candidate.textContent?.includes("Needs Attention (1)"),
      );
      const activeHeading = [...document.querySelectorAll("h3")].find((candidate) =>
        candidate.textContent?.includes("Active (1)"),
      );
      const historyHeading = [...document.querySelectorAll("h3")].find((candidate) =>
        candidate.textContent?.includes("History (1)"),
      );
      const needsAttentionSection = needsAttentionHeading?.closest("section");
      const activeSection = activeHeading?.closest("section");
      const historySection = historyHeading?.closest("section");

      expect(needsAttentionSection?.textContent).toContain("No swarm epic");
      expect(needsAttentionSection?.textContent).toContain("Create swarm");
      expect(activeSection?.textContent).toContain("Running epic");
      expect(activeSection?.textContent).toContain("Automatic");
      expect(historySection?.textContent).toContain("History epic");
      expect(historySection?.textContent).toContain("Semi-automatic");
    } finally {
      screen.unmount();
    }
  });
});
