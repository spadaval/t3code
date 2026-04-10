import type {
  BeadsIssueRelationSummary,
  OrchestrationSwarmSchedulerMode,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  SwarmRunId,
  SwarmTaskExecutionId,
} from "@t3tools/contracts";
import {
  compareSwarmRunsByAttentionPriority,
  deriveSwarmRunExecutionState,
  isNonTerminalSharedWorkspaceRun,
  selectDeterministicReadyIssueFromList,
} from "@t3tools/shared/swarm";

export type SwarmSchedulerTrigger =
  | "startup_reconcile"
  | "periodic_reconcile"
  | "manual_start"
  | "manual_resume_paused"
  | "manual_run_next"
  | "manual_retry_execution"
  | "execution_settled"
  | "worker_state_changed";

export interface SwarmDriveRequest {
  readonly runId: SwarmRunId;
  readonly trigger: SwarmSchedulerTrigger;
  readonly retryExecutionId?: SwarmTaskExecutionId;
}

export function isBackgroundSwarmSchedulerTrigger(trigger: SwarmSchedulerTrigger): boolean {
  return trigger === "startup_reconcile" || trigger === "periodic_reconcile";
}

export function getAttemptedIssueIds(
  executions: ReadonlyArray<OrchestrationSwarmTaskExecution>,
): ReadonlySet<string> {
  return new Set(executions.map((execution) => execution.issueId));
}

export function evaluateSharedWorkspaceProjectInvariant(
  runs: ReadonlyArray<OrchestrationSwarmRun>,
): {
  readonly winner: OrchestrationSwarmRun | null;
  readonly losers: ReadonlyArray<OrchestrationSwarmRun>;
} {
  const candidates = runs
    .filter((run) => isNonTerminalSharedWorkspaceRun(run))
    .toSorted(compareSwarmRunsByAttentionPriority);

  return {
    winner: candidates[0] ?? null,
    losers: candidates.slice(1),
  };
}

export function evaluateRunExecutionInvariant(input: {
  readonly runId: SwarmRunId;
  readonly executions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): ReturnType<typeof deriveSwarmRunExecutionState> & {
  readonly violationReason: string | null;
} {
  const state = deriveSwarmRunExecutionState(input);
  if (state.nonTerminalExecutions.length <= 1) {
    return {
      ...state,
      violationReason: null,
    };
  }

  const detail = state.nonTerminalExecutions
    .map(
      (execution) =>
        `${execution.executionId} [status=${execution.status}, issue=${execution.issueId}, worker=${execution.workerThreadId ?? "none"}]`,
    )
    .join("; ");

  return {
    ...state,
    violationReason: `Shared-workspace swarm run '${input.runId}' has multiple non-terminal task executions. Expected at most one active worker execution, found: ${detail}.`,
  };
}

export function selectLaunchableReadyIssue(input: {
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly attemptedIssueIds: ReadonlySet<string>;
  readonly retryIssueId?: string;
}): BeadsIssueRelationSummary | null {
  if (input.retryIssueId) {
    return (
      selectDeterministicReadyIssueFromList(
        input.readyIssues.filter((issue) => issue.id === input.retryIssueId),
      ) ?? null
    );
  }

  return (
    selectDeterministicReadyIssueFromList(
      input.readyIssues.filter((issue) => !input.attemptedIssueIds.has(issue.id)),
    ) ?? null
  );
}

export function countLaunchableReadyIssues(input: {
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly attemptedIssueIds: ReadonlySet<string>;
  readonly retryIssueId?: string;
}): number {
  if (input.retryIssueId) {
    return input.readyIssues.filter((issue) => issue.id === input.retryIssueId).length;
  }

  return input.readyIssues.filter((issue) => !input.attemptedIssueIds.has(issue.id)).length;
}

export function describeSharedWorkspaceProjectInvariantViolation(input: {
  readonly projectId: string;
  readonly winner: OrchestrationSwarmRun;
  readonly loser: OrchestrationSwarmRun;
}): string {
  return [
    `Shared-workspace swarm scheduling invariant failed in project '${input.projectId}'.`,
    `Run '${input.winner.runId}' for epic '${input.winner.epicIssueId}' remains schedulable with status '${input.winner.status}'.`,
    `Run '${input.loser.runId}' for epic '${input.loser.epicIssueId}' was also non-terminal with status '${input.loser.status}' and must be failed.`,
  ].join(" ");
}

export function describeReadyIssueExhaustion(input: {
  readonly runId: SwarmRunId;
  readonly attemptedIssueIds: ReadonlySet<string>;
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
}): string {
  const attemptedReadyIssueIds = input.readyIssues
    .map((issue) => issue.id)
    .filter((issueId) => input.attemptedIssueIds.has(issueId))
    .toSorted();

  return [
    `Swarm run '${input.runId}' has no launchable ready issue because every live ready issue was already attempted in this run.`,
    `Ready issues: ${
      input.readyIssues
        .map((issue) => issue.id)
        .toSorted()
        .join(", ") || "none"
    }.`,
    `Previously attempted ready issues: ${attemptedReadyIssueIds.join(", ") || "none"}.`,
    "Use retrySwarmTaskExecution to rerun a previous issue explicitly.",
  ].join(" ");
}

export function describeRetryIssueNotLiveReady(input: {
  readonly runId: SwarmRunId;
  readonly retryIssueId: string;
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
}): string {
  return [
    `Swarm run '${input.runId}' cannot retry issue '${input.retryIssueId}' because it is not currently live-ready.`,
    `Ready issues: ${
      input.readyIssues
        .map((issue) => issue.id)
        .toSorted()
        .join(", ") || "none"
    }.`,
    "Wait for that issue to return to the ready set before retrying its execution.",
  ].join(" ");
}

export function shouldIdleSemiAutomaticRun(input: {
  readonly schedulerMode?: OrchestrationSwarmSchedulerMode | null;
  readonly latestExecution: OrchestrationSwarmTaskExecution | null;
  readonly trigger: SwarmSchedulerTrigger;
}): boolean {
  if (input.schedulerMode !== "semi-automatic") {
    return false;
  }

  if (input.latestExecution === null) {
    return false;
  }

  return (
    input.trigger !== "manual_run_next" &&
    input.trigger !== "manual_retry_execution" &&
    input.trigger !== "manual_start"
  );
}
