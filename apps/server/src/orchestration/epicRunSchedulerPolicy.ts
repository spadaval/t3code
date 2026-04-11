import type {
  BeadsIssueRelationSummary,
  OrchestrationEpicIssueExecution,
  EpicRunId,
} from "@t3tools/contracts";
import { selectDeterministicReadyIssueFromList } from "@t3tools/shared/epicRun";

export {
  describeSharedWorkspaceProjectInvariantViolation,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
} from "./EpicRunAdmissionPolicy.ts";

export type EpicRunSchedulerTrigger =
  | "startup_reconcile"
  | "periodic_reconcile"
  | "manual_start"
  | "execution_settled"
  | "worker_state_changed";

export interface EpicRunDriveRequest {
  readonly runId: EpicRunId;
  readonly trigger: EpicRunSchedulerTrigger;
}

export function isBackgroundEpicRunSchedulerTrigger(trigger: EpicRunSchedulerTrigger): boolean {
  return trigger === "startup_reconcile" || trigger === "periodic_reconcile";
}

export function getAttemptedIssueIds(
  executions: ReadonlyArray<OrchestrationEpicIssueExecution>,
): ReadonlySet<string> {
  return new Set(executions.map((execution) => execution.issueId));
}

export function selectLaunchableReadyIssue(input: {
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly attemptedIssueIds: ReadonlySet<string>;
}): BeadsIssueRelationSummary | null {
  return (
    selectDeterministicReadyIssueFromList(
      input.readyIssues.filter((issue) => !input.attemptedIssueIds.has(issue.id)),
    ) ?? null
  );
}

export function countLaunchableReadyIssues(input: {
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly attemptedIssueIds: ReadonlySet<string>;
}): number {
  return input.readyIssues.filter((issue) => !input.attemptedIssueIds.has(issue.id)).length;
}

export function describeReadyIssueExhaustion(input: {
  readonly runId: EpicRunId;
  readonly attemptedIssueIds: ReadonlySet<string>;
  readonly readyIssues: ReadonlyArray<BeadsIssueRelationSummary>;
}): string {
  const attemptedReadyIssueIds = input.readyIssues
    .map((issue) => issue.id)
    .filter((issueId) => input.attemptedIssueIds.has(issueId))
    .toSorted();

  return [
    `Epic run '${input.runId}' has no launchable ready issue because every live ready issue was already attempted in this run.`,
    `Ready issues: ${
      input.readyIssues
        .map((issue) => issue.id)
        .toSorted()
        .join(", ") || "none"
    }.`,
    `Previously attempted ready issues: ${attemptedReadyIssueIds.join(", ") || "none"}.`,
    "Stop the run, fix the tracker or code state, then start a new run when ready.",
  ].join(" ");
}
