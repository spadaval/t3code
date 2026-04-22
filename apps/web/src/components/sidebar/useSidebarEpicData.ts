import type { BeadsCoordinatorEpicSnapshot, ProjectId } from "@t3tools/contracts";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  beadsEpicCoordinationDetailOptions,
  beadsEpicIssueSummariesOptions,
  beadsProjectRunSummaryOptions,
} from "~/lib/beadsReactQuery";
import { composeCoordinatorEpicSnapshot } from "~/lib/coordinatorSnapshots";

function collectIssueTitlesFromSnapshot(
  snapshot: BeadsCoordinatorEpicSnapshot,
): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  const recordIssue = (issue: { id: string; title: string }) => {
    if (!titles.has(issue.id)) {
      titles.set(issue.id, issue.title);
    }
  };

  if (snapshot.issue) {
    recordIssue(snapshot.issue);
  }
  for (const issue of snapshot.status?.completed ?? []) {
    recordIssue(issue);
  }
  for (const issue of snapshot.status?.active ?? []) {
    recordIssue(issue);
  }
  for (const issue of snapshot.status?.ready ?? []) {
    recordIssue(issue);
  }
  for (const issue of snapshot.status?.blocked ?? []) {
    recordIssue(issue);
  }
  for (const front of snapshot.validation?.readyFronts ?? []) {
    for (const issue of front) {
      recordIssue(issue);
    }
  }

  return titles;
}

export function useSidebarEpicData(input: {
  cwd: string;
  projectId: ProjectId;
  projectExpanded: boolean;
  projectEpicRuns: ReadonlyArray<{ epicIssueId: string }>;
}) {
  const projectRunSummaryQuery = useQuery(
    beadsProjectRunSummaryOptions(
      input.projectExpanded ? { cwd: input.cwd, projectId: input.projectId, enabled: true } : null,
    ),
  );

  const epicTitleByIssueId = useMemo(
    () =>
      new Map(
        (projectRunSummaryQuery.data?.epics ?? []).map(
          (epic) => [epic.epicIssueId, epic.epicTitle] as const,
        ),
      ),
    [projectRunSummaryQuery.data?.epics],
  );

  const epicIssueIds = useMemo(
    () => [...new Set(input.projectEpicRuns.map((run) => run.epicIssueId))],
    [input.projectEpicRuns],
  );

  const epicIssueSummariesQueries = useQueries({
    queries: epicIssueIds.map((epicIssueId) =>
      beadsEpicIssueSummariesOptions(
        input.projectExpanded ? { cwd: input.cwd, epicIssueId, enabled: true } : null,
      ),
    ),
  });

  const epicCoordinationDetailQueries = useQueries({
    queries: epicIssueIds.map((epicIssueId) =>
      beadsEpicCoordinationDetailOptions(
        input.projectExpanded
          ? {
              cwd: input.cwd,
              projectId: input.projectId,
              epicIssueId,
              enabled: true,
            }
          : null,
      ),
    ),
  });

  const epicSnapshotByIssueId = useMemo(() => {
    const snapshots = new Map<string, BeadsCoordinatorEpicSnapshot>();
    for (const [index, epicIssueId] of epicIssueIds.entries()) {
      const epicCoordinationDetail = epicCoordinationDetailQueries[index]?.data;
      if (!epicCoordinationDetail) {
        continue;
      }

      snapshots.set(
        epicIssueId,
        composeCoordinatorEpicSnapshot({
          epicIssueId,
          projectRunSummary: projectRunSummaryQuery.data ?? null,
          epicIssueSummaries: epicIssueSummariesQueries[index]?.data ?? null,
          epicCoordinationDetail,
        }),
      );
    }
    return snapshots as ReadonlyMap<string, BeadsCoordinatorEpicSnapshot>;
  }, [
    epicCoordinationDetailQueries,
    epicIssueIds,
    epicIssueSummariesQueries,
    projectRunSummaryQuery.data,
  ]);

  const issueTitleByIssueId = useMemo(() => {
    const map = new Map<string, string>();
    for (const snapshot of epicSnapshotByIssueId.values()) {
      for (const [issueId, title] of collectIssueTitlesFromSnapshot(snapshot)) {
        if (!map.has(issueId)) {
          map.set(issueId, title);
        }
      }
    }
    return map as ReadonlyMap<string, string>;
  }, [epicSnapshotByIssueId]);

  const epicIssueStatusById = useMemo(
    () =>
      new Map(
        [...epicSnapshotByIssueId.entries()].flatMap(([epicIssueId, snapshot]) =>
          snapshot.issue ? ([[epicIssueId, snapshot.issue.status]] as const) : [],
        ),
      ) as ReadonlyMap<string, string>,
    [epicSnapshotByIssueId],
  );

  return {
    projectRunSummaryQuery,
    epicIssueIds,
    epicTitleByIssueId,
    epicSnapshotByIssueId,
    issueTitleByIssueId,
    epicIssueStatusById,
  };
}
