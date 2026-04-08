import type {
  BeadsIssueRelationSummary,
  OrchestrationSwarmTaskExecution,
  SwarmRunId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  compareSwarmReadyIssues,
  deriveSwarmRunExecutionState,
  selectDeterministicReadyIssue,
  selectDeterministicReadyIssueFromList,
} from "./swarm";

function makeIssue(id: string, priority: number | null = null): BeadsIssueRelationSummary {
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

function makeExecution(
  executionId: string,
  runId: SwarmRunId,
  sequenceNumber: number,
  status: OrchestrationSwarmTaskExecution["status"],
): OrchestrationSwarmTaskExecution {
  return {
    executionId: executionId as never,
    runId,
    issueId: `TASK-${sequenceNumber}`,
    workerThreadId: null,
    sequenceNumber,
    status,
    originalStatus: "open",
    originalAssignee: null,
    lastError: null,
    requestedAt: `2026-04-06T00:00:0${sequenceNumber}.000Z`,
    startedAt: status === "requested" ? null : `2026-04-06T00:00:0${sequenceNumber}.000Z`,
    completedAt: status === "completed" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    failedAt: status === "failed" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    cancelledAt: status === "cancelled" ? `2026-04-06T00:00:1${sequenceNumber}.000Z` : null,
    updatedAt: `2026-04-06T00:00:2${sequenceNumber}.000Z`,
  };
}

describe("swarm", () => {
  it("orders ready issues by priority then id", () => {
    expect(
      [
        makeIssue("TASK-3", 2),
        makeIssue("TASK-1", 1),
        makeIssue("TASK-2", 1),
        makeIssue("TASK-4", null),
      ]
        .toSorted(compareSwarmReadyIssues)
        .map((issue) => issue.id),
    ).toEqual(["TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
  });

  it("selects the first non-empty validation front", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: {
          readyFronts: [[], [makeIssue("TASK-2", 2), makeIssue("TASK-1", 1)]],
        },
        status: { ready: [makeIssue("TASK-9", 0)] },
      })?.id,
    ).toBe("TASK-1");
  });

  it("falls back to swarm status ready issues", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: { readyFronts: [] },
        status: { ready: [makeIssue("TASK-2", 2), makeIssue("TASK-1", 1)] },
      })?.id,
    ).toBe("TASK-1");
  });

  it("selects deterministically from a plain issue list", () => {
    expect(
      selectDeterministicReadyIssueFromList([makeIssue("TASK-2", 2), makeIssue("TASK-1", 2)])?.id,
    ).toBe("TASK-1");
  });

  it("derives active and latest swarm task executions from execution history", () => {
    const runId = "run-1" as SwarmRunId;

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "active"),
          makeExecution("execution-1", runId, 1, "completed"),
          makeExecution("execution-3", "run-2" as SwarmRunId, 1, "active"),
        ],
      }),
    ).toMatchObject({
      activeExecution: { executionId: "execution-2" },
      currentExecution: { executionId: "execution-2" },
      latestExecution: { executionId: "execution-2" },
      nonTerminalExecutions: [{ executionId: "execution-2" }],
    });
  });

  it("keeps all non-terminal executions for invariant checks", () => {
    const runId = "run-1" as SwarmRunId;

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "requested"),
          makeExecution("execution-1", runId, 1, "active"),
        ],
      }),
    ).toMatchObject({
      activeExecution: { executionId: "execution-1" },
      currentExecution: { executionId: "execution-2" },
    });

    expect(
      deriveSwarmRunExecutionState({
        runId,
        executions: [
          makeExecution("execution-2", runId, 2, "requested"),
          makeExecution("execution-1", runId, 1, "active"),
        ],
      }).nonTerminalExecutions.map((execution) => execution.executionId),
    ).toEqual(["execution-1", "execution-2"]);
  });
});
