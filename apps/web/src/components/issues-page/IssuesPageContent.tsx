import type { BeadsIssueSortBy, ProjectId, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
  beadsContextOptions,
  beadsQueryIssuesOptions,
} from "~/lib/beadsReactQuery";
import { buildIssueListQueryInput } from "~/lib/issueListQueries";
import { buildCanonicalIssuesRouteSearch, parseIssuesRouteSearch } from "~/issuesRouteSearch";
import { useProjectById } from "~/storeSelectors";
import { IssuesTab } from "./IssuesTab";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IssuesPageContent({ projectId }: { projectId: ProjectId }) {
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false });
  const search = useMemo(() => parseIssuesRouteSearch(rawSearch), [rawSearch]);
  const showClosed = search.showClosed ?? false;
  const sortBy = search.sort ?? "updated";
  const project = useProjectById(projectId) ?? null;
  const cwd = project?.cwd ?? null;

  // Core data queries
  useQuery(beadsContextOptions(cwd ? { cwd } : null));

  const issuesQuery = useQuery(
    beadsQueryIssuesOptions(
      buildIssueListQueryInput({
        cwd: cwd ?? "",
        sortBy,
        enabled: cwd !== null,
        refetchIntervalMs: ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
        refetchOnWindowFocus: false,
      }),
    ),
  );

  const setSelectedIssueId = useCallback(
    (issueId: string | null) => {
      void navigate({
        to: "/projects/$projectId/issues" as never,
        params: { projectId } as never,
        search: (prev) =>
          buildCanonicalIssuesRouteSearch({
            epicId: prev.epicId,
            issueId,
            showClosed: prev.showClosed,
            sort: prev.sort,
          }) as never,
      });
    },
    [navigate, projectId],
  );

  const setShowClosed = useCallback(
    (nextShowClosed: boolean) => {
      void navigate({
        to: "/projects/$projectId/issues" as never,
        params: { projectId } as never,
        search: (prev) =>
          buildCanonicalIssuesRouteSearch({
            epicId: prev.epicId,
            issueId: prev.issueId,
            showClosed: nextShowClosed ? true : undefined,
            sort: prev.sort,
          }) as never,
        replace: true,
      });
    },
    [navigate, projectId],
  );

  const setSortBy = useCallback(
    (nextSortBy: BeadsIssueSortBy) => {
      void navigate({
        to: "/projects/$projectId/issues" as never,
        params: { projectId } as never,
        search: (prev) =>
          buildCanonicalIssuesRouteSearch({
            epicId: prev.epicId,
            issueId: prev.issueId,
            showClosed: prev.showClosed,
            sort: nextSortBy !== "updated" ? nextSortBy : undefined,
          }) as never,
        replace: true,
      });
    },
    [navigate, projectId],
  );

  const openThread = useCallback(
    (threadId: ThreadId) => {
      if (!project) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: project.environmentId, threadId },
      });
    },
    [navigate, project],
  );

  if (!project || !cwd) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <IssuesTab
          cwd={cwd}
          projectId={projectId}
          issues={issuesQuery.data?.issues ?? []}
          issuesPending={issuesQuery.isPending}
          issuesError={issuesQuery.error}
          showClosed={showClosed}
          sortBy={sortBy}
          selectedIssueId={search.issueId ?? null}
          onSelectIssue={setSelectedIssueId}
          onShowClosedChange={setShowClosed}
          onSortByChange={setSortBy}
          onOpenThread={openThread}
        />
      </div>
    </div>
  );
}
