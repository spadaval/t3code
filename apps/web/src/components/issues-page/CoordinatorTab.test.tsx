import type {
  BeadsCoordinatorEpicSnapshot,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { CoordinatorTab } from "./CoordinatorTab";

const SUPPORT = {
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

function makeRun(
  runId: string,
  status: OrchestrationEpicRun["status"],
  overrides: Partial<OrchestrationEpicRun> = {},
): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status,
    provider: "codex",
    model: "gpt-5.4",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    failureContext:
      status === "failed"
        ? {
            kind: "issue_incomplete",
            issueId: "TASK-1",
            executionId: null,
            workerThreadId: null,
            message: "Task stayed open after the worker completed.",
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: status === "stopping" ? "2026-04-08T00:00:02.000Z" : null,
    stoppedAt: status === "stopped" ? "2026-04-08T00:00:03.000Z" : null,
    failedAt: status === "failed" ? "2026-04-08T00:00:03.000Z" : null,
    completedAt: status === "completed" ? "2026-04-08T00:00:03.000Z" : null,
    updatedAt: "2026-04-08T00:00:04.000Z",
    ...overrides,
  };
}

function makeExecution(
  executionId: string,
  runId: string,
  status: OrchestrationEpicIssueExecution["status"],
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: runId as never,
    issueId: "TASK-1",
    workerThreadId: "thread-1" as never,
    sequenceNumber: 1,
    status,
    workspaceKey: "shared",
    workspacePath: null,
    failureContext:
      status === "failed"
        ? {
            kind: "worker_failure",
            issueId: "TASK-1",
            executionId: executionId as never,
            workerThreadId: "thread-1" as never,
            message: "Worker crashed.",
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: status === "stopped" ? "2026-04-08T00:00:02.000Z" : null,
    completedAt: status === "completed" ? "2026-04-08T00:00:02.000Z" : null,
    failedAt: status === "failed" ? "2026-04-08T00:00:02.000Z" : null,
    updatedAt: "2026-04-08T00:00:02.000Z",
  };
}

function makeEpic(
  epicId: string,
  runs: readonly OrchestrationEpicRun[],
  overrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsCoordinatorEpicSnapshot {
  return {
    epicId,
    epicTitle: epicId === "EPIC-NO-RUN" ? "No Run Epic" : `Title ${epicId}`,
    issue: null,
    trackerLoadState: "ready",
    trackerLoadDetail: null,
    coordinationSupported: true,
    coordinationUnsupportedReason: null,
    validationState: "valid",
    validationErrors: [],
    trackerState: runs.length > 0 ? "in_progress" : "not_started",
    progress: {
      totalIssueCount: 3,
      completedIssueCount: 1,
      readyIssueCount: 1,
      activeIssueCount: runs.some((run) => run.status === "running") ? 1 : 0,
      blockedIssueCount: 0,
      internalBlockedIssueCount: 0,
      externalBlockedIssueCount: 0,
      unknownBlockedIssueCount: 0,
      activeWorkerCount: runs.some((run) => run.status === "running") ? 1 : 0,
      isComplete: false,
    },
    primaryAction: {
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    },
    activeRunId: runs.find((run) => run.status === "running")?.runId ?? null,
    activeExecutionId: null,
    projectConflict: null,
    trackerSummary: null,
    validation: null,
    status: null,
    runs,
    executions: [],
    ...overrides,
  } as BeadsCoordinatorEpicSnapshot;
}

function renderCoordinator(input: {
  epics: readonly BeadsCoordinatorEpicSnapshot[];
  selectedEpicId?: string;
  selectedRunId?: string;
}) {
  const queryClient = new QueryClient();
  for (const epic of input.epics) {
    queryClient.setQueryData(
      beadsQueryKeys.epicIssueSummaries({
        cwd: "/repo",
        epicIssueId: epic.epicId,
      }),
      {
        epicId: epic.epicId,
        epicTitle: epic.epicTitle,
        progress: epic.progress,
        issues: [],
      },
    );
    queryClient.setQueryData(
      beadsQueryKeys.epicTrackerDetail({
        cwd: "/repo",
        projectId: "project-1" as never,
        epicIssueId: epic.epicId,
      }),
      {
        epicId: epic.epicId,
        support: SUPPORT,
        trackerLoadState: epic.trackerLoadState,
        trackerLoadDetail: epic.trackerLoadDetail,
        validationState: epic.validationState,
        validationErrors: epic.validationErrors,
        trackerState: epic.trackerState,
        trackerSummary: epic.trackerSummary,
        validation: epic.validation,
        status: epic.status,
        primaryAction: epic.primaryAction,
      },
    );
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CoordinatorTab
        cwd="/repo"
        projectId={"project-1" as never}
        coordinationSupport={SUPPORT}
        coordinationSupportPending={false}
        coordinationSupportError={null}
        runSummary={{
          projectId: "project-1" as never,
          epics: input.epics.map((epic) => ({
            epicIssueId: epic.epicId,
            epicTitle: epic.epicTitle,
            runs: [...epic.runs],
            executions: [...epic.executions],
          })),
        }}
        runSummaryPending={false}
        runSummaryError={null}
        selectedEpicId={input.selectedEpicId ?? null}
        selectedRunId={input.selectedRunId ?? null}
        onSelectEpic={() => {}}
        onSelectRun={() => {}}
        onOpenEpicIssue={() => {}}
        onOpenThread={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("CoordinatorTab", () => {
  it("excludes epics with no runs and groups run output by section", () => {
    const markup = renderCoordinator({
      epics: [
        makeEpic("EPIC-NO-RUN", []),
        makeEpic("EPIC-A", [makeRun("run-active", "running")], {
          primaryAction: {
            kind: "stop_epic_run",
            label: "Stop run",
            busyLabel: "Stopping...",
            disabled: false,
          },
        }),
        makeEpic("EPIC-B", [makeRun("run-failed", "failed")]),
        makeEpic("EPIC-C", [makeRun("run-done", "completed")]),
      ],
      selectedRunId: "run-active",
    });

    expect(markup).toContain("Active");
    expect(markup).toContain("Needs Intervention");
    expect(markup).toContain("History");
    expect(markup).not.toContain("No Run Epic");
    expect(markup).toContain("Title EPIC-A");
    expect(markup).toContain("Title EPIC-B");
    expect(markup).toContain("Title EPIC-C");
  });

  it("renders failed run detail with exact failure text and retry action", () => {
    const markup = renderCoordinator({
      epics: [
        makeEpic("EPIC-FAIL", [makeRun("run-failed", "failed")], {
          primaryAction: {
            kind: "start_epic_run",
            label: "Start epic",
            busyLabel: "Starting...",
            disabled: false,
          },
        }),
      ],
      selectedEpicId: "EPIC-FAIL",
      selectedRunId: "run-failed",
    });

    expect(markup).toContain("Run Timeline");
    expect(markup).toContain("Task stayed open after the worker completed.");
    expect(markup).toContain("Retry run");
  });

  it("renders active run detail with stop action and execution output", () => {
    const markup = renderCoordinator({
      epics: [
        makeEpic("EPIC-RUN", [makeRun("run-active", "running")], {
          primaryAction: {
            kind: "stop_epic_run",
            label: "Stop run",
            busyLabel: "Stopping...",
            disabled: false,
          },
          executions: [makeExecution("exec-1", "run-active", "running")],
        }),
      ],
      selectedEpicId: "EPIC-RUN",
      selectedRunId: "run-active",
    });

    expect(markup).toContain("Stop run");
    expect(markup).toContain("Executions");
    expect(markup).toContain("Open thread");
  });

  it("renders refresh action when tracker state needs refresh", () => {
    const markup = renderCoordinator({
      epics: [
        makeEpic("EPIC-REFRESH", [makeRun("run-stopped", "stopped")], {
          trackerLoadState: "error",
          trackerLoadDetail: "Tracker request timed out.",
          primaryAction: {
            kind: "refresh_epic_status",
            label: "Retry epic status",
            busyLabel: "Retrying...",
            disabled: false,
          },
        }),
      ],
      selectedEpicId: "EPIC-REFRESH",
      selectedRunId: "run-stopped",
    });

    expect(markup).toContain("Refresh status");
    expect(markup).toContain("Tracker request timed out.");
  });
});
