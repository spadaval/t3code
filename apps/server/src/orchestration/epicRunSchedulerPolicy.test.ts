import { describe, expect, it } from "vitest";

import type {
  BeadsIssueRelationSummary,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
} from "@t3tools/contracts";
import {
  countLaunchableReadyIssues,
  describeReadyIssueExhaustion,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
  selectLaunchableReadyIssue,
  shouldIdleSemiAutomaticRun,
} from "./epicRunSchedulerPolicy.ts";

function issue(id: string, priority: number | null): BeadsIssueRelationSummary {
  return {
    id,
    title: id,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  };
}

function run(runId: string, overrides: Partial<OrchestrationEpicRun> = {}): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: "project-1" as never,
    epicIssueId: `EPIC-${runId}`,
    status: "pending",
    provider: "codex",
    model: "gpt-5-codex",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    failureContext: null,
    requestedAt: `2026-04-06T00:00:0${runId.at(-1) ?? "0"}.000Z`,
    startedAt: null,
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: `2026-04-06T00:00:0${runId.at(-1) ?? "0"}.000Z`,
    ...overrides,
  };
}

function execution(
  executionId: string,
  overrides: Partial<OrchestrationEpicIssueExecution> = {},
): OrchestrationEpicIssueExecution {
  return {
    executionId: executionId as never,
    runId: "run-1" as never,
    issueId: `TASK-${executionId}`,
    workerThreadId: null,
    sequenceNumber: Number(executionId.replace(/\D/g, "")) || 1,
    status: "launching",
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: `2026-04-06T00:00:0${executionId.replace(/\D/g, "") || "1"}.000Z`,
    startedAt: null,
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    updatedAt: `2026-04-06T00:00:0${executionId.replace(/\D/g, "") || "1"}.000Z`,
    ...overrides,
  };
}

describe("epicRunSchedulerPolicy", () => {
  it("ignores terminal shared-workspace runs when choosing the project winner", () => {
    const winner = run("run-2", {
      status: "running",
      updatedAt: "2026-04-06T00:00:10.000Z",
    });
    const loser = run("run-1", {
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "worker failed",
        issueId: null,
        executionId: null,
        workerThreadId: null,
      },
      updatedAt: "2026-04-06T00:00:05.000Z",
    });

    expect(evaluateSharedWorkspaceProjectInvariant([loser, winner])).toEqual({
      winner,
      losers: [],
    });
  });

  it("returns no project winner when every shared-workspace run is terminal", () => {
    expect(
      evaluateSharedWorkspaceProjectInvariant([
        run("run-1", { status: "completed" }),
        run("run-2", { status: "failed" }),
      ]),
    ).toEqual({
      winner: null,
      losers: [],
    });
  });

  it("reports all duplicate non-terminal executions in the invariant failure detail", () => {
    const invariant = evaluateRunExecutionInvariant({
      runId: "run-1" as never,
      executions: [
        execution("exec-1", {
          executionId: "exec-1" as never,
          issueId: "TASK-1",
          workerThreadId: "thread-1" as never,
        }),
        execution("exec-2", {
          executionId: "exec-2" as never,
          issueId: "TASK-2",
          workerThreadId: "thread-2" as never,
          sequenceNumber: 2,
        }),
      ],
    });

    expect(invariant.nonTerminalExecutions).toHaveLength(2);
    expect(invariant.violationReason).toContain(
      "exec-1 [status=launching, issue=TASK-1, worker=thread-1]",
    );
    expect(invariant.violationReason).toContain(
      "exec-2 [status=launching, issue=TASK-2, worker=thread-2]",
    );
  });

  it("skips attempted ready issues and counts only launchable work", () => {
    const readyIssues = [issue("TASK-2", 2), issue("TASK-1", 1), issue("TASK-9", null)];

    expect(
      selectLaunchableReadyIssue({
        readyIssues,
        attemptedIssueIds: new Set(["TASK-1"]),
      })?.id,
    ).toBe("TASK-2");

    expect(
      countLaunchableReadyIssues({
        readyIssues,
        attemptedIssueIds: new Set(["TASK-1", "TASK-9"]),
      }),
    ).toBe(1);
  });

  it("describes ready exhaustion with both live-ready and attempted-ready issue ids", () => {
    expect(
      describeReadyIssueExhaustion({
        runId: "run-1" as never,
        attemptedIssueIds: new Set(["TASK-1", "TASK-9"]),
        readyIssues: [issue("TASK-1", 1), issue("TASK-9", null)],
      }),
    ).toContain("Ready issues: TASK-1, TASK-9.");

    expect(
      describeReadyIssueExhaustion({
        runId: "run-1" as never,
        attemptedIssueIds: new Set(["TASK-1", "TASK-9"]),
        readyIssues: [issue("TASK-1", 1), issue("TASK-9", null)],
      }),
    ).toContain("Previously attempted ready issues: TASK-1, TASK-9.");
    expect(
      describeReadyIssueExhaustion({
        runId: "run-1" as never,
        attemptedIssueIds: new Set(["TASK-1", "TASK-9"]),
        readyIssues: [issue("TASK-1", 1), issue("TASK-9", null)],
      }),
    ).toContain("Stop the run, fix the tracker or code state, then start a new run when ready.");
  });

  it("idles semi-automatic runs only after non-manual settle/background triggers", () => {
    const latestExecution = execution("exec-1", {
      status: "completed",
      completedAt: "2026-04-06T00:01:00.000Z",
    });
    expect(
      shouldIdleSemiAutomaticRun({
        schedulerMode: "semi-automatic",
        latestExecution,
        trigger: "execution_settled",
      }),
    ).toBe(true);

    expect(
      shouldIdleSemiAutomaticRun({
        schedulerMode: "semi-automatic",
        latestExecution,
        trigger: "periodic_reconcile",
      }),
    ).toBe(true);

    expect(
      shouldIdleSemiAutomaticRun({
        schedulerMode: "semi-automatic",
        latestExecution,
        trigger: "manual_start",
      }),
    ).toBe(false);
  });
});
