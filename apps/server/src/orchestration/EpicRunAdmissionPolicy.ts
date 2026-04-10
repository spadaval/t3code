import type {
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  SwarmRunId,
} from "@t3tools/contracts";
import {
  compareSwarmRunsByAttentionPriority,
  deriveSwarmRunExecutionState,
  isNonTerminalSharedWorkspaceRun,
} from "@t3tools/shared/swarm";

import { describeExecutionInvariantViolation } from "./FailurePolicy.ts";

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

  return {
    ...state,
    violationReason: describeExecutionInvariantViolation({
      runId: input.runId,
      nonTerminalExecutions: state.nonTerminalExecutions,
    }),
  };
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
