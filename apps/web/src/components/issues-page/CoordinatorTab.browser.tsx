import "../../index.css";

import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsProjectCoordinatorSnapshot,
  OrchestrationEpicRun,
  ProjectId,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { runActionSpy } = vi.hoisted(() => ({
  runActionSpy: vi.fn(),
}));

vi.mock("~/hooks/useEpicCoordinatorActionRunner", () => ({
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

const PROJECT_ID = "project-1" as ProjectId;

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

const FAILED_REASON = "Issue stayed open after the worker completed.";

function createRun(overrides: Partial<OrchestrationEpicRun> = {}): OrchestrationEpicRun {
  return {
    runId: "run-1" as never,
    projectId: PROJECT_ID,
    epicIssueId: "EPIC-1",
    status: "running",
    provider: "codex",
    model: "gpt-5.4",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: "2026-04-08T00:00:02.000Z",
    ...overrides,
  };
}

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1" as never,
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
    totalIssueCount: 3,
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
  runs: [],
  executions: [],
};

function createEpic(
  overrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsCoordinatorEpicSnapshot {
  return {
    ...BASE_EPIC,
    ...overrides,
    progress: {
      ...BASE_EPIC.progress,
      ...overrides.progress,
    },
    primaryAction: {
      ...BASE_EPIC.primaryAction,
      ...overrides.primaryAction,
    },
    runs: overrides.runs ?? BASE_EPIC.runs,
    executions: overrides.executions ?? BASE_EPIC.executions,
  };
}

function createSnapshot(
  epicOverrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsProjectCoordinatorSnapshot {
  return {
    projectId: PROJECT_ID,
    support: SUPPORT,
    epics: [createEpic(epicOverrides)],
  };
}

async function renderCoordinator(epicOverrides: Partial<BeadsCoordinatorEpicSnapshot> = {}) {
  await render(
    <CoordinatorTab
      cwd="/repo"
      projectId={PROJECT_ID}
      coordinationSupport={SUPPORT}
      coordinationSupportPending={false}
      coordinationSupportError={null}
      snapshot={createSnapshot(epicOverrides)}
      snapshotPending={false}
      snapshotError={null}
      selectedEpicId="EPIC-1"
      onSelectEpic={() => {}}
      onOpenEpicIssue={() => {}}
      onOpenThread={() => {}}
    />,
  );
}

describe("CoordinatorTab browser coverage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the prep-thread state and opens the prep action", async () => {
    await renderCoordinator({
      validationState: "invalid",
      validationErrors: ["Epic needs prep before it can run."],
      primaryAction: {
        kind: "open_coordination_prep_thread",
        label: "Open prep thread",
        busyLabel: "Opening...",
        disabled: false,
      },
    });

    await expect.element(page.getByText("Invalid to start")).toBeInTheDocument();
    await expect
      .element(page.getByText("Epic needs prep before it can run.", { exact: true }).first())
      .toBeInTheDocument();

    const button = page.getByRole("button", { name: "Open prep thread" });
    await expect.element(button).toBeInTheDocument();
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "open_coordination_prep_thread",
      epicIssueId: "EPIC-1",
    });
  });

  it("renders tracker-blocked state and refresh action", async () => {
    await renderCoordinator({
      trackerState: "blocked",
      progress: {
        ...BASE_EPIC.progress,
        blockedIssueCount: 2,
        externalBlockedIssueCount: 2,
        readyIssueCount: 0,
      },
      primaryAction: {
        kind: "refresh_epic_status",
        label: "Refresh status",
        busyLabel: "Refreshing...",
        disabled: false,
      },
    });

    await expect
      .element(page.getByText("2 externally blocked issues in Beads", { exact: true }).first())
      .toBeInTheDocument();

    const button = page.getByRole("button", { name: "Refresh status" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "refresh_epic_status",
      epicIssueId: "EPIC-1",
    });
  });

  it("renders a startable epic and dispatches start", async () => {
    await renderCoordinator();

    await expect
      .element(page.getByText("Tracker is ready for a run.", { exact: true }).first())
      .toBeInTheDocument();

    const button = page.getByRole("button", { name: "Start run" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "start_epic_run",
      epicIssueId: "EPIC-1",
    });
  });

  it("renders a running epic and dispatches stop", async () => {
    await renderCoordinator({
      activeRunId: "run-1" as never,
      trackerState: "in_progress",
      progress: {
        ...BASE_EPIC.progress,
        totalIssueCount: 3,
        completedIssueCount: 1,
        activeIssueCount: 1,
        readyIssueCount: 1,
        activeWorkerCount: 1,
      },
      primaryAction: {
        kind: "stop_epic_run",
        label: "Stop run",
        busyLabel: "Stopping...",
        disabled: false,
      },
      runs: [createRun()],
    });

    await expect
      .element(page.getByText("1 worker active, 1/3 issues done", { exact: true }).first())
      .toBeInTheDocument();

    const button = page.getByRole("button", { name: "Stop run" });
    await button.click({ force: true });
    expect(runActionSpy).toHaveBeenCalledWith({
      kind: "stop_epic_run",
      runId: "run-1",
    });
  });

  it("renders stopped run history with restart guidance", async () => {
    await renderCoordinator({
      runs: [
        createRun({
          status: "stopped",
          stopRequestedAt: "2026-04-08T00:00:02.000Z",
          stoppedAt: "2026-04-08T00:00:02.000Z",
          startedAt: "2026-04-08T00:00:01.000Z",
          updatedAt: "2026-04-08T00:00:02.000Z",
        }),
      ],
    });

    await expect.element(page.getByText("Latest run: Stopped")).toBeInTheDocument();
    await expect
      .element(page.getByText("The latest run was stopped. Start a new run to continue."))
      .toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });

  it("renders failed run state with the exact failure reason and restart guidance", async () => {
    await renderCoordinator({
      runs: [
        createRun({
          status: "failed",
          failureContext: {
            kind: "issue_incomplete",
            message: FAILED_REASON,
            issueId: "TASK-1",
            executionId: null,
            workerThreadId: null,
          },
          failedAt: "2026-04-08T00:00:02.000Z",
          updatedAt: "2026-04-08T00:00:02.000Z",
        }),
      ],
    });

    await expect.element(page.getByText("Latest run: Failed")).toBeInTheDocument();
    await expect
      .element(page.getByText(FAILED_REASON, { exact: true }).first())
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Fix the underlying issue, then start a new run."))
      .toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Start run" })).toBeInTheDocument();
  });
});
