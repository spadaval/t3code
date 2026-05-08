// @ts-nocheck
import { describe, expect, it } from "vitest";

import type { OrchestrationEpicRun, OrchestrationEpicIssueExecution } from "@t3tools/contracts";
import {
  describeSharedWorkspaceProjectInvariantViolation,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
} from "./EpicRunAdmissionPolicy.ts";

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

describe("EpicRunAdmissionPolicy", () => {
  it("keeps the earliest admitted non-terminal run as the project winner", () => {
    const winner = run("run-1", {
      status: "running",
      requestedAt: "2026-04-06T00:00:01.000Z",
      updatedAt: "2026-04-06T00:00:10.000Z",
    });
    const loser = run("run-2", {
      status: "pending",
      requestedAt: "2026-04-06T00:00:02.000Z",
      updatedAt: "2026-04-06T00:00:11.000Z",
    });

    expect(evaluateSharedWorkspaceProjectInvariant([winner, loser])).toEqual({
      winner,
      losers: [loser],
    });
  });

  it("reports all duplicate non-terminal executions in the invariant failure detail", () => {
    const invariant = evaluateRunExecutionInvariant({
      runId: "run-1" as never,
      executions: [
        execution("exec-1", {
          issueId: "TASK-1",
          workerThreadId: "thread-1" as never,
        }),
        execution("exec-2", {
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

  it("describes the losing run in project admission conflicts", () => {
    expect(
      describeSharedWorkspaceProjectInvariantViolation({
        projectId: "project-1",
        winner: run("run-2", {
          epicIssueId: "EPIC-2",
          status: "running",
        }),
        loser: run("run-1", {
          epicIssueId: "EPIC-1",
          status: "pending",
        }),
      }),
    ).toContain("Run 'run-1' for epic 'EPIC-1' was also non-terminal");
  });
});
