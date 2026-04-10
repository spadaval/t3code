import type {
  OrchestrationLatestTurnState,
  OrchestrationSessionStatus,
  OrchestrationSwarmTaskExecution,
  OrchestrationThread,
  TurnId,
} from "@t3tools/contracts";

import {
  describeIncompleteWorkerExecution,
  describeRequestedExecutionLaunchFailure,
  describeRequestedExecutionTimeout,
  isRequestedExecutionTimedOut,
} from "./FailurePolicy.ts";

interface WorkerObservationInput {
  readonly latestTurnState: OrchestrationLatestTurnState | null | undefined;
  readonly sessionActiveTurnId: TurnId | null | undefined;
}

export type RequestedExecutionDecision =
  | { readonly type: "noop" }
  | { readonly type: "cleanup_failed_launch"; readonly reason: string }
  | { readonly type: "complete" }
  | { readonly type: "fail"; readonly reason: string }
  | { readonly type: "promote_to_active" };

export type CurrentExecutionDecision =
  | { readonly type: "noop" }
  | { readonly type: "delegate_to_requested" }
  | { readonly type: "complete_execution" }
  | { readonly type: "fail_execution"; readonly reason: string };

export function workerThreadStillHasActiveTurn(input: WorkerObservationInput): boolean {
  return input.latestTurnState === "running" || input.sessionActiveTurnId != null;
}

export function workerThreadLaunchWasObserved(input: WorkerObservationInput): boolean {
  return input.latestTurnState != null || input.sessionActiveTurnId != null;
}

export function workerThreadTurnWasRequested(
  thread: Pick<OrchestrationThread, "messages">,
): boolean {
  return thread.messages.some((message) => message.role === "user");
}

function isLaunchFailureSessionStatus(
  status: OrchestrationSessionStatus | null | undefined,
): boolean {
  return (
    status === "ready" || status === "stopped" || status === "interrupted" || status === "error"
  );
}

function isPendingLaunchSessionStatus(
  status: OrchestrationSessionStatus | null | undefined,
): boolean {
  return status === undefined || status === null || status === "starting" || status === "idle";
}

function defaultWorkerError(
  thread: Pick<OrchestrationThread, "session">,
  workerThreadId: OrchestrationSwarmTaskExecution["workerThreadId"],
  latestTurnState: OrchestrationLatestTurnState | null | undefined,
): string {
  if (thread.session?.lastError) {
    return thread.session.lastError;
  }

  if (workerThreadId === null) {
    return "Worker thread completed with an error.";
  }

  return describeIncompleteWorkerExecution({
    workerThreadId,
    sessionStatus: thread.session?.status,
    latestTurnState,
  });
}

