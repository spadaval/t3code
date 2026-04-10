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

function makeIssueSummary(status: "open" | "closed") {
  return {
    id: "EPIC-1",
    title: "Epic 1",
    description: null,
    notes: null,
    status,
    priority: null,
    issueType: "epic",
    assignee: null,
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    labels: [],
    parent: null,
  } as const;
}

const BASE_EPIC = {
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
    kind: "start_epic_run",
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
      status: "stopped",
      provider: "codex",
      model: "gpt-5.4",
      modelOptions: null,
      providerOptions: null,
      assistantDeliveryMode: null,
      runtimeMode: "full-access",
      failureContext: null,
      requestedAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
      stopRequestedAt: "2026-04-08T00:00:02.000Z",
      stoppedAt: "2026-04-08T00:00:02.000Z",
      failedAt: null,
      completedAt: null,
      updatedAt: "2026-04-08T00:00:02.000Z",
    },
  ],
  executions: [],
} as unknown as BeadsCoordinatorEpicSnapshot;

function renderCoordinatorTab(epicOverrides?: Partial<BeadsCoordinatorEpicSnapshot>) {
  const queryClient = new QueryClient();
  const epic = { ...BASE_EPIC, ...epicOverrides };

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CoordinatorTab
        cwd="/repo"
        projectId={null}
        coordinationSupport={SWARM_SUPPORT}
        coordinationSupportPending={false}
        coordinationSupportError={null}
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
    expect(markup).toContain("Latest run: Stopped");
    expect(markup).toContain("Start run");
  });

  it("strikes through epic titles only when the tracker issue is closed", () => {
    const closedMarkup = renderCoordinatorTab({
      issue: makeIssueSummary("closed") as BeadsCoordinatorEpicSnapshot["issue"],
    });
    const derivedDoneMarkup = renderCoordinatorTab({
      issue: makeIssueSummary("open") as BeadsCoordinatorEpicSnapshot["issue"],
      trackerState: "completed",
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

    expect(closedMarkup).toMatch(/<p class="[^"]*line-through[^"]*">Epic 1<\/p>/);
    expect(closedMarkup).toMatch(/<h2 class="[^"]*line-through[^"]*">Epic 1<\/h2>/);
    expect(derivedDoneMarkup).not.toMatch(/<p class="[^"]*line-through[^"]*">Epic 1<\/p>/);
    expect(derivedDoneMarkup).not.toMatch(/<h2 class="[^"]*line-through[^"]*">Epic 1<\/h2>/);
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
    expect(markup).toContain("Latest run: Stopped");
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
          stopRequestedAt: null,
          stoppedAt: null,
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
          stopRequestedAt: null,
          stoppedAt: null,
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
          stopRequestedAt: null,
          stoppedAt: null,
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
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-04-08T00:00:00.000Z",
          startedAt: "2026-04-08T00:00:01.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: "2026-04-08T00:00:10.000Z",
          failedAt: null,
          updatedAt: "2026-04-08T00:00:10.000Z",
        } as unknown as BeadsCoordinatorEpicSnapshot["executions"][number],
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

describe("Legacy activity log removal", () => {
  it("does not render the removed Activity section when runs exist", () => {
    const markup = renderCoordinatorTab();
    expect(markup).not.toContain("Activity");
    expect(markup).not.toContain("Run requested");
    expect(markup).not.toContain("Run stopped");
  });

  it("still does not render Activity entries when no runs or executions exist", () => {
    const markup = renderCoordinatorTab({ runs: [], executions: [] });
    expect(markup).not.toContain("Activity");
    expect(markup).not.toContain("Run requested");
  });

  it("does not render legacy execution activity entries", () => {
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
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-04-08T00:00:02.000Z",
          startedAt: "2026-04-08T00:00:03.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: "2026-04-08T00:00:10.000Z",
          failedAt: null,
          updatedAt: "2026-04-08T00:00:10.000Z",
        } as unknown as BeadsCoordinatorEpicSnapshot["executions"][number],
      ],
    });
    expect(markup).not.toContain("Task #1 started: ISSUE-A");
    expect(markup).not.toContain("Task #1 completed: ISSUE-A");
  });
});
