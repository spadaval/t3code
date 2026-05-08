import type { BeadsEpicIssueSummaries, BeadsIssueSummary } from "@t3tools/contracts";

import { isIssueDoneStatus } from "./issueConstants";

export interface DraftQuickLaunchBaseRow {
  readonly id: string;
  readonly title: string;
  readonly issueType: string;
  readonly priority: number | null;
  readonly updatedAt: string;
  readonly status: string;
}

export interface DraftQuickLaunchEpicRow extends DraftQuickLaunchBaseRow {
  readonly kind: "epic";
  readonly readyIssueCount: number;
  readonly totalIssueCount: number;
  readonly activeWorkerCount: number;
}

export interface DraftQuickLaunchStandaloneIssueRow extends DraftQuickLaunchBaseRow {
  readonly kind: "standalone";
}

export interface DraftQuickLaunchSection<TItem> {
  readonly kind: "epics" | "standalone";
  readonly title: string;
  readonly items: ReadonlyArray<TItem>;
}

function compareNullablePriority(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function compareRowsByTitleAndId(
  left: Pick<DraftQuickLaunchBaseRow, "title" | "id">,
  right: Pick<DraftQuickLaunchBaseRow, "title" | "id">,
): number {
  return (
    left.title.localeCompare(right.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.id.localeCompare(right.id)
  );
}

function hasUnresolvedStandaloneBlockers(
  issue: Pick<BeadsIssueSummary, "dependencyRefs">,
  issuesById: ReadonlyMap<string, BeadsIssueSummary>,
): boolean {
  for (const dependencyRef of issue.dependencyRefs) {
    if (
      dependencyRef.dependencyType !== "blocked_by" &&
      dependencyRef.dependencyType !== "depends_on"
    ) {
      continue;
    }

    const dependencyIssue = issuesById.get(dependencyRef.dependsOnId);
    if (!dependencyIssue || !isIssueDoneStatus(dependencyIssue.status)) {
      return true;
    }
  }

  return false;
}

export function deriveReadyEpicRows(input: {
  readonly issuesById: ReadonlyMap<string, BeadsIssueSummary>;
  readonly epicIssueSummariesById: ReadonlyMap<string, BeadsEpicIssueSummaries>;
}): DraftQuickLaunchEpicRow[] {
  return [...input.epicIssueSummariesById.entries()]
    .flatMap(([epicIssueId, epicIssueSummaries]) => {
      const issue = input.issuesById.get(epicIssueId);
      const progress = epicIssueSummaries.progress;
      if (progress.isComplete || progress.readyIssueCount <= 0) {
        return [];
      }

      return [
        {
          kind: "epic" as const,
          id: epicIssueId,
          title: issue?.title ?? epicIssueSummaries.epicTitle,
          issueType: issue?.issueType ?? "epic",
          priority: issue?.priority ?? null,
          updatedAt: issue?.updatedAt ?? "",
          status: issue?.status ?? "open",
          readyIssueCount: progress.readyIssueCount,
          totalIssueCount: progress.totalIssueCount,
          activeWorkerCount: progress.activeWorkerCount,
        },
      ];
    })
    .toSorted((left, right) => {
      const priorityDelta = compareNullablePriority(left.priority, right.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const readyDelta = right.readyIssueCount - left.readyIssueCount;
      if (readyDelta !== 0) {
        return readyDelta;
      }

      const updatedDelta = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      return compareRowsByTitleAndId(left, right);
    });
}

export function deriveReadyStandaloneIssueRows(input: {
  readonly issuesById: ReadonlyMap<string, BeadsIssueSummary>;
}): DraftQuickLaunchStandaloneIssueRow[] {
  return [...input.issuesById.values()]
    .filter((issue) => issue.issueType !== "epic")
    .filter((issue) => issue.parent === null)
    .filter((issue) => !isIssueDoneStatus(issue.status))
    .filter(
      (issue) =>
        issue.status !== "blocked" &&
        issue.status !== "deferred" &&
        issue.status !== "in_progress" &&
        issue.status !== "hooked",
    )
    .filter((issue) => !hasUnresolvedStandaloneBlockers(issue, input.issuesById))
    .map(
      (issue): DraftQuickLaunchStandaloneIssueRow => ({
        kind: "standalone",
        id: issue.id,
        title: issue.title,
        issueType: issue.issueType,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        status: issue.status,
      }),
    )
    .toSorted((left, right) => {
      const priorityDelta = compareNullablePriority(left.priority, right.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const updatedDelta = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      return compareRowsByTitleAndId(left, right);
    });
}

export function deriveDraftQuickLaunchSections(input: {
  readonly issuesById: ReadonlyMap<string, BeadsIssueSummary>;
  readonly epicIssueSummariesById: ReadonlyMap<string, BeadsEpicIssueSummaries>;
}): {
  readonly epicRows: ReadonlyArray<DraftQuickLaunchEpicRow>;
  readonly standaloneRows: ReadonlyArray<DraftQuickLaunchStandaloneIssueRow>;
  readonly sections: ReadonlyArray<
    DraftQuickLaunchSection<DraftQuickLaunchEpicRow | DraftQuickLaunchStandaloneIssueRow>
  >;
} {
  const epicRows = deriveReadyEpicRows({
    issuesById: input.issuesById,
    epicIssueSummariesById: input.epicIssueSummariesById,
  });
  const standaloneRows = deriveReadyStandaloneIssueRows({
    issuesById: input.issuesById,
  });
  const sections: Array<
    DraftQuickLaunchSection<DraftQuickLaunchEpicRow | DraftQuickLaunchStandaloneIssueRow>
  > = [];

  if (epicRows.length > 0) {
    sections.push({
      kind: "epics",
      title: "Ready epics",
      items: epicRows,
    });
  }

  if (standaloneRows.length > 0) {
    sections.push({
      kind: "standalone",
      title: "Ready standalone issues",
      items: standaloneRows,
    });
  }

  return {
    epicRows,
    standaloneRows,
    sections,
  };
}
