import type {
  BeadsIssueRelationSummary,
  OrchestrationSwarmSchedulerMode,
  OrchestrationSwarmTaskExecution,
  SwarmRunId,
  SwarmTaskExecutionId,
} from "@t3tools/contracts";
import { selectDeterministicReadyIssueFromList } from "@t3tools/shared/swarm";

export {
  describeSharedWorkspaceProjectInvariantViolation,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
} from "./EpicRunAdmissionPolicy.ts";

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