export function decideReconcileRequestedExecution(input: {
  readonly execution: OrchestrationSwarmTaskExecution;
  readonly thread: OrchestrationThread | null;
  readonly nowMs: number;
  readonly launchTimeoutMs: number;
}): RequestedExecutionDecision {
  if (input.execution.workerThreadId === null) {
    return {
      type: "cleanup_failed_launch",
      reason: describeRequestedExecutionLaunchFailure({
        executionId: input.execution.executionId,
        issueId: input.execution.issueId,
        workerThreadId: null,
        reason: "Requested swarm task execution lost its worker thread linkage.",
      }),
    };
  }

  if (input.thread === null) {
    return {
      type: "cleanup_failed_launch",
      reason: describeRequestedExecutionLaunchFailure({
        executionId: input.execution.executionId,
        issueId: input.execution.issueId,
        workerThreadId: input.execution.workerThreadId,
        reason: `Worker thread '${input.execution.workerThreadId}' was not found during reconciliation.`,
      }),
    };
  }

  const launchWasRequested = workerThreadTurnWasRequested(input.thread);
  const workerStillRunning = workerThreadStillHasActiveTurn({
    latestTurnState: input.thread.latestTurn?.state,
    sessionActiveTurnId: input.thread.session?.activeTurnId,
  });

  if (
    !launchWasRequested &&
    !workerThreadLaunchWasObserved({
      latestTurnState: input.thread.latestTurn?.state,
      sessionActiveTurnId: input.thread.session?.activeTurnId,
    })
  ) {
    return {
      type: "cleanup_failed_launch",
      reason: describeRequestedExecutionLaunchFailure({
        executionId: input.execution.executionId,
        issueId: input.execution.issueId,
        workerThreadId: input.execution.workerThreadId,
        reason: "Worker thread never received the swarm turn-start request before reconciliation.",
      }),
    };
  }

  if (input.thread.latestTurn?.state === "completed") {
    return { type: "complete" };
  }

  if (input.thread.latestTurn?.state === "error") {
    return {
      type: "fail",
      reason: input.thread.session?.lastError ?? "Worker thread completed with an error.",
    };
  }

  if (workerStillRunning) {
    return { type: "promote_to_active" };
  }

  if (input.thread.latestTurn?.state === "interrupted") {
    return {
      type: "fail",
      reason: defaultWorkerError(
        input.thread,
        input.execution.workerThreadId,
        input.thread.latestTurn?.state,
      ),
    };
  }

  if (
    input.thread.latestTurn === null &&
    isLaunchFailureSessionStatus(input.thread.session?.status)
  ) {
    return {
      type: "cleanup_failed_launch",
      reason: describeRequestedExecutionLaunchFailure({
        executionId: input.execution.executionId,
        issueId: input.execution.issueId,
        workerThreadId: input.execution.workerThreadId,
        reason:
          input.thread.session?.lastError ??
          "Worker thread never reported a started turn before reconciliation.",
      }),
    };
  }

  if (
    launchWasRequested &&
    input.thread.latestTurn === null &&
    isPendingLaunchSessionStatus(input.thread.session?.status) &&
    isRequestedExecutionTimedOut({
      requestedAt: input.execution.requestedAt,
      nowMs: input.nowMs,
      timeoutMs: input.launchTimeoutMs,
    })
  ) {
    return {
      type: "cleanup_failed_launch",
      reason: describeRequestedExecutionTimeout({
        executionId: input.execution.executionId,
        issueId: input.execution.issueId,
        workerThreadId: input.execution.workerThreadId,
        sessionStatus: input.thread.session?.status,
        latestTurnState: null,
        timeoutSeconds: Math.floor(input.launchTimeoutMs / 1_000),
      }),
    };
  }

  return { type: "noop" };
}

export function decideReconcileCurrentExecution(input: {
  readonly execution: OrchestrationSwarmTaskExecution;
  readonly thread: OrchestrationThread | null;
}): CurrentExecutionDecision {
  if (input.execution.status === "launching") {
    return { type: "delegate_to_requested" };
  }

  if (input.execution.workerThreadId === null) {
    return {
      type: "fail_execution",
      reason: "Active swarm task execution lost its worker thread linkage.",
    };
  }

  if (input.thread === null) {
    return {
      type: "fail_execution",
      reason: `Worker thread '${input.execution.workerThreadId}' was not found during reconciliation.`,
    };
  }

  if (input.thread.latestTurn?.state === "completed") {
    return { type: "complete_execution" };
  }

  if (input.thread.latestTurn?.state === "error") {
    return {
      type: "fail_execution",
      reason: input.thread.session?.lastError ?? "Worker thread completed with an error.",
    };
  }

  const workerStillRunning = workerThreadStillHasActiveTurn({
    latestTurnState: input.thread.latestTurn?.state,
    sessionActiveTurnId: input.thread.session?.activeTurnId,
  });

  if (
    input.thread.latestTurn?.state === "interrupted" ||
    (!workerStillRunning &&
      (input.thread.session?.status === "interrupted" ||
        input.thread.session?.status === "stopped" ||
        input.thread.session?.status === "error"))
  ) {
    return {
      type: "fail_execution",
      reason: defaultWorkerError(
        input.thread,
        input.execution.workerThreadId,
        input.thread.latestTurn?.state,
      ),
    };
  }

  return { type: "noop" };
}
