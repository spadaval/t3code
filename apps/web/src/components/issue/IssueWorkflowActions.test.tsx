import type {
  BeadsEpicCoordinatorSnapshot,
  BeadsIssueSummary,
  ProjectId,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { IssueWorkflowActions, useIssueWorkflowLaunchers } from "./IssueWorkflowActions";

const PROJECT_ID = "project-1" as ProjectId;

function makeIssue(input: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">) {
  const { id, title, ...rest } = input;
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
    dependencyRefs: [],
    ...rest,
  } satisfies BeadsIssueSummary;
}

function IssueWorkflowActionsContent(props: {
  issue: BeadsIssueSummary;
  showEpicLaunchActions?: boolean;
}) {
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
    <IssueWorkflowActions
      issue={props.issue}
      cwd="/repo"
      projectId={PROJECT_ID}
      modelSelection={{
        provider: "codex",
        model: "gpt-5.4",
      }}
      runtimeMode="full-access"
      linkedThreadCount={0}
      linkedThreadLabel="Open thread"
      launchers={launchers}
      onOpenLinkedThread={() => {}}
      onOpenInTracker={() => {}}
      onOpenThread={() => {}}
      onOpenCoordinator={() => {}}
      {...(props.showEpicLaunchActions !== undefined
        ? { showEpicLaunchActions: props.showEpicLaunchActions }
        : {})}
    />
  );
}

function renderIssueWorkflowActions(input: {
  issue: BeadsIssueSummary;
  epicSnapshot?: BeadsEpicCoordinatorSnapshot | undefined;
  showEpicLaunchActions?: boolean;
}) {
  const queryClient = new QueryClient();
  if (input.epicSnapshot) {
    queryClient.setQueryData(
      beadsQueryKeys.epicCoordinatorSnapshot({
        cwd: "/repo",
        projectId: PROJECT_ID,
        epicIssueId: input.issue.id,
      }),
      input.epicSnapshot,
    );
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IssueWorkflowActionsContent
        issue={input.issue}
        {...(input.showEpicLaunchActions !== undefined
          ? { showEpicLaunchActions: input.showEpicLaunchActions }
          : {})}
      />
    </QueryClientProvider>,
  );
}

describe("IssueWorkflowActions", () => {
  it("renders the standard start-work launcher for non-epic issues", () => {
    const markup = renderIssueWorkflowActions({
      issue: makeIssue({
        id: "TASK-1",
        title: "Task 1",
        issueType: "task",
      }),
    });

    expect(markup).toContain("Start work");
    expect(markup).not.toContain("Quick refine");
    expect(markup).not.toContain("Planned refine");
  });

  it("renders epic refine actions plus the snapshot-driven coordinator CTA", () => {
    const markup = renderIssueWorkflowActions({
      issue: makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      epicSnapshot: {
        projectId: PROJECT_ID,
        support: {
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
        },
        epic: {
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
            label: "Start epic",
            busyLabel: "Starting...",
            disabled: false,
          },
          activeRunId: null,
          activeExecutionId: null,
          projectConflict: null,
          trackerSummary: null,
          validation: null,
          status: null,
          runs: [],
          executions: [],
        },
      },
    });

    expect(markup).toContain("Quick refine");
    expect(markup).toContain("Planned refine");
    expect(markup).toContain("Start epic");
    expect(markup).not.toContain("Start work");
  });

  it("can hide epic launch actions when the issue detail owns that surface", () => {
    const markup = renderIssueWorkflowActions({
      issue: makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      showEpicLaunchActions: false,
    });

    expect(markup).not.toContain("Quick refine");
    expect(markup).not.toContain("Planned refine");
    expect(markup).not.toContain("Start epic");
    expect(markup).toContain("Open in tracker");
  });
});
