// @ts-nocheck
import { describe, expect, it } from "vitest";

import type {
  BeadsEpicTrackerStatus,
  BeadsIssueRelationSummary,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
} from "@t3tools/contracts";
import {
  countLaunchableReadyIssues,
  decideDriveRun,
  decideLaunchNextTask,
  describeReadyIssueExhaustion,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
  selectLaunchableReadyIssue,
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

function trackerStatus(overrides: Partial<BeadsEpicTrackerStatus> = {}): BeadsEpicTrackerStatus {
  return {
    epicId: "EPIC-1",
    epicTitle: "Epic 1",
    trackerSummary: {
      trackerId: "SWARM-1",
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      totalIssueCount: 2,
      completedIssueCount: 0,
      activeIssueCount: 0,
      readyIssueCount: 1,
      blockedIssueCount: 0,
      activeWorkerCount: 0,
    },
    completed: [],
    active: [],
    ready: [issue("TASK-1", 1)],
    blocked: [],
    blockedBreakdown: {
      internal: [],
      external: [],
      unknown: [],
    },
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

  it("fails the losing run during drive reconciliation when another project run already won admission", () => {
    const decision = decideDriveRun({
      run: run("run-2", { epicIssueId: "EPIC-2" }),
      trigger: "manual_start",
      projectInvariant: {
        winnerRunId: "run-1" as never,
        failureReason:
          "Shared-workspace epic-run scheduling invariant failed in project 'project-1'.",
      },
      executionInvariant: {
        currentExecution: null,
        violationReason: null,
      },
    });

    expect(decision).toEqual({
      type: "fail_run",
      reason: "Shared-workspace epic-run scheduling invariant failed in project 'project-1'.",
    });
  });

  it("reconciles the current execution before attempting a new launch", () => {
    expect(
      decideDriveRun({
        run: run("run-1", { status: "running" }),
        trigger: "periodic_reconcile",
        projectInvariant: {
          winnerRunId: "run-1" as never,
          failureReason: null,
        },
        executionInvariant: {
          currentExecution: execution("exec-1", { status: "running" }),
          violationReason: null,
        },
      }),
    ).toEqual({ type: "reconcile_current" });
  });

  it("keeps a run idle instead of completing when the tracker has no ready issue but is incomplete", () => {
    expect(
      decideLaunchNextTask({
        run: run("run-1", { status: "running" }),
        trigger: "periodic_reconcile",
        trackerStatus: trackerStatus({
          ready: [],
          trackerSummary: {
            trackerId: "SWARM-1",
            epicId: "EPIC-1",
            epicTitle: "Epic 1",
            totalIssueCount: 2,
            completedIssueCount: 1,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 1,
            activeWorkerCount: 0,
          },
          blocked: [issue("TASK-2", 2)],
          blockedBreakdown: {
            internal: [issue("TASK-2", 2)],
            external: [],
            unknown: [],
          },
        }),
        executions: [],
      }),
    ).toEqual({ type: "idle_run" });
  });

  it("blocks the run when tracker state shows external execution blockers", () => {
    expect(
      decideLaunchNextTask({
        run: run("run-1", { status: "running" }),
        trigger: "periodic_reconcile",
        trackerStatus: trackerStatus({
          ready: [],
          blocked: [issue("EXT-1", 1)],
          blockedBreakdown: {
            internal: [],
            external: [issue("EXT-1", 1)],
            unknown: [],
          },
        }),
        executions: [],
      }),
    ).toEqual({ type: "block_run" });
  });

  it("completes the run only when tracker summary proves the epic is done", () => {
    expect(
      decideLaunchNextTask({
        run: run("run-1", { status: "running" }),
        trigger: "execution_settled",
        trackerStatus: trackerStatus({
          ready: [],
          trackerSummary: {
            trackerId: "SWARM-1",
            epicId: "EPIC-1",
            epicTitle: "Epic 1",
            totalIssueCount: 2,
            completedIssueCount: 2,
            activeIssueCount: 0,
            readyIssueCount: 0,
            blockedIssueCount: 0,
            activeWorkerCount: 0,
          },
        }),
        executions: [execution("exec-1", { status: "completed" })],
      }),
    ).toEqual({ type: "complete_run" });
  });

  it("fails the run when every live ready issue was already attempted", () => {
    const decision = decideLaunchNextTask({
      run: run("run-1", { status: "running" }),
      trigger: "periodic_reconcile",
      trackerStatus: trackerStatus({
        ready: [issue("TASK-1", 1), issue("TASK-2", 2)],
      }),
      executions: [
        execution("exec-1", { issueId: "TASK-1", status: "failed" }),
        execution("exec-2", { issueId: "TASK-2", status: "failed", sequenceNumber: 2 }),
      ],
    });

    expect(decision.type).toBe("fail_run");
    if (decision.type !== "fail_run") {
      return;
    }

    expect(decision.reason).toContain("every live ready issue was already attempted");
    expect(decision.reason).toContain("Ready issues: TASK-1, TASK-2.");
  });

  it("returns the deterministic next ready issue to launch", () => {
    expect(
      decideLaunchNextTask({
        run: run("run-1", { status: "running" }),
        trigger: "manual_start",
        trackerStatus: trackerStatus({
          ready: [issue("TASK-2", 2), issue("TASK-1", 1)],
        }),
        executions: [execution("exec-9", { issueId: "TASK-9", status: "failed" })],
      }),
    ).toEqual({
      type: "launch_issue",
      issue: issue("TASK-1", 1),
    });
  });
});
