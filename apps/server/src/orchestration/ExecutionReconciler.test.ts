import { describe, expect, it } from "vitest";

import type { OrchestrationSwarmTaskExecution, OrchestrationThread } from "@t3tools/contracts";
import {
  decideReconcileCurrentExecution,
  decideReconcileRequestedExecution,
} from "./ExecutionReconciler.ts";

function execution(
  overrides: Partial<OrchestrationSwarmTaskExecution> = {},
): OrchestrationSwarmTaskExecution {
  return {
    executionId: "exec-1" as never,
    runId: "run-1" as never,
    issueId: "TASK-1",
    workerThreadId: "thread-1" as never,
    sequenceNumber: 1,
    status: "launching",
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: "2026-04-06T00:00:00.000Z",
    startedAt: null,
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    updatedAt: "2026-04-06T00:00:00.000Z",
    ...overrides,
  };
}

function thread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: "thread-1" as never,
    projectId: "project-1" as never,
    title: "TASK-1 worker",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    issueLink: null,
    latestTurn: null,
    createdAt: "2026-04-06T00:00:00.000Z",
    updatedAt: "2026-04-06T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    pendingCheckpointCaptures: [],
    session: null,
    ...overrides,
  };
}

function userMessage() {
  return {
    id: "msg-1" as never,
    role: "user" as const,
    text: "go",
    attachments: [],
    turnId: null,
    streaming: false,
    createdAt: "2026-04-06T00:00:01.000Z",
    updatedAt: "2026-04-06T00:00:01.000Z",
  };
}

describe("ExecutionReconciler", () => {
  it("promotes requested executions once worker activity is observed", () => {
    expect(
      decideReconcileRequestedExecution({
        execution: execution(),
        thread: thread({
          latestTurn: {
            turnId: "turn-1" as never,
            state: "running",
            requestedAt: "2026-04-06T00:00:01.000Z",
            startedAt: "2026-04-06T00:00:02.000Z",
            completedAt: null,
            assistantMessageId: null,
          },
          messages: [userMessage()],
          session: {
            threadId: "thread-1" as never,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: "turn-1" as never,
            lastError: null,
            updatedAt: "2026-04-06T00:00:02.000Z",
          },
        }),
        nowMs: Date.parse("2026-04-06T00:00:10.000Z"),
        launchTimeoutMs: 60_000,
      }),
    ).toEqual({ type: "promote_to_active" });
  });

  it("fails requested executions that time out without usable progress", () => {
    const decision = decideReconcileRequestedExecution({
      execution: execution({
        requestedAt: "2026-04-06T00:00:00.000Z",
      }),
      thread: thread({
        messages: [userMessage()],
        session: {
          threadId: "thread-1" as never,
          status: "idle",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-04-06T00:00:01.000Z",
        },
      }),
      nowMs: Date.parse("2026-04-06T00:01:01.000Z"),
      launchTimeoutMs: 60_000,
    });

    expect(decision.type).toBe("cleanup_failed_launch");
    if (decision.type !== "cleanup_failed_launch") {
      return;
    }
    expect(decision.reason).toContain("timed out while launching");
  });

  it("delegates launching current executions back to requested reconciliation", () => {
    expect(
      decideReconcileCurrentExecution({
        execution: execution(),
        thread: thread(),
      }),
    ).toEqual({ type: "delegate_to_requested" });
  });

  it("fails current executions when the worker is interrupted without a specific provider error", () => {
    const decision = decideReconcileCurrentExecution({
      execution: execution({
        status: "running",
      }),
      thread: thread({
        latestTurn: {
          turnId: "turn-1" as never,
          state: "interrupted",
          requestedAt: "2026-04-06T00:00:01.000Z",
          startedAt: "2026-04-06T00:00:02.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
        session: {
          threadId: "thread-1" as never,
          status: "interrupted",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-04-06T00:00:03.000Z",
        },
      }),
    });

    expect(decision.type).toBe("fail_execution");
    if (decision.type !== "fail_execution") {
      return;
    }
    expect(decision.reason).toContain("stopped before completing the swarm task execution");
  });
});
