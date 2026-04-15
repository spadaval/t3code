import type { OrchestrationEpicIssueExecution, OrchestrationEpicRun } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunView } from "./RunView";

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
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: "2026-04-08T00:00:03.000Z",
    ...overrides,
  };
}

function makeExecution(
  executionId: string,
  issueId: string,
  status: OrchestrationEpicIssueExecution["status"],
  overrides: Partial<OrchestrationEpicIssueExecution> = {},
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: "run-1" as never,
    issueId,
    workerThreadId: "thread-1" as never,
    sequenceNumber: 1,
    status,
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
    ...overrides,
  };
}

describe("RunView", () => {
  it("renders a missing-run empty state", () => {
    const markup = renderToStaticMarkup(<RunView run={null} executions={[]} />);

    expect(markup).toContain("Run not found.");
  });

  it("renders direct-load execution state for historical runs", () => {
    const markup = renderToStaticMarkup(
      <RunView
        run={makeRun("run-1", "completed", {
          completedAt: "2026-04-08T00:00:05.000Z",
        })}
        executions={[
          makeExecution("exec-1", "TASK-1", "completed", {
            completedAt: "2026-04-08T00:00:05.000Z",
          }),
        ]}
        issueTitlesById={{ "TASK-1": "Stabilize router redirects" }}
      />,
    );

    expect(markup).toContain("Run run-1");
    expect(markup).toContain("Completed");
    expect(markup).toContain("Stabilize router redirects");
    expect(markup).toContain("Latest update: Completed in 4.0s");
  });

  it("renders the active execution feed and thread handoff link", () => {
    const markup = renderToStaticMarkup(
      <RunView
        run={makeRun("run-1", "running")}
        executions={[
          makeExecution("exec-1", "TASK-1", "running"),
          makeExecution("exec-2", "TASK-2", "launching", {
            sequenceNumber: 2,
            workerThreadId: null,
          }),
        ]}
        issueTitlesById={{
          "TASK-1": "Add redirect coverage",
          "TASK-2": "Render sidebar ghost rows",
        }}
        activeThreadId={"thread-1" as never}
        activeMessages={[
          { id: "msg-1", text: "Planning the redirect normalization." },
          { id: "msg-2", text: "Applying route coverage updates." },
        ]}
      />,
    );

    expect(markup).toContain("Add redirect coverage");
    expect(markup).toContain("Open in thread view: thread-1");
    expect(markup).toContain("Planning the redirect normalization.");
    expect(markup).toContain("Applying route coverage updates.");
  });
});
