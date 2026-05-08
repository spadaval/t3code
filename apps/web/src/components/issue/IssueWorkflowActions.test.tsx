import type { BeadsEpicWorkflowSnapshot, BeadsIssueSummary, ProjectId } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
      instanceId: "codex" as never,
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
        instanceId: "codex" as never,
        model: "gpt-5.4",
      }}
      runtimeMode="full-access"
      linkedThreadCount={0}
      linkedThreadLabel="Open thread"
      launchers={launchers}
      onOpenLinkedThread={() => {}}
      onOpenInTracker={() => {}}
      onOpenThread={() => {}}
      {...(props.showEpicLaunchActions !== undefined
        ? { showEpicLaunchActions: props.showEpicLaunchActions }
        : {})}
    />
  );
}

function renderIssueWorkflowActions(input: {
  issue: BeadsIssueSummary;
  epicWorkflowDetail?: BeadsEpicWorkflowSnapshot | undefined;
  showEpicLaunchActions?: boolean;
}) {
  const queryClient = new QueryClient();
  if (input.epicWorkflowDetail) {
    queryClient.setQueryData(
      ["epic-workflow", "detail", "/repo", PROJECT_ID, input.issue.id],
      input.epicWorkflowDetail,
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

  it("renders epic refine actions plus the snapshot-driven epic CTA", () => {
    const markup = renderIssueWorkflowActions({
      issue: makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      epicWorkflowDetail: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        issue: null,
        coordinationLoadState: "ready",
        coordinationLoadDetail: null,
        validationState: "valid",
        validationErrors: [],
        coordinationState: "not_started",
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
        execution: {
          state: "ready",
          summary: "Epic is ready to launch.",
          blockingReason: null,
          nextIssue: null,
        },
        commands: [
          {
            kind: "start_epic_run",
            label: "Start epic",
            busyLabel: "Starting...",
            disabled: false,
            disabledReason: null,
          },
        ],
        activeRunId: null,
        activeExecutionId: null,
        projectConflict: null,
        summary: null,
        validation: null,
        status: null,
        runs: [],
        executions: [],
      },
    });

    expect(markup).toContain("Quick refine");
    expect(markup).toContain("Planned refine");
    expect(markup).toContain("Start epic");
    expect(markup).not.toContain("Start work");
  });

  it("does not render the retired coordinator action for epic rows", () => {
    const markup = renderIssueWorkflowActions({
      issue: makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      epicWorkflowDetail: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        issue: null,
        coordinationLoadState: "ready",
        coordinationLoadDetail: null,
        validationState: "valid",
        validationErrors: [],
        coordinationState: "not_started",
        progress: {
          totalIssueCount: 1,
          completedIssueCount: 0,
          readyIssueCount: 0,
          activeIssueCount: 0,
          blockedIssueCount: 1,
          internalBlockedIssueCount: 1,
          externalBlockedIssueCount: 0,
          unknownBlockedIssueCount: 0,
          activeWorkerCount: 0,
          isComplete: false,
        },
        execution: {
          state: "blocked",
          summary: "No ready work.",
          blockingReason: "No ready work.",
          nextIssue: null,
        },
        commands: [],
        activeRunId: null,
        activeExecutionId: null,
        projectConflict: null,
        summary: null,
        validation: null,
        status: null,
        runs: [],
        executions: [],
      },
    });

    expect(markup).toContain("Quick refine");
    expect(markup).not.toContain("Checking epic");
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
