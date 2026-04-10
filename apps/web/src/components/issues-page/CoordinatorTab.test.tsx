import type { BeadsCoordinatorEpicSnapshot } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoordinatorTab } from "./CoordinatorTab";

const SWARM_SUPPORT = {
  supported: true,
  reason: null,
  backend: {
    kind: "dolt",
    doltMode: null,
    database: null,
    projectId: null,
    role: null,
    bdVersion: null,
  },
} as const;

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1",
  epicTitle: "Epic 1",
  issue: null,
  trackerLoadState: "ready",
  trackerLoadDetail: null,
  coordinationSupported: true,
  coordinationUnsupportedReason: null,
  validationState: "valid",
  validationErrors: [],
  trackerState: "not_started",
  progress: {
    totalIssueCount: 1,
    completedIssueCount: 0,
    readyIssueCount: 1,
    activeIssueCount: 0,
    blockedIssueCount: 0,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: 0,
    activeWorkerCount: 0,
    isComplete: false,
  },
  primaryAction: {
    kind: "start_swarm",
    label: "Start run",
    busyLabel: "Starting...",
    disabled: false,
  },
  activeRunId: null,
  activeExecutionId: null,
  projectConflict: null,
  swarmSummary: null,
  validation: null,
  status: null,
  runs: [
    {
      runId: "run-1" as never,
      projectId: "project-1" as never,
      epicIssueId: "EPIC-1",
      status: "cancelled",
      schedulerMode: "automatic",
      workspaceMode: "shared",
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: null,
      providerOptions: null,
      assistantDeliveryMode: null,
      runtimeMode: "full-access",
      lastError: null,
      requestedAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
      idledAt: null,
      pausedAt: null,
      blockedAt: null,
      blockedContext: null,
      failedAt: null,
      cancelledAt: "2026-04-08T00:00:02.000Z",
      completedAt: null,
      updatedAt: "2026-04-08T00:00:02.000Z",
    },
  ],
  executions: [],
} as BeadsCoordinatorEpicSnapshot;

