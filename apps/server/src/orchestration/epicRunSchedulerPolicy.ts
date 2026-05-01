import type {
  BeadsEpicCoordinationStatus,
  BeadsIssueRelationSummary,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  EpicRunId,
} from "@t3tools/contracts";
import {
  deriveExecutionBlocking,
  selectDeterministicReadyIssueFromList,
} from "@t3tools/shared/epicRun";
import { isEpicCoordinationComplete } from "@t3tools/shared/epicCoordination";

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

export type EpicRunDriveDecision =
  | { readonly type: "noop" }
  | { readonly type: "fail_run"; readonly reason: string }
  | { readonly type: "reconcile_current" }
  | { readonly type: "launch" };

export type LaunchNextTaskDecision =
  | { readonly type: "noop" }
  | { readonly type: "fail_run"; readonly reason: string }
  | { readonly type: "block_run" }
  | { readonly type: "idle_run" }
  | { readonly type: "complete_run" }
  | { readonly type: "launch_issue"; readonly issue: BeadsIssueRelationSummary };

export function isBackgroundEpicRunSchedulerTrigger(trigger: EpicRunSchedulerTrigger): boolean {
  return trigger === "startup_reconcile" || trigger === "periodic_reconcile";
}

export function decideDriveRun(input: {
  readonly run: OrchestrationEpicRun;
  readonly trigger: EpicRunSchedulerTrigger;
  readonly projectInvariant: {
    readonly winnerRunId: EpicRunId | null;
    readonly failureReason: string | null;
  };
  readonly executionInvariant: {
    readonly currentExecution: OrchestrationEpicIssueExecution | null;
    readonly violationReason: string | null;
  };
}): EpicRunDriveDecision {
  if (input.projectInvariant.failureReason !== null) {
    return {
      type: "fail_run",
      reason: input.projectInvariant.failureReason,
    };
  }

  if (input.executionInvariant.violationReason !== null) {
    return {
      type: "fail_run",
      reason: input.executionInvariant.violationReason,
    };
  }

  if (input.executionInvariant.currentExecution !== null) {
    return { type: "reconcile_current" };
  }

  switch (input.run.status) {
    case "pending":
    case "running":
      return { type: "launch" };
    case "stopping":
    case "stopped":
    case "failed":
    case "completed":
      return { type: "noop" };
  }
}

export function getAttemptedIssueIds(
  executions: ReadonlyArray<OrchestrationEpicIssueExecution>,
): ReadonlySet<string> {
  return new Set(executions.map((execution) => execution.issueId));
}

export function decideLaunchNextTask(input: {
  readonly run: OrchestrationEpicRun;
  readonly trigger: EpicRunSchedulerTrigger;
  readonly trackerStatus: BeadsEpicCoordinationStatus;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): LaunchNextTaskDecision {
  if (input.trackerStatus.active.length > 0) {
    return { type: "idle_run" };
  }

  const attemptedIssueIds = getAttemptedIssueIds(input.executions);
  const nextReadyIssue = selectLaunchableReadyIssue({
    readyIssues: input.trackerStatus.ready,
    attemptedIssueIds,
  });

  if (nextReadyIssue !== null) {
    return {
      type: "launch_issue",
      issue: nextReadyIssue,
    };
  }

  if (
    input.trackerStatus.ready.length > 0 &&
    countLaunchableReadyIssues({
      readyIssues: input.trackerStatus.ready,
      attemptedIssueIds,
    }) === 0
  ) {
    return {
      type: "fail_run",
      reason: describeReadyIssueExhaustion({
        runId: input.run.runId,
        attemptedIssueIds,
        readyIssues: input.trackerStatus.ready,
      }),
    };
  }

  const executionBlocking = deriveExecutionBlocking(input.trackerStatus);
  if (executionBlocking.hasExecutionBlockingIssues) {
    return { type: "block_run" };
  }

  if (!isEpicCoordinationComplete(input.trackerStatus.summary)) {
    return { type: "idle_run" };
  }

  return { type: "complete_run" };
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
    "Stop the run, fix the coordination or code state, then start a new run when ready.",
  ].join(" ");
}
