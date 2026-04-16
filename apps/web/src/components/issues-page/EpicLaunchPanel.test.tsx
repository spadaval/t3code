import type {
  BeadsCoordinatorEpicSnapshot,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ProjectId,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { useIssueWorkflowLaunchers } from "../issue/IssueWorkflowActions";
import { EpicLaunchPanel } from "./EpicLaunchPanel";

const PROJECT_ID = "project-1" as ProjectId;

function makeRun(runId: string, status: OrchestrationEpicRun["status"]): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: PROJECT_ID,
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
            issueId: "TASK-2",
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
  };
}

function makeExecution(
  executionId: string,
  issueId: string,
  status: OrchestrationEpicIssueExecution["status"],
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: "run-1" as never,
    issueId,
    workerThreadId: "thread-1" as never,
    sequenceNumber: executionId === "exec-1" ? 1 : 2,
    status,
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: status === "completed" ? "2026-04-08T00:00:02.000Z" : null,
    failedAt: null,
    updatedAt: "2026-04-08T00:00:02.000Z",
  };
}

function makeSnapshot(
  epicOverrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsCoordinatorEpicSnapshot {
  return {
    epicId: "EPIC-1",
    epicTitle: "Epic 1",
    issue: null,
    coordinationLoadState: "ready",
    coordinationLoadDetail: null,
    validationState: "valid",
    validationErrors: [],
    coordinationState: "not_started",
    progress: {
      totalIssueCount: 3,
      completedIssueCount: 1,
      readyIssueCount: 2,
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
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    },
    activeRunId: null,
    activeExecutionId: null,
    projectConflict: null,
    summary: null,
    validation: null,
    status: null,
    runs: [],
    executions: [],
    ...epicOverrides,
  } as BeadsCoordinatorEpicSnapshot;
}

function EpicLaunchPanelContent() {
  const launchers = useIssueWorkflowLaunchers({
    cwd: "/repo",
    projectId: PROJECT_ID,
    modelSelection: {
      provider: "codex",
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    onOpenThread: () => {},
  });

  return (
    <EpicLaunchPanel
      cwd="/repo"
      projectId={PROJECT_ID}
      issueId="EPIC-1"
      modelSelection={{
        provider: "codex",
        model: "gpt-5.4",
      }}
      runtimeMode="full-access"
      launchers={launchers}
      onOpenThread={() => {}}
      onOpenOutput={() => {}}
    />
  );
}

function renderEpicLaunchPanel(snapshot: BeadsCoordinatorEpicSnapshot) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    beadsQueryKeys.projectRunSummary({
      cwd: "/repo",
      projectId: PROJECT_ID,
    }),
    {
      projectId: PROJECT_ID,
      epics: [
        {
          epicIssueId: snapshot.epicId,
          epicTitle: snapshot.epicTitle,
          runs: snapshot.runs,
          executions: snapshot.executions,
        },
        ...(snapshot.projectConflict
          ? [
              {
                epicIssueId: snapshot.projectConflict.run.epicIssueId,
                epicTitle: "Conflicting epic",
                runs: [snapshot.projectConflict.run],
                executions: [],
              },
            ]
          : []),
      ],
    },
  );
  queryClient.setQueryData(
    beadsQueryKeys.epicIssueSummaries({
      cwd: "/repo",
      epicIssueId: "EPIC-1",
    }),
    {
      epicId: snapshot.epicId,
      epicTitle: snapshot.epicTitle,
      progress: snapshot.progress,
      issues: [],
    },
  );
  queryClient.setQueryData(
    beadsQueryKeys.epicCoordinationDetail({
      cwd: "/repo",
      projectId: PROJECT_ID,
      epicIssueId: "EPIC-1",
    }),
    {
      epicId: snapshot.epicId,
      coordinationLoadState: snapshot.coordinationLoadState,
      coordinationLoadDetail: snapshot.coordinationLoadDetail,
      validationState: snapshot.validationState,
      validationErrors: snapshot.validationErrors,
      coordinationState: snapshot.coordinationState,
      summary: snapshot.summary,
      validation: snapshot.validation,
      status: snapshot.status,
      primaryAction: snapshot.primaryAction,
    },
  );

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <EpicLaunchPanelContent />
    </QueryClientProvider>,
  );
}

describe("EpicLaunchPanel", () => {
  it("renders ready launch controls for a startable epic", () => {
    const markup = renderEpicLaunchPanel(makeSnapshot());

    expect(markup).toContain("Epic Launch");
    expect(markup).toContain("Quick refine");
    expect(markup).toContain("Planned refine");
    expect(markup).toContain("Start epic");
  });

  it("renders prep state for invalid epics", () => {
    const markup = renderEpicLaunchPanel(
      makeSnapshot({
        validationState: "invalid",
        validationErrors: ["Epic needs prep before it can run."],
        primaryAction: {
          kind: "open_coordination_prep_thread",
          label: "Open prep thread",
          busyLabel: "Opening...",
          disabled: false,
        },
        validation: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          valid: false,
          errors: ["Epic needs prep before it can run."],
          warnings: [],
          readyFronts: [],
          maxParallelism: null,
          estimatedWorkerSessions: null,
        },
      }),
    );

    expect(markup).toContain("Needs prep");
    expect(markup).toContain("Epic needs prep before it can run.");
    expect(markup).toContain("Open prep thread");
  });

  it("renders project-conflict output copy and preview rows", () => {
    const markup = renderEpicLaunchPanel(
      makeSnapshot({
        projectConflict: {
          run: makeRun("run-conflict", "running"),
          message: "Another epic already owns the shared workspace.",
        },
        primaryAction: {
          kind: "open_coordinator",
          label: "View active epic",
          busyLabel: "Opening...",
          disabled: false,
        },
        activeExecutionId: "exec-1" as never,
        validation: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          valid: true,
          errors: [],
          warnings: [],
          readyFronts: [
            [
              {
                id: "TASK-2",
                title: "Second task",
                status: "open",
                priority: 2,
                issueType: "task",
                assignee: null,
                owner: null,
                parent: null,
              },
            ],
          ],
          maxParallelism: 1,
          estimatedWorkerSessions: 1,
        },
        status: {
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          summary: null,
          completed: [],
          active: [
            {
              id: "TASK-1",
              title: "First task",
              status: "open",
              priority: 1,
              issueType: "task",
              assignee: null,
              owner: null,
              parent: null,
            },
          ],
          ready: [
            {
              id: "TASK-2",
              title: "Second task",
              status: "open",
              priority: 2,
              issueType: "task",
              assignee: null,
              owner: null,
              parent: null,
            },
          ],
          blocked: [],
          blockedBreakdown: { internal: [], external: [], unknown: [] },
        },
        executions: [
          makeExecution("exec-1", "TASK-1", "running"),
          makeExecution("exec-2", "TASK-2", "completed"),
        ],
        runs: [makeRun("run-1", "running")],
      }),
    );

    expect(markup).toContain("View active run");
    expect(markup).toContain("Another epic already owns the shared workspace.");
    expect(markup).toContain("Now");
    expect(markup).toContain("Next likely");
  });

  it("renders a secondary output button when run history exists", () => {
    const markup = renderEpicLaunchPanel(
      makeSnapshot({
        runs: [makeRun("run-1", "failed")],
      }),
    );

    expect(markup).toContain("Open output");
  });
});
