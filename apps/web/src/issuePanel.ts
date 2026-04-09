import type {
  BeadsIssueSummary,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  OrchestrationSwarmRun,
  ThreadId,
} from "@t3tools/contracts";
import {
  describeSwarmCoordinatorFetchFailure,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  deriveEpicSwarmCoordinatorState,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
  getEpicSwarmCoordinatorPrimaryAction,
  isSwarmCoordinatorFetchTimeoutMessage,
  type EpicSwarmCoordinatorPrimaryAction,
  type EpicSwarmCoordinatorState,
  type EpicSwarmCoordinatorStateKind,
  selectLatestSwarmRun as selectLatestSwarmRunCore,
  type SwarmCoordinatorFetchLifecycle,
  type SwarmCoordinatorFetchLifecycleKind,
} from "@t3tools/shared/swarm";
import { describeProposedPlanFollowUpOutcome as describeProposedPlanFollowUpOutcomeShared } from "@t3tools/shared/plan";

export interface EpicGroup {
  readonly key: string;
  readonly epicId: string | null;
  readonly epicTitle: string | null;
  readonly epicIssue: BeadsIssueSummary | null;
  readonly issues: readonly BeadsIssueSummary[];
}

export interface CoordinatorSwarmSections {
  readonly runningSwarms: ReadonlyArray<BeadsSwarmSummary>;
  readonly readyToRunSwarms: ReadonlyArray<BeadsSwarmSummary>;
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
  readonly run: OrchestrationSwarmRun;
  readonly message: string;
}

export type CoordinatorFetchLifecycleKind = SwarmCoordinatorFetchLifecycleKind;
export type CoordinatorFetchLifecycle = SwarmCoordinatorFetchLifecycle;

export interface CoordinatorFetchQueryState {
  readonly pending: boolean;
  readonly hasData: boolean;
  readonly error: string | null;
}

export type EpicCoordinatorStateKind = EpicSwarmCoordinatorStateKind;
export type EpicCoordinatorState = EpicSwarmCoordinatorState;
export type EpicCoordinatorPrimaryAction = EpicSwarmCoordinatorPrimaryAction;

const ACTIVE_COORDINATOR_STATE_KINDS = new Set<EpicCoordinatorStateKind>(["running"]);

const HISTORY_COORDINATOR_STATE_KINDS = new Set<EpicCoordinatorStateKind>([
  "cancelled",
  "completed",
]);

