import type {
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  EpicRunId,
} from "@t3tools/contracts";
import {
  compareEpicRunsByRequestedAt,
  deriveEpicRunExecutionState,
  isNonTerminalSharedWorkspaceRun,
} from "@t3tools/shared/epicRun";

import { describeExecutionInvariantViolation } from "./FailurePolicy.ts";

function sharedWorkspaceProjectStatusPriority(run: OrchestrationEpicRun): number {
  switch (run.status) {
    case "running":
      return 0;
    case "stopping":
      return 1;
    case "pending":
      return 2;
    default:
      return 3;
  }
}

function compareSharedWorkspaceProjectCandidates(
  left: OrchestrationEpicRun,
  right: OrchestrationEpicRun,
): number {
  const priorityDelta =
    sharedWorkspaceProjectStatusPriority(left) - sharedWorkspaceProjectStatusPriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return compareEpicRunsByRequestedAt(left, right);
}

export function evaluateSharedWorkspaceProjectInvariant(
  runs: ReadonlyArray<OrchestrationEpicRun>,
): {
  readonly winner: OrchestrationEpicRun | null;
  readonly losers: ReadonlyArray<OrchestrationEpicRun>;
} {
  const candidates = runs
    .filter((run) => isNonTerminalSharedWorkspaceRun(run))
    .toSorted(compareSharedWorkspaceProjectCandidates);

  return {
    winner: candidates[0] ?? null,
    losers: candidates.slice(1),
  };
}

export function evaluateRunExecutionInvariant(input: {
  readonly runId: EpicRunId;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): ReturnType<typeof deriveEpicRunExecutionState> & {
  readonly violationReason: string | null;
} {
  const state = deriveEpicRunExecutionState(input);
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
  readonly winner: OrchestrationEpicRun;
  readonly loser: OrchestrationEpicRun;
}): string {
  return [
    `Shared-workspace swarm scheduling invariant failed in project '${input.projectId}'.`,
    `Run '${input.winner.runId}' for epic '${input.winner.epicIssueId}' remains schedulable with status '${input.winner.status}'.`,
    `Run '${input.loser.runId}' for epic '${input.loser.epicIssueId}' was also non-terminal with status '${input.loser.status}' and must be failed.`,
  ].join(" ");
}
