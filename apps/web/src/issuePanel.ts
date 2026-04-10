import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueSummary,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  OrchestrationEpicRun,
  ThreadId,
} from "@t3tools/contracts";
import {
  describeEpicRunCoordinatorFetchFailure,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  deriveExecutionBlocking,
  deriveEpicCoordinatorState as deriveEpicCoordinatorStateShared,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
  getEpicCoordinatorPrimaryAction as getEpicCoordinatorPrimaryActionShared,
  isEpicRunCoordinatorFetchTimeoutMessage,
  type EpicCoordinatorPrimaryAction as SharedEpicCoordinatorPrimaryAction,
  type EpicCoordinatorState as SharedEpicCoordinatorState,
  type EpicCoordinatorStateKind as SharedEpicCoordinatorStateKind,
  selectLatestEpicRun as selectLatestEpicRunCore,
  type EpicRunCoordinatorFetchLifecycle,
  type EpicRunCoordinatorFetchLifecycleKind,
} from "@t3tools/shared/epicRun";
import { describeProposedPlanFollowUpOutcome as describeProposedPlanFollowUpOutcomeShared } from "@t3tools/shared/plan";

export interface CoordinatorTrackerEpicSections {
  readonly runningEpics: ReadonlyArray<BeadsSwarmSummary>;
  readonly readyToRunEpics: ReadonlyArray<BeadsSwarmSummary>;
}

export interface CoordinatorEpicEntry {
  readonly epicId: string;
  readonly epicTitle: string;
  readonly issue: BeadsIssueSummary | null;
}

export interface CoordinatorEpicStateSections<T> {
  readonly needsAttention: ReadonlyArray<T>;
  readonly active: ReadonlyArray<T>;
  readonly history: ReadonlyArray<T>;
}

export interface SharedWorkspaceProjectConflict {
  readonly run: OrchestrationEpicRun;
  readonly message: string;
}

export type CoordinatorFetchLifecycleKind = EpicRunCoordinatorFetchLifecycleKind;
export type CoordinatorFetchLifecycle = EpicRunCoordinatorFetchLifecycle;

export interface CoordinatorFetchQueryState {
  readonly pending: boolean;
  readonly hasData: boolean;
  readonly error: string | null;
}

export type EpicCoordinatorStateKind = SharedEpicCoordinatorStateKind;
export type EpicCoordinatorState = SharedEpicCoordinatorState;
export type EpicCoordinatorPrimaryAction = SharedEpicCoordinatorPrimaryAction;

export function deriveCoordinatorFetchLifecycle(input: {
  readonly support: CoordinatorFetchQueryState;
  readonly requireTrackerState: boolean;
  readonly validation?: CoordinatorFetchQueryState | null;
  readonly status?: CoordinatorFetchQueryState | null;
}): CoordinatorFetchLifecycle {
  if (input.support.pending && !input.support.hasData) {
    return {
      kind: "loading",
      detail: null,
    };
  }

  if (input.support.error) {
    const timedOut = isEpicRunCoordinatorFetchTimeoutMessage(input.support.error);
    return {
      kind: input.support.hasData ? "stale" : timedOut ? "timeout" : "error",
      detail: describeEpicRunCoordinatorFetchFailure({
        failures: [
          {
            source: "support",
            message: input.support.error,
          },
        ],
        stale: input.support.hasData,
      }),
    };
  }

  if (!input.requireTrackerState) {
    return {
      kind: "ready",
      detail: null,
    };
  }

  const validation = input.validation ?? { pending: false, hasData: false, error: null };
  const status = input.status ?? { pending: false, hasData: false, error: null };
  const hasTrackerData = validation.hasData || status.hasData;
  const pending = validation.pending || status.pending;
  const failures = [
    validation.error === null
      ? null
      : {
          source: "validation" as const,
          message: validation.error,
        },
    status.error === null
      ? null
      : {
          source: "status" as const,
          message: status.error,
        },
  ].filter(
    (value): value is { readonly source: "validation" | "status"; readonly message: string } =>
      value !== null,
  );

  if (failures.length > 0) {
    return {
      kind: hasTrackerData
        ? "stale"
        : failures.some((failure) => isEpicRunCoordinatorFetchTimeoutMessage(failure.message))
          ? "timeout"
          : "error",
      detail: describeEpicRunCoordinatorFetchFailure({
        failures,
        stale: hasTrackerData,
      }),
    };
  }

  if (pending) {
    return {
      kind: hasTrackerData ? "stale" : "loading",
      detail: hasTrackerData
        ? "Showing the last known epic-run state while the latest refresh completes."
        : null,
    };
  }

  return {
    kind: "ready",
    detail: null,
  };
}

export function describeSharedWorkspaceProjectConflict(
  run: OrchestrationEpicRun,
): SharedWorkspaceProjectConflict {
  return {
    run,
    message: describeSharedWorkspaceProjectConflictMessage(run),
  };
}

export function describeProposedPlanFollowUpOutcome(outcome: {
  readonly kind: "implement-code" | "convert-to-tracker";
}): string {
  return describeProposedPlanFollowUpOutcomeShared(outcome);
}