export function deriveCoordinatorFetchLifecycle(input: {
  readonly support: CoordinatorFetchQueryState;
  readonly requireSwarmState: boolean;
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
    const timedOut = isSwarmCoordinatorFetchTimeoutMessage(input.support.error);
    return {
      kind: input.support.hasData ? "stale" : timedOut ? "timeout" : "error",
      detail: describeSwarmCoordinatorFetchFailure({
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

  if (!input.requireSwarmState) {
    return {
      kind: "ready",
      detail: null,
    };
  }

  const validation = input.validation ?? { pending: false, hasData: false, error: null };
  const status = input.status ?? { pending: false, hasData: false, error: null };
  const hasSwarmData = validation.hasData || status.hasData;
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
      kind: hasSwarmData
        ? "stale"
        : failures.some((failure) => isSwarmCoordinatorFetchTimeoutMessage(failure.message))
          ? "timeout"
          : "error",
      detail: describeSwarmCoordinatorFetchFailure({
        failures,
        stale: hasSwarmData,
      }),
    };
  }

  if (pending) {
    return {
      kind: hasSwarmData ? "stale" : "loading",
      detail: hasSwarmData
        ? "Showing the last known swarm state while the latest refresh completes."
        : null,
    };
  }

  return {
    kind: "ready",
    detail: null,
  };
}

export function describeSharedWorkspaceProjectConflict(
  run: OrchestrationSwarmRun,
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

export function groupIssuesByEpic(issues: readonly BeadsIssueSummary[]): EpicGroup[] {
  const epicMap = new Map<string, EpicGroup>();
  const epicIndexes = new Map<string, number>();
  const groupedIssues: EpicGroup[] = [];

  for (const issue of issues) {
    if (isEpicIssueType(issue.issueType)) {
      const existingEpicGroup = epicMap.get(issue.id);
      if (existingEpicGroup) {
        const groupIndex = epicIndexes.get(issue.id)!;
        const updatedGroup = {
          ...existingEpicGroup,
          epicTitle: issue.title,
          epicIssue: issue,
        } satisfies EpicGroup;
        epicMap.set(issue.id, updatedGroup);
        groupedIssues[groupIndex] = updatedGroup;
        continue;
      }

      const epicGroup = {
        key: `epic:${issue.id}`,
        epicId: issue.id,
        epicTitle: issue.title,
        epicIssue: issue,
        issues: [],
      } satisfies EpicGroup;
      epicMap.set(issue.id, epicGroup);
      groupedIssues.push(epicGroup);
      epicIndexes.set(issue.id, groupedIssues.length - 1);
      continue;
    }

    const epicId = issue.parent?.id ?? null;
    if (epicId === null) {
      groupedIssues.push({
        key: `issue:${issue.id}`,
        epicId: null,
        epicTitle: null,
        epicIssue: null,
        issues: [issue],
      });
      continue;
    }

    const existingEpicGroup = epicMap.get(epicId);
    if (existingEpicGroup) {
      const groupIndex = epicIndexes.get(epicId)!;
      const updatedGroup = {
        ...existingEpicGroup,
        issues: [...existingEpicGroup.issues, issue],
      } satisfies EpicGroup;
      epicMap.set(epicId, updatedGroup);
      groupedIssues[groupIndex] = updatedGroup;
      continue;
    }

    const epicGroup = {
      key: `epic:${epicId}`,
      epicId,
      epicTitle: issue.parent?.title ?? null,
      epicIssue: null,
      issues: [issue],
    } satisfies EpicGroup;
    epicMap.set(epicId, epicGroup);
    groupedIssues.push(epicGroup);
    epicIndexes.set(epicId, groupedIssues.length - 1);
  }

  return groupedIssues;
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

export function selectLatestSwarmRun(
  swarmRuns: ReadonlyArray<OrchestrationSwarmRun>,
): OrchestrationSwarmRun | null {
  return selectLatestSwarmRunCore(swarmRuns);
}

export function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
}): SharedWorkspaceProjectConflict | null {
  const run = findConflictingSharedWorkspaceRunCore(input);
  return run ? describeSharedWorkspaceProjectConflict(run) : null;
}

export function deriveEpicCoordinatorState(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly fetchLifecycle: CoordinatorFetchLifecycle;
}): EpicCoordinatorState {
  return deriveEpicSwarmCoordinatorState(input);
}

export function getEpicCoordinatorPrimaryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly projectConflict: SharedWorkspaceProjectConflict | null;
  readonly fetchLifecycle: CoordinatorFetchLifecycle;
}): EpicCoordinatorPrimaryAction {
  return getEpicSwarmCoordinatorPrimaryAction({
    ...input,
    hasProjectConflict: input.projectConflict !== null,
  });
}

export function collectCoordinatorEpics(input: {
  readonly epicIssues: ReadonlyArray<BeadsIssueSummary>;
  readonly swarms: ReadonlyArray<BeadsSwarmSummary>;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
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

  for (const run of input.swarmRuns) {
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

export function partitionCoordinatorEpics<T extends { stateKind: EpicCoordinatorStateKind }>(
  items: ReadonlyArray<T>,
): CoordinatorEpicStateSections<T> {
  const needsAttention: T[] = [];
  const active: T[] = [];
  const history: T[] = [];

  for (const item of items) {
    if (ACTIVE_COORDINATOR_STATE_KINDS.has(item.stateKind)) {
      active.push(item);
      continue;
    }

    if (HISTORY_COORDINATOR_STATE_KINDS.has(item.stateKind)) {
      history.push(item);
      continue;
    }

    needsAttention.push(item);
  }

  return {
    needsAttention,
    active,
    history,
  };
}

export function partitionCoordinatorSwarms(
  swarms: ReadonlyArray<BeadsSwarmSummary>,
): CoordinatorSwarmSections {
  const runningSwarms = swarms
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

  const readyToRunSwarms = swarms
    .filter((swarm) => swarm.activeWorkerCount === 0 && swarm.readyIssueCount > 0)
    .toSorted((left, right) => {
      const readyDelta = right.readyIssueCount - left.readyIssueCount;
      if (readyDelta !== 0) {
        return readyDelta;
      }
      return left.epicTitle.localeCompare(right.epicTitle);
    });

  return {
    runningSwarms,
    readyToRunSwarms,
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
