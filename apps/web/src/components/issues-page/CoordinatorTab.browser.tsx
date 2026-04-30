import "../../index.css";

import type {
  BeadsCoordinatorEpicSnapshot,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ProjectId,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { runActionSpy } = vi.hoisted(() => ({
  runActionSpy: vi.fn(),
}));

vi.mock("~/hooks/useEpicCoordinatorActionRunner", () => ({
  getCoordinatorActionBusyKey: (action: {
    kind: string;
    epicIssueId?: string;
    runId?: string | null;
  }) =>
    action.kind === "stop_epic_run"
      ? `stop:${action.runId}`
      : action.kind === "refresh_epic_status"
        ? `refresh:${action.epicIssueId}`
        : action.kind === "start_epic_run"
          ? `start:${action.epicIssueId}`
          : `open:${action.epicIssueId}:${action.runId ?? "latest"}`,
  getCoordinatorPrimaryActionInput: (epic: {
    epicId: string;
    primaryAction: { kind: string };
    activeRunId: string | null;
    runs: readonly OrchestrationEpicRun[];
  }) => {
    switch (epic.primaryAction.kind) {
      case "stop_epic_run":
        return epic.activeRunId ? { kind: "stop_epic_run", runId: epic.activeRunId } : null;
      case "refresh_epic_status":
        return { kind: "refresh_epic_status", epicIssueId: epic.epicId };
      case "start_epic_run":
        return { kind: "start_epic_run", epicIssueId: epic.epicId };
      default:
        return null;
    }
  },
  useEpicCoordinatorActionRunner: () => ({
    busyActionKey: null,
    runAction: runActionSpy,
  }),
}));

vi.mock("~/storeSelectors", () => ({
  useProjectById: () => null,
}));

vi.mock("./WorkGraph", () => ({
  WorkGraph: () => null,
}));

import { CoordinatorTab } from "./CoordinatorTab";
import { beadsQueryKeys } from "~/lib/beadsReactQuery";

const PROJECT_ID = "project-1" as ProjectId;

function createRun(
  runId: string,
  status: OrchestrationEpicRun["status"],
  overrides: Partial<OrchestrationEpicRun> = {},
): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: PROJECT_ID,
    epicIssueId: "EPIC-1",
    status,
    provider: "codex" as never,
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
    stopRequestedAt: null,
    stoppedAt: status === "stopped" ? "2026-04-08T00:00:02.000Z" : null,
    failedAt: status === "failed" ? "2026-04-08T00:00:02.000Z" : null,
    completedAt: status === "completed" ? "2026-04-08T00:00:02.000Z" : null,
    updatedAt: "2026-04-08T00:00:02.000Z",
    ...overrides,
  };
}

function createExecution(executionId: string, runId: string): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: runId as never,
    issueId: "TASK-1",
    workerThreadId: "thread-1" as never,
    sequenceNumber: 1,
    status: "running",
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    updatedAt: "2026-04-08T00:00:02.000Z",
  };
}

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1" as never,
  epicTitle: "Epic 1",
  issue: null,
  coordinationLoadState: "ready",
  coordinationLoadDetail: null,
  validationState: "valid",
  validationErrors: [],
  coordinationState: "in_progress",
  progress: {
    totalIssueCount: 3,
    completedIssueCount: 1,
    readyIssueCount: 1,
    activeIssueCount: 1,
    blockedIssueCount: 0,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: 0,
    activeWorkerCount: 1,
    isComplete: false,
  },
  primaryAction: {
    kind: "stop_epic_run",
    label: "Stop run",
    busyLabel: "Stopping...",
    disabled: false,
  },
  activeRunId: "run-1" as never,
  activeExecutionId: null,
  projectConflict: null,
  summary: null,
  validation: null,
  status: null,
  runs: [createRun("run-1", "running")],
  executions: [createExecution("exec-1", "run-1")],
};

function createSnapshot(
  epicOverrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsCoordinatorEpicSnapshot {
  return {
    ...BASE_EPIC,
    ...epicOverrides,
    progress: {
      ...BASE_EPIC.progress,
      ...epicOverrides.progress,
    },
    primaryAction: {
      ...BASE_EPIC.primaryAction,
      ...epicOverrides.primaryAction,
    },
    runs: epicOverrides.runs ?? BASE_EPIC.runs,
    executions: epicOverrides.executions ?? BASE_EPIC.executions,
  };
}

async function renderCoordinator(epicOverrides: Partial<BeadsCoordinatorEpicSnapshot> = {}) {
  const epic = createSnapshot(epicOverrides);
  const queryClient = new QueryClient();
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
    beadsQueryKeys.epicCoordinationDetail({
      cwd: "/repo",
      projectId: PROJECT_ID,
      epicIssueId: epic.epicId,
    }),
    {
      epicId: epic.epicId,
      coordinationLoadState: epic.coordinationLoadState,
      coordinationLoadDetail: epic.coordinationLoadDetail,
      validationState: epic.validationState,
      validationErrors: epic.validationErrors,
      coordinationState: epic.coordinationState,
      summary: epic.summary,
      validation: epic.validation,
      status: epic.status,
      primaryAction: epic.primaryAction,
    },
  );
  await render(
    <QueryClientProvider client={queryClient}>
      <CoordinatorTab
        cwd="/repo"
        projectId={PROJECT_ID}
        runSummary={{
          projectId: PROJECT_ID,
          epics: [
            {
              epicIssueId: epic.epicId,
              epicTitle: epic.epicTitle,
              runs: epic.runs,
              executions: epic.executions,
            },
          ],
        }}
        runSummaryPending={false}
        runSummaryError={null}
        selectedEpicId="EPIC-1"
        selectedRunId={(epicOverrides.runs?.[0] ?? BASE_EPIC.runs[0])?.runId ?? null}
        onSelectEpic={() => {}}
        onSelectRun={() => {}}
        onOpenEpicIssue={() => {}}
        onOpenThread={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("CoordinatorTab browser coverage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("dispatches stop for an active run", async () => {
    await renderCoordinator();

    const button = page.getByRole("button", { name: "Stop run" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "stop_epic_run",
      runId: "run-1",
    });
  });

  it("dispatches retry for a failed run", async () => {
    await renderCoordinator({
      coordinationState: "not_started",
      primaryAction: {
        kind: "start_epic_run",
        label: "Start epic",
        busyLabel: "Starting...",
        disabled: false,
      },
      activeRunId: null,
      runs: [createRun("run-failed", "failed")],
      executions: [],
    });

    const button = page.getByRole("button", { name: "Retry run" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "start_epic_run",
      epicIssueId: "EPIC-1",
    });
  });

  it("dispatches refresh for stale tracker output", async () => {
    await renderCoordinator({
      coordinationLoadState: "error",
      coordinationLoadDetail: "Tracker request timed out.",
      activeRunId: null,
      primaryAction: {
        kind: "refresh_epic_status",
        label: "Retry epic status",
        busyLabel: "Retrying...",
        disabled: false,
      },
      runs: [createRun("run-stopped", "stopped")],
      executions: [],
    });

    const button = page.getByRole("button", { name: "Refresh status" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "refresh_epic_status",
      epicIssueId: "EPIC-1",
    });
  });
});
