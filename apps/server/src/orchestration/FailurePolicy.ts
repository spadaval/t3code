import type {
  OrchestrationEpicIssueExecution,
  OrchestrationEpicIssueExecutionStatus,
  ThreadId,
} from "@t3tools/contracts";

interface WorkerFailureDescriptionInput {
  readonly workerThreadId: ThreadId;
  readonly sessionStatus: string | null | undefined;
  readonly latestTurnState: string | null | undefined;
}

interface RequestedExecutionFailureInput {
  readonly executionId: OrchestrationEpicIssueExecution["executionId"];
  readonly issueId: string;
  readonly workerThreadId: ThreadId | null;
  readonly reason: string;
}

interface RequestedExecutionTimeoutInput {
  readonly executionId: OrchestrationEpicIssueExecution["executionId"];
  readonly issueId: string;
  readonly workerThreadId: ThreadId | null;
  readonly sessionStatus: string | null | undefined;
  readonly latestTurnState: string | null | undefined;
  readonly timeoutSeconds: number;
}

interface IncompleteCompletedExecutionInput {
  readonly issueId: string;
  readonly currentStatus: string;
  readonly workerThreadId: ThreadId | null;
}

export function truncateSwarmFailureDetail(value: string, max = 1_500): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

export function describeIncompleteWorkerExecution(input: WorkerFailureDescriptionInput): string {
  return [
    `Worker thread '${input.workerThreadId}' stopped before completing the swarm task execution.`,
    `Observed session status: ${input.sessionStatus ?? "unknown"}.`,
    `Observed latest turn state: ${input.latestTurnState ?? "missing"}.`,
    "The provider did not report a more specific error reason.",
  ].join(" ");
}

export function describeRequestedExecutionLaunchFailure(
  input: RequestedExecutionFailureInput,
): string {
  return [
    `Requested swarm task execution '${input.executionId}' for issue '${input.issueId}' did not finish launching.`,
    input.workerThreadId
      ? `Worker thread '${input.workerThreadId}' did not reach an active turn.`
      : "The worker thread was unavailable.",
    input.reason,
  ].join(" ");
}

export function isRequestedExecutionTimedOut(input: {
  readonly requestedAt: string;
  readonly nowMs: number;
  readonly timeoutMs: number;
}): boolean {
  const requestedAtMillis = Date.parse(input.requestedAt);
  if (Number.isNaN(requestedAtMillis)) {
    return true;
  }
  return input.nowMs - requestedAtMillis >= input.timeoutMs;
}

export function describeRequestedExecutionTimeout(input: RequestedExecutionTimeoutInput): string {
  return [
    `Requested swarm task execution '${input.executionId}' for issue '${input.issueId}' timed out while launching.`,
    input.workerThreadId
      ? `Worker thread '${input.workerThreadId}' never reached an active turn before timeout.`
      : "The worker thread was unavailable before launch progress was observed.",
    `Observed session status: ${input.sessionStatus ?? "missing"}.`,
    `Observed latest turn state: ${input.latestTurnState ?? "missing"}.`,
    `Launch made no usable session or turn progress within ${input.timeoutSeconds} seconds.`,
  ].join(" ");
}

export function isClosedIssueStatus(status: string): boolean {
  return status === "closed";
}

export function describeIssueNotClosedForCompletedExecution(
  input: IncompleteCompletedExecutionInput,
): string {
  const workerDescriptor =
    input.workerThreadId === null ? "Worker thread" : `Worker thread '${input.workerThreadId}'`;
  return [
    `${workerDescriptor} completed, but issue '${input.issueId}' is still '${input.currentStatus}'.`,
    "Swarm workers must close their assigned Beads issue before task completion is recorded.",
  ].join(" ");
}

export function describeExecutionInvariantViolation(input: {
  readonly runId: string;
  readonly nonTerminalExecutions: ReadonlyArray<{
    readonly executionId: string;
    readonly status: OrchestrationEpicIssueExecutionStatus;
    readonly issueId: string;
    readonly workerThreadId: ThreadId | null;
  }>;
}): string {
  const details = input.nonTerminalExecutions
    .map(
      (execution) =>
        `${execution.executionId} [status=${execution.status}, issue=${execution.issueId}, worker=${execution.workerThreadId ?? "none"}]`,
    )
    .join("; ");

  if (input.nonTerminalExecutions.length > 1) {
    return `Shared-workspace swarm run '${input.runId}' has multiple non-terminal task executions. Expected at most one active worker execution, found: ${details}.`;
  }

  const [execution] = input.nonTerminalExecutions;
  if (!execution) {
    return `Shared-workspace swarm run '${input.runId}' lost its non-terminal task execution state.`;
  }

  return `Shared-workspace swarm run '${input.runId}' has unexpected non-terminal task execution '${execution.executionId}' in its execution history.`;
}
