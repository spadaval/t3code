import type {
  BeadsIssueSummary,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  ThreadId,
} from "@t3tools/contracts";

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

export function getEpicCoordinatorImplementAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
  readonly isSupportPending: boolean;
  readonly isValidationPending: boolean;
}) {
  if (input.isSupportPending || input.isValidationPending) {
    return {
      kind: "implement",
      label: "Checking swarm...",
      disabled: true,
    } as const;
  }

  if (input.swarmSupport?.supported !== true) {
    return {
      kind: "implement",
      label: "Implement",
      disabled: true,
    } as const;
  }

  if (input.validation?.valid === true && input.validation.swarm !== null) {
    return {
      kind: "implement",
      label: "Implement",
      disabled: false,
    } as const;
  }

  return {
    kind: "plan_implementation",
    label: "Plan implementation",
    disabled: false,
  } as const;
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
    readonly implementedAt: string | null;
    readonly implementationThreadId: ThreadId | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
}

export interface LatestTrackerRefinementPlan {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly planId: string;
  readonly planMarkdown: string;
  readonly implementedAt: string | null;
  readonly implementationThreadId: ThreadId | null;
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
        implementedAt: plan.implementedAt,
        implementationThreadId: plan.implementationThreadId,
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
    implementedAt: latest.implementedAt,
    implementationThreadId: latest.implementationThreadId,
    createdAt: latest.createdAt,
    updatedAt: latest.updatedAt,
  };
}
