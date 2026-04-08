import type {
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmValidation,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";

export function compareSwarmReadyIssues(
  left: BeadsIssueRelationSummary,
  right: BeadsIssueRelationSummary,
): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.id.localeCompare(right.id);
}

export function selectDeterministicReadyIssueFromList(
  issues: ReadonlyArray<BeadsIssueRelationSummary>,
): BeadsIssueRelationSummary | null {
  return issues.toSorted(compareSwarmReadyIssues).at(0) ?? null;
}

export function selectDeterministicReadyIssue(input: {
  readonly validation: Pick<BeadsSwarmValidation, "readyFronts"> | null;
  readonly status: Pick<BeadsSwarmStatus, "ready"> | null;
}): BeadsIssueRelationSummary | null {
  for (const front of input.validation?.readyFronts ?? []) {
    const issue = selectDeterministicReadyIssueFromList(front);
    if (issue) {
      return issue;
    }
  }

  return selectDeterministicReadyIssueFromList(input.status?.ready ?? []);
}

export function compareSwarmTaskExecutions(
  left: OrchestrationSwarmTaskExecution,
  right: OrchestrationSwarmTaskExecution,
): number {
  return (
    left.runId.localeCompare(right.runId) ||
    left.sequenceNumber - right.sequenceNumber ||
    left.executionId.localeCompare(right.executionId)
  );
}

export function isNonTerminalSwarmTaskExecutionStatus(
  status: OrchestrationSwarmTaskExecution["status"],
): status is "requested" | "active" {
  return status === "requested" || status === "active";
}

export function deriveSwarmRunExecutionState(input: {
  readonly runId: OrchestrationSwarmRun["runId"];
  readonly executions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): {
  readonly activeExecution: OrchestrationSwarmTaskExecution | null;
  readonly latestExecution: OrchestrationSwarmTaskExecution | null;
  readonly nonTerminalExecutions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
} {
  let latestExecution: OrchestrationSwarmTaskExecution | null = null;
  const nonTerminalExecutions: OrchestrationSwarmTaskExecution[] = [];

  for (const execution of input.executions) {
    if (execution.runId !== input.runId) {
      continue;
    }

    if (latestExecution === null || compareSwarmTaskExecutions(latestExecution, execution) < 0) {
      latestExecution = execution;
    }

    if (isNonTerminalSwarmTaskExecutionStatus(execution.status)) {
      nonTerminalExecutions.push(execution);
    }
  }

  const orderedNonTerminalExecutions = nonTerminalExecutions.toSorted(compareSwarmTaskExecutions);

  return {
    activeExecution: orderedNonTerminalExecutions.at(-1) ?? null,
    latestExecution,
    nonTerminalExecutions: orderedNonTerminalExecutions,
  };
}
