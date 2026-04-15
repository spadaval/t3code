import { createFileRoute, redirect } from "@tanstack/react-router";

import { parseIssuesRouteSearch } from "~/issuesRouteSearch";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "~/store";
import { useUiStateStore } from "~/uiStateStore";

function resolveLegacyIssuesProjectId(): string | null {
  const state = useStore.getState();
  const projects = selectProjectsAcrossEnvironments(state);
  const threads = selectThreadsAcrossEnvironments(state);
  if (projects.length === 0) {
    return null;
  }

  const { threadLastVisitedAtById } = useUiStateStore.getState();
  let bestThreadProjectId: string | null = null;
  let bestVisitedAt = "";

  for (const thread of threads) {
    const visitedAt = threadLastVisitedAtById[thread.id] ?? "";
    if (visitedAt.length === 0 || visitedAt <= bestVisitedAt) {
      continue;
    }
    bestVisitedAt = visitedAt;
    bestThreadProjectId = thread.projectId;
  }

  return bestThreadProjectId ?? projects[0]?.id ?? null;
}

function LegacyIssuesRedirectFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
      No project is available for the tracker.
    </div>
  );
}

export const Route = createFileRoute("/issues")({
  validateSearch: (search) => parseIssuesRouteSearch(search),
  beforeLoad: ({ search }) => {
    const projectId = resolveLegacyIssuesProjectId();
    if (!projectId) {
      return;
    }

    throw redirect({
      to: "/projects/$projectId/issues" as never,
      params: { projectId } as never,
      search: {
        tab: search.tab ?? "issues",
        ...(search.epicId ? { epicId: search.epicId } : {}),
        ...(search.runId ? { runId: search.runId } : {}),
        ...(search.issueId ? { issueId: search.issueId } : {}),
      } as never,
      replace: true,
    });
  },
  component: LegacyIssuesRedirectFallback,
});