function renderCoordinatorTab(epicOverrides?: Partial<BeadsCoordinatorEpicSnapshot>) {
  const queryClient = new QueryClient();
  const epic = { ...BASE_EPIC, ...epicOverrides };

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CoordinatorTab
        cwd="/repo"
        projectId={null}
        swarmSupport={SWARM_SUPPORT}
        swarmSupportPending={false}
        swarmSupportError={null}
        snapshot={{
          projectId: "project-1" as never,
          support: SWARM_SUPPORT,
          epics: [epic],
        }}
        snapshotPending={false}
        snapshotError={null}
        selectedEpicId="EPIC-1"
        onSelectEpic={() => {}}
        onOpenEpicIssue={() => {}}
        onOpenThread={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("CoordinatorTab actions", () => {
  it("renders latest run history separately from tracker state", () => {
    const markup = renderCoordinatorTab();

    expect(markup).toContain("Tracker: Ready");
    expect(markup).toContain("Latest run: Cancelled");
    expect(markup).toContain("Start run");
  });
});

describe("WorkGraph integration", () => {
  it("renders Work Graph heading", () => {
    const markup = renderCoordinatorTab();
    expect(markup).toContain("Work Graph");
  });

  it("shows 'No issues tracked yet' when status is null", () => {
    const markup = renderCoordinatorTab({ status: null });
    expect(markup).toContain("No issues tracked yet");
  });

  it("renders run bar with latest run info", () => {
    const markup = renderCoordinatorTab();
    // The run bar should show the latest run as "Cancelled".
    expect(markup).toContain("Cancelled");
  });

  it("renders wave columns when validation has readyFronts", () => {
    const issueA = {
      id: "ISSUE-A",
      title: "Task Alpha",
      status: "open",
      priority: null,
      issueType: "task",
      assignee: null,
      owner: null,
      parent: null,
    };
    const issueB = {
      id: "ISSUE-B",
      title: "Task Beta",
      status: "open",
      priority: null,
      issueType: "task",
      assignee: null,
      owner: null,
      parent: null,
    };

    const markup = renderCoordinatorTab({
      activeRunId: "run-1" as never,
      runs: [
        {
          ...BASE_EPIC.runs[0]!,
          status: "running",
          cancelledAt: null,
        },
      ],
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        swarm: null,
        completed: [],
        active: [],
        ready: [issueA, issueB],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      } as BeadsCoordinatorEpicSnapshot["status"],
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        swarm: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[issueA], [issueB]],
        maxParallelism: 1,
        estimatedWorkerSessions: 2,
      } as BeadsCoordinatorEpicSnapshot["validation"],
      progress: {
        totalIssueCount: 2,
        completedIssueCount: 0,
        readyIssueCount: 2,
        activeIssueCount: 0,
        blockedIssueCount: 0,
        internalBlockedIssueCount: 0,
        externalBlockedIssueCount: 0,
        unknownBlockedIssueCount: 0,
        activeWorkerCount: 0,
        isComplete: false,
      },
    });

    expect(markup).toContain("Wave 1");
    expect(markup).toContain("Wave 2");
    expect(markup).toContain("Task Alpha");
    expect(markup).toContain("Task Beta");
    expect(markup).toContain("Max parallelism: 1");
  });

  it("renders fallback Issues column when no wave data", () => {
    const issueA = {
      id: "ISSUE-A",
      title: "Task Alpha",
      status: "open",
      priority: null,
      issueType: "task",
      assignee: null,
      owner: null,
      parent: null,
    };

    const markup = renderCoordinatorTab({
      activeRunId: "run-1" as never,
      runs: [
        {
          ...BASE_EPIC.runs[0]!,
          status: "running",
          cancelledAt: null,
        },
      ],
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        swarm: null,
        completed: [],
        active: [],
        ready: [issueA],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      } as BeadsCoordinatorEpicSnapshot["status"],
      validation: null,
      progress: {
        totalIssueCount: 1,
        completedIssueCount: 0,
        readyIssueCount: 1,
        activeIssueCount: 0,
        blockedIssueCount: 0,
        internalBlockedIssueCount: 0,
        externalBlockedIssueCount: 0,
        unknownBlockedIssueCount: 0,
        activeWorkerCount: 0,
        isComplete: false,
      },
    });

    expect(markup).toContain("Issues");
    expect(markup).toContain("Task Alpha");
    // Should NOT contain wave headers.
    expect(markup).not.toContain("Wave 1");
  });

  it("renders execution sequence badge on issue nodes", () => {
    const issueA = {
      id: "ISSUE-A",
      title: "Task Alpha",
      status: "done",
      priority: null,
      issueType: "task",
      assignee: null,
      owner: null,
      parent: null,
    };

    const markup = renderCoordinatorTab({
      activeRunId: "run-1" as never,
      runs: [
        {
          ...BASE_EPIC.runs[0]!,
          status: "completed",
          cancelledAt: null,
          completedAt: "2026-04-08T00:00:10.000Z",
        },
      ],
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        swarm: null,
        completed: [issueA],
        active: [],
        ready: [],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      } as BeadsCoordinatorEpicSnapshot["status"],
      executions: [
        {
          executionId: "exec-1" as never,
          runId: "run-1" as never,
          issueId: "ISSUE-A",
          workerThreadId: null,
          sequenceNumber: 1,
          status: "completed",
          originalStatus: "open",
          originalAssignee: null,
          lastError: null,
          requestedAt: "2026-04-08T00:00:00.000Z",
          startedAt: "2026-04-08T00:00:01.000Z",
          completedAt: "2026-04-08T00:00:10.000Z",
          failedAt: null,
          cancelledAt: null,
          updatedAt: "2026-04-08T00:00:10.000Z",
        },
      ],
      progress: {
        totalIssueCount: 1,
        completedIssueCount: 1,
        readyIssueCount: 0,
        activeIssueCount: 0,
        blockedIssueCount: 0,
        internalBlockedIssueCount: 0,
        externalBlockedIssueCount: 0,
        unknownBlockedIssueCount: 0,
        activeWorkerCount: 0,
        isComplete: true,
      },
    });

    expect(markup).toContain("Completed");
    expect(markup).toContain("Task Alpha");
    // Execution sequence number badge.
    expect(markup).toContain("#1");
  });
});

describe("Activity log integration", () => {
  it("renders Activity section when runs exist", () => {
    const markup = renderCoordinatorTab();
    expect(markup).toContain("Activity");
    // Should contain run lifecycle entries.
    expect(markup).toContain("Run requested");
    expect(markup).toContain("Run cancelled");
  });

  it("does not render Activity section when no runs or executions", () => {
    const markup = renderCoordinatorTab({ runs: [], executions: [] });
    expect(markup).not.toContain("Run requested");
  });

  it("renders execution entries in the activity log", () => {
    const markup = renderCoordinatorTab({
      runs: [BASE_EPIC.runs[0]!],
      executions: [
        {
          executionId: "exec-1" as never,
          runId: "run-1" as never,
          issueId: "ISSUE-A",
          workerThreadId: null,
          sequenceNumber: 1,
          status: "completed",
          originalStatus: "open",
          originalAssignee: null,
          lastError: null,
          requestedAt: "2026-04-08T00:00:02.000Z",
          startedAt: "2026-04-08T00:00:03.000Z",
          completedAt: "2026-04-08T00:00:10.000Z",
          failedAt: null,
          cancelledAt: null,
          updatedAt: "2026-04-08T00:00:10.000Z",
        },
      ],
    });
    expect(markup).toContain("Task #1 started: ISSUE-A");
    expect(markup).toContain("Task #1 completed: ISSUE-A");
  });
});
