import { describe, expect, it } from "vitest";

import type {
  BeadsIssueRelationSummary,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";
import {
  countLaunchableReadyIssues,
  describeReadyIssueExhaustion,
  describeRetryIssueNotLiveReady,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
  selectLaunchableReadyIssue,
  shouldIdleSemiAutomaticRun,
} from "./swarmSchedulerPolicy.ts";

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

function run(runId: string, overrides: Partial<OrchestrationSwarmRun> = {}): OrchestrationSwarmRun {
  return {
    runId: runId as never,
    projectId: "project-1" as never,
    epicIssueId: `EPIC-${runId}`,
    status: "requested",
    schedulerMode: "automatic",
    workspaceMode: "shared",
    provider: "codex",
    model: "gpt-5-codex",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    lastError: null,
    requestedAt: `2026-04-06T00:00:0${runId.at(-1) ?? "0"}.000Z`,
    startedAt: null,
    idledAt: null,
    pausedAt: null,
    blockedAt: null,
    blockedContext: null,
    failedAt: null,
    cancelledAt: null,
    completedAt: null,
    updatedAt: `2026-04-06T00:00:0${runId.at(-1) ?? "0"}.000Z`,
    ...overrides,
  };
}

function execution(
  executionId: string,
  overrides: Partial<OrchestrationSwarmTaskExecution> = {},
): OrchestrationSwarmTaskExecution {
  return {
    executionId: executionId as never,
    runId: "run-1" as never,
    issueId: `TASK-${executionId}`,
    workerThreadId: null,
    sequenceNumber: Number(executionId.replace(/\D/g, "")) || 1,
    status: "requested",
    originalStatus: "open",
    originalAssignee: null,
    lastError: null,
    requestedAt: `2026-04-06T00:00:0${executionId.replace(/\D/g, "") || "1"}.000Z`,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    updatedAt: `2026-04-06T00:00:0${executionId.replace(/\D/g, "") || "1"}.000Z`,
    ...overrides,
  };
}

describe("swarmSchedulerPolicy", () => {
  it("chooses the highest-attention non-terminal shared-workspace run as the project winner", () => {
    const winner = run("run-2", {
      status: "running",
      updatedAt: "2026-04-06T00:00:10.000Z",
    });
    const loser = run("run-1", {
      status: "blocked",
      updatedAt: "2026-04-06T00:00:05.000Z",
    });

    expect(evaluateSharedWorkspaceProjectInvariant([loser, winner])).toEqual({
      winner,
      losers: [loser],
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
      "exec-1 [status=requested, issue=TASK-1, worker=thread-1]",
    );
    expect(invariant.violationReason).toContain(
      "exec-2 [status=requested, issue=TASK-2, worker=thread-2]",
    );
  });

  it("prefers retry issue selection over general ready ordering", () => {
    const readyIssues = [issue("TASK-2", 2), issue("TASK-1", 1)];

    expect(
      selectLaunchableReadyIssue({
        readyIssues,
        attemptedIssueIds: new Set(["TASK-1"]),
        retryIssueId: "TASK-1",
      }),
    ).toEqual(issue("TASK-1", 1));
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
  });

  it("describes retry selection failure when the requested issue is no longer ready", () => {
    expect(
      describeRetryIssueNotLiveReady({
        runId: "run-1" as never,
        retryIssueId: "TASK-1",
        readyIssues: [issue("TASK-2", 2), issue("TASK-9", null)],
      }),
    ).toContain("cannot retry issue 'TASK-1' because it is not currently live-ready");

    expect(
      describeRetryIssueNotLiveReady({
        runId: "run-1" as never,
        retryIssueId: "TASK-1",
        readyIssues: [issue("TASK-2", 2), issue("TASK-9", null)],
      }),
    ).toContain("Ready issues: TASK-2, TASK-9.");
  });

  it("idles semi-automatic runs only after non-manual settle/background triggers", () => {
    const latestExecution = execution("exec-1", {
      status: "completed",
      completedAt: "2026-04-06T00:01:00.000Z",
    });
    const semiAutomaticRun = run("run-1", { schedulerMode: "semi-automatic" });

    expect(
      shouldIdleSemiAutomaticRun({
        run: semiAutomaticRun,
        latestExecution,
        trigger: "execution_settled",
      }),
    ).toBe(true);

    expect(
      shouldIdleSemiAutomaticRun({
        run: semiAutomaticRun,
        latestExecution,
        trigger: "periodic_reconcile",
      }),
    ).toBe(true);

    expect(
      shouldIdleSemiAutomaticRun({
        run: semiAutomaticRun,
        latestExecution,
        trigger: "manual_run_next",
      }),
    ).toBe(false);

    expect(
      shouldIdleSemiAutomaticRun({
        run: semiAutomaticRun,
        latestExecution,
        trigger: "manual_start",
      }),
    ).toBe(false);
  });
});