export function isEpicIssueType(issueType: string | null | undefined): boolean {
  return issueType?.trim().toLowerCase() === "epic";
}

export function listEpicChildIssues(input: {
  readonly issues: readonly BeadsIssueSummary[];
  readonly epicId: string | null;
}): BeadsIssueSummary[] {
  if (input.epicId === null) {
    return [];
  }

  return input.issues.filter((issue) => issue.parent?.id === input.epicId);
}

export function listEpicDescendantIssues(input: {
  readonly issues: readonly BeadsIssueSummary[];
  readonly epicId: string | null;
}): BeadsIssueSummary[] {
  if (input.epicId === null) {
    return [];
  }

  const descendantIds = new Set<string>([input.epicId]);
  const descendants: BeadsIssueSummary[] = [];
  let discovered = true;

  while (discovered) {
    discovered = false;

    for (const issue of input.issues) {
      const parentId = issue.parent?.id ?? null;
      if (parentId === null || !descendantIds.has(parentId) || descendantIds.has(issue.id)) {
        continue;
      }

      descendantIds.add(issue.id);
      descendants.push(issue);
      discovered = true;
    }
  }

  return descendants;
}

export function selectLatestEpicRun(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun | null {
  return selectLatestEpicRunCore(epicRuns);
}

export function findConflictingSharedWorkspaceRun(input: {
  readonly projectEpicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
}): SharedWorkspaceProjectConflict | null {
  const run = findConflictingSharedWorkspaceRunCore(input);
  return run ? describeSharedWorkspaceProjectConflict(run) : null;
}

export function deriveEpicCoordinatorState(input: {
  readonly coordinationSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly fetchLifecycle: CoordinatorFetchLifecycle;
}): EpicCoordinatorState {
  return deriveEpicCoordinatorStateShared(input);
}

export function getEpicCoordinatorPrimaryAction(input: {
  readonly coordinationSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status:
    | (Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsSwarmStatus, "blockedBreakdown">>)
    | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> | null;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly projectConflict: SharedWorkspaceProjectConflict | null;
  readonly fetchLifecycle: CoordinatorFetchLifecycle;
}): EpicCoordinatorPrimaryAction {
  const { projectConflict: _projectConflict, ...sharedInput } = input;
  return getEpicCoordinatorPrimaryActionShared({
    ...sharedInput,
    hasProjectConflict: input.projectConflict !== null,
  });
}

function summarizeIssueIds(issues: ReadonlyArray<{ readonly id: string }>): string {
  return issues
    .slice(0, 3)
    .map((issue) => issue.id)
    .join(", ");
}

export function describeDisabledEpicCoordinatorAction(input: {
  readonly epic: Pick<
    BeadsCoordinatorEpicSnapshot,
    | "primaryAction"
    | "trackerLoadState"
    | "trackerLoadDetail"
    | "coordinationSupported"
    | "coordinationUnsupportedReason"
    | "status"
  > | null;
  readonly supportReason?: string | null;
}): string | null {
  if (input.epic === null) {
    return "Checking epic status.";
  }

  if (!input.epic.primaryAction.disabled) {
    return null;
  }

  if (input.epic.trackerLoadState !== "ready") {
    return input.epic.trackerLoadDetail ?? "Checking epic status.";
  }

  if (!input.epic.coordinationSupported) {
    return (
      input.epic.coordinationUnsupportedReason ??
      input.supportReason ??
      "Epic coordination is unavailable for this project."
    );
  }

  if (input.epic.primaryAction.kind === "stop_epic_run") {
    const executionBlocking = deriveExecutionBlocking(input.epic.status);
    if ((input.epic.status?.active.length ?? 0) > 0) {
      return `Wait for Beads to reconcile active work for this epic: ${summarizeIssueIds(input.epic.status?.active ?? [])}.`;
    }
    if (
      executionBlocking.externalBlockedIssues.length > 0 ||
      executionBlocking.unknownBlockedIssues.length > 0
    ) {
      return "Blocked tracker work does not prevent opening the coordinator.";
    }
  }

  return (
    input.epic.trackerLoadDetail ?? `${input.epic.primaryAction.label} is currently unavailable.`
  );
}

export function collectCoordinatorEpics(input: {
  readonly epicIssues: ReadonlyArray<BeadsIssueSummary>;
  readonly swarms: ReadonlyArray<BeadsSwarmSummary>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
}): CoordinatorEpicEntry[] {
  const entries = new Map<string, CoordinatorEpicEntry>();

  for (const issue of input.epicIssues) {
    entries.set(issue.id, {
      epicId: issue.id,
      epicTitle: issue.title,
      issue,
    });
  }

  for (const swarm of input.swarms) {
    if (!entries.has(swarm.epicId)) {
      entries.set(swarm.epicId, {
        epicId: swarm.epicId,
        epicTitle: swarm.epicTitle,
        issue: null,
      });
    }
  }

  for (const run of input.epicRuns) {
    if (!entries.has(run.epicIssueId)) {
      entries.set(run.epicIssueId, {
        epicId: run.epicIssueId,
        epicTitle: run.epicIssueId,
        issue: null,
      });
    }
  }

  return [...entries.values()];
}

type CoordinatorEpicPartitionable = Pick<
  BeadsCoordinatorEpicSnapshot,
  | "trackerLoadState"
  | "coordinationSupported"
  | "validationState"
  | "projectConflict"
  | "activeRunId"
  | "trackerState"
  | "runs"
>;

export function partitionCoordinatorEpics<T extends object>(
  items: ReadonlyArray<T & CoordinatorEpicPartitionable>,
): CoordinatorEpicStateSections<T & CoordinatorEpicPartitionable> {
  const needsAttention: Array<T & CoordinatorEpicPartitionable> = [];
  const active: Array<T & CoordinatorEpicPartitionable> = [];
  const history: Array<T & CoordinatorEpicPartitionable> = [];

  for (const item of items) {
    const activeRun = item.activeRunId
      ? (item.runs.find((run) => run.runId === item.activeRunId) ?? null)
      : null;

    if (
      item.trackerLoadState !== "ready" ||
      !item.coordinationSupported ||
      item.validationState === "invalid" ||
      item.projectConflict !== null ||
      activeRun?.status === "failed"
    ) {
      needsAttention.push(item);
      continue;
    }

    if (item.activeRunId !== null || item.trackerState === "in_progress") {
      active.push(item);
      continue;
    }

    history.push(item);
  }

  return {
    needsAttention,
    active,
    history,
  };
}

export function partitionCoordinatorTrackerEpics(
  swarms: ReadonlyArray<BeadsSwarmSummary>,
): CoordinatorTrackerEpicSections {
  const runningEpics = swarms
    .filter((swarm) => swarm.activeWorkerCount > 0)
    .toSorted((left, right) => {
      const activeWorkersDelta = right.activeWorkerCount - left.activeWorkerCount;
      if (activeWorkersDelta !== 0) {
        return activeWorkersDelta;
      }
      const readyDelta = right.readyIssueCount - left.readyIssueCount;
      if (readyDelta !== 0) {
        return readyDelta;
      }
      return left.epicTitle.localeCompare(right.epicTitle);
    });

  const readyToRunEpics = swarms
    .filter((swarm) => swarm.activeWorkerCount === 0 && swarm.readyIssueCount > 0)
    .toSorted((left, right) => {
      const readyDelta = right.readyIssueCount - left.readyIssueCount;
      if (readyDelta !== 0) {
        return readyDelta;
      }
      return left.epicTitle.localeCompare(right.epicTitle);
    });

  return {
    runningEpics,
    readyToRunEpics,
  };
}

export interface TrackerRefinementPlanCandidate {
  readonly id: ThreadId;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt?: string | undefined;
  readonly issueLink: {
    readonly issueId: string;
  } | null;
  readonly proposedPlans: ReadonlyArray<{
    readonly id: string;
    readonly planMarkdown: string;
    readonly planIntent: "code-implementation" | "tracker-refinement";
    readonly followUpOutcome: {
      readonly kind: "implement-code" | "convert-to-tracker";
      readonly completedAt: string;
      readonly targetThreadId: ThreadId | null;
    } | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
}

export interface LatestTrackerRefinementPlan {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly planId: string;
  readonly planMarkdown: string;
  readonly followUpOutcome: {
    readonly kind: "implement-code" | "convert-to-tracker";
    readonly completedAt: string;
    readonly targetThreadId: ThreadId | null;
  } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function findLatestTrackerRefinementPlan(input: {
  readonly threads: ReadonlyArray<TrackerRefinementPlanCandidate>;
  readonly projectId: string | null;
  readonly issueId: string | null;
}): LatestTrackerRefinementPlan | null {
  if (input.projectId === null || input.issueId === null) {
    return null;
  }

  const candidates = input.threads.flatMap((thread) => {
    if (thread.projectId !== input.projectId || thread.issueLink?.issueId !== input.issueId) {
      return [];
    }

    return thread.proposedPlans
      .filter((plan) => plan.planIntent === "tracker-refinement")
      .map((plan) => ({
        threadId: thread.id,
        threadTitle: thread.title,
        planId: plan.id,
        planMarkdown: plan.planMarkdown,
        followUpOutcome: plan.followUpOutcome,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        threadUpdatedAt: thread.updatedAt ?? thread.createdAt,
      }));
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }
    const createdAtDelta = right.createdAt.localeCompare(left.createdAt);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    const threadUpdatedAtDelta = right.threadUpdatedAt.localeCompare(left.threadUpdatedAt);
    if (threadUpdatedAtDelta !== 0) {
      return threadUpdatedAtDelta;
    }
    return left.planId.localeCompare(right.planId);
  });

  const latest = candidates[0]!;
  return {
    threadId: latest.threadId,
    threadTitle: latest.threadTitle,
    planId: latest.planId,
    planMarkdown: latest.planMarkdown,
    followUpOutcome: latest.followUpOutcome,
    createdAt: latest.createdAt,
    updatedAt: latest.updatedAt,
  };
}
