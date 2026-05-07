import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueDetail,
  BeadsIssueRelationSummary,
  ThreadId,
} from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { WorkGraph } from "./WorkGraph";

function makeRelation(
  input: Partial<BeadsIssueRelationSummary> & Pick<BeadsIssueRelationSummary, "id" | "title">,
): BeadsIssueRelationSummary {
  const { id, title, ...rest } = input;
  return {
    id,
    title,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
    ...rest,
  } satisfies BeadsIssueRelationSummary;
}

function makeIssueDetail(
  input: Partial<BeadsIssueDetail> & Pick<BeadsIssueDetail, "id" | "title">,
): BeadsIssueDetail {
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
    dependencies: [],
    comments: [],
    ...rest,
  } satisfies BeadsIssueDetail;
}

function renderWithQueryClient(element: ReactNode, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient();
  return renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe("issue title views", () => {
  it("uses tracker status for work graph title strikethrough and does not infer it from completed buckets", () => {
    const activeIssue = makeRelation({
      id: "TASK-ACTIVE",
      title: "Active issue",
      status: "open",
      parent: { id: "EPIC-0", title: "Parent ref" },
    });
    const completedButOpenIssue = makeRelation({
      id: "TASK-COMPLETED",
      title: "Completed bucket issue",
      status: "open",
    });
    const detail = makeIssueDetail({
      id: "TASK-ACTIVE",
      title: "Active issue",
      status: "open",
      dependencies: [
        {
          id: "DEP-CLOSED",
          title: "Closed dependency",
          description: null,
          status: "closed",
          priority: null,
          issueType: "task",
          owner: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: null,
          updatedAt: "2026-01-02T00:00:00.000Z",
          dependencyType: "depends_on",
        },
      ],
    });

    const queryClient = new QueryClient();
    queryClient.setQueryData(
      beadsQueryKeys.issuesBatch("/repo", ["TASK-ACTIVE", "TASK-COMPLETED"]),
      {
        issues: [detail],
      },
    );

    const epic: BeadsCoordinatorEpicSnapshot = {
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      issue: null,
      coordinationLoadState: "ready",
      coordinationLoadDetail: null,
      validationState: "valid",
      validationErrors: [],
      coordinationState: "in_progress",
      progress: {
        totalIssueCount: 2,
        completedIssueCount: 1,
        readyIssueCount: 0,
        activeIssueCount: 1,
        blockedIssueCount: 0,
        internalBlockedIssueCount: 0,
        externalBlockedIssueCount: 0,
        unknownBlockedIssueCount: 0,
        activeWorkerCount: 1,
        isComplete: false,
      },
      execution: {
        state: "running",
        summary: "Epic run is active.",
        blockingReason: null,
        nextIssue: null,
      },
      commands: [],
      activeRunId: "run-1" as never,
      activeExecutionId: "exec-1" as never,
      projectConflict: null,
      summary: null,
      validation: null,
      status: {
        epicId: "EPIC-1",
        epicTitle: "Epic 1",
        summary: null,
        completed: [completedButOpenIssue],
        active: [activeIssue],
        ready: [],
        blocked: [],
        blockedBreakdown: { internal: [], external: [], unknown: [] },
      },
      runs: [
        {
          runId: "run-1" as never,
          projectId: "project-1" as never,
          epicIssueId: "EPIC-1",
          status: "running",
          provider: "codex" as never,
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
          updatedAt: "2026-04-08T00:00:01.000Z",
        },
      ],
      executions: [
        {
          executionId: "exec-1" as never,
          runId: "run-1" as never,
          issueId: "TASK-ACTIVE",
          workerThreadId: "thread-1" as ThreadId,
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
          updatedAt: "2026-04-08T00:00:01.000Z",
        },
      ],
    };

    const markup = renderWithQueryClient(
      <WorkGraph
        cwd="/repo"
        epic={epic}
        onOpenThread={() => {}}
        initialExpandedIssueIds={["TASK-ACTIVE"]}
      />,
      queryClient,
    );

    expect(markup).toMatch(/<span class="[^"]*line-through[^"]*">Closed dependency<\/span>/);
    expect(markup).not.toMatch(
      /<span class="[^"]*line-through[^"]*">Completed bucket issue<\/span>/,
    );
    expect(markup).not.toMatch(/<span class="[^"]*line-through[^"]*">Parent ref<\/span>/);
  });

  it("does not infer work graph row strikethrough from the completed bucket alone", () => {
    const queryClient = new QueryClient();
    const markup = renderWithQueryClient(
      <WorkGraph
        cwd="/repo"
        epic={{
          epicId: "EPIC-1",
          epicTitle: "Epic 1",
          issue: null,
          coordinationLoadState: "ready",
          coordinationLoadDetail: null,
          validationState: "valid",
          validationErrors: [],
          coordinationState: "completed",
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
          execution: {
            state: "completed",
            summary: "Epic is complete.",
            blockingReason: null,
            nextIssue: null,
          },
          commands: [],
          activeRunId: null,
          activeExecutionId: null,
          projectConflict: null,
          summary: null,
          validation: null,
          status: {
            epicId: "EPIC-1",
            epicTitle: "Epic 1",
            summary: null,
            completed: [
              makeRelation({
                id: "TASK-COMPLETED",
                title: "Completed bucket issue",
                status: "open",
              }),
            ],
            active: [],
            ready: [],
            blocked: [],
            blockedBreakdown: { internal: [], external: [], unknown: [] },
          },
          runs: [],
          executions: [],
        }}
        onOpenThread={() => {}}
      />,
      queryClient,
    );

    expect(markup).not.toMatch(
      /<span class="[^"]*line-through[^"]*">Completed bucket issue<\/span>/,
    );
  });
});
