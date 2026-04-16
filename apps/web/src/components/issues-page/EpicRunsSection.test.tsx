import type { OrchestrationEpicIssueExecution, OrchestrationEpicRun } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EpicRunsSection } from "./EpicRunsSection";

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
            kind: "worker_failure",
            issueId: "TASK-2",
            executionId: null,
            workerThreadId: null,
            message: "Worker crashed while replaying diffs.",
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: status === "failed" ? "2026-04-08T00:00:04.000Z" : null,
    completedAt: status === "completed" ? "2026-04-08T00:00:04.000Z" : null,
    updatedAt: "2026-04-08T00:00:04.000Z",
    ...overrides,
  };
}

function makeExecution(
  executionId: string,
  runId: string,
  issueId: string,
  status: OrchestrationEpicIssueExecution["status"],
  overrides: Partial<OrchestrationEpicIssueExecution> = {},
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: runId as never,
    issueId,
    workerThreadId: "thread-1" as never,
    sequenceNumber: 1,
    status,
    workspaceKey: "shared",
    workspacePath: null,
    failureContext:
      status === "failed"
        ? {
            kind: "worker_failure",
            issueId,
            executionId: executionId as never,
            workerThreadId: "thread-1" as never,
            message: "Worker crashed while replaying diffs.",
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: status === "completed" ? "2026-04-08T00:00:03.000Z" : null,
    failedAt: status === "failed" ? "2026-04-08T00:00:03.000Z" : null,
    updatedAt: "2026-04-08T00:00:03.000Z",
    ...overrides,
  };
}

describe("EpicRunsSection", () => {
  it("renders active and failed runs inline with execution summaries", () => {
    const markup = renderToStaticMarkup(
      <EpicRunsSection
        runs={[makeRun("run-active", "running"), makeRun("run-failed", "failed")]}
        executions={[
          makeExecution("exec-1", "run-active", "TASK-1", "running"),
          makeExecution("exec-2", "run-failed", "TASK-2", "failed"),
        ]}
        issueTitlesById={{
          "TASK-1": "Add route redirect coverage",
          "TASK-2": "Replace coordinator tab tests",
        }}
      />,
    );

    expect(markup).toContain("Runs");
    expect(markup).toContain("run-active · Running");
    expect(markup).toContain("run-failed · Failed");
    expect(markup).toContain("Add route redirect coverage");
    expect(markup).toContain("Worker crashed while replaying diffs.");
  });

  it("collapses old completed runs behind the history overflow label", () => {
    const markup = renderToStaticMarkup(
      <EpicRunsSection
        runs={[
          makeRun("run-4", "completed"),
          makeRun("run-3", "completed"),
          makeRun("run-2", "completed"),
          makeRun("run-1", "completed"),
        ]}
        executions={[]}
        historyLimit={2}
      />,
    );

    expect(markup).toContain("History");
    expect(markup).toContain("run-4 · Completed");
    expect(markup).toContain("run-3 · Completed");
    expect(markup).not.toContain("run-2 · Completed");
    expect(markup).toContain("Show 2 older runs");
  });

  it("renders an empty state when an epic has no runs yet", () => {
    const markup = renderToStaticMarkup(<EpicRunsSection runs={[]} executions={[]} />);

    expect(markup).toContain("No runs yet.");
  });
});
