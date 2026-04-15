import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import type { OrchestrationEpicRun, ProjectId } from "@t3tools/contracts";
import { RunView } from "~/components/RunView";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import {
  beadsEpicIssueSummariesOptions,
  beadsProjectRunSummaryOptions,
} from "~/lib/beadsReactQuery";
import {
  useEpicIssueExecutionsForRun,
  useEpicRunsForProject,
  useProjectById,
} from "~/storeSelectors";
import { isElectron } from "~/env";

function ProjectRunRouteView() {
  const { projectId, runId } = Route.useParams({
    select: (params) => ({
      projectId: (params as Record<string, string | undefined>).projectId as ProjectId,
      runId: ((params as Record<string, string | undefined>).runId ?? null) as
        | OrchestrationEpicRun["runId"]
        | null,
    }),
  });
  const project = useProjectById(projectId) ?? null;
  const runs = useEpicRunsForProject(projectId);
  const run = runs.find((candidate) => candidate.runId === runId) ?? null;
  const executions = useEpicIssueExecutionsForRun(runId);
  const cwd = project?.cwd ?? null;

  const projectRunSummaryQuery = useQuery(
    beadsProjectRunSummaryOptions(cwd ? { cwd, projectId } : null),
  );
  const issueSummariesQuery = useQuery(
    cwd && run
      ? beadsEpicIssueSummariesOptions({
          cwd,
          epicIssueId: run.epicIssueId,
        })
      : beadsEpicIssueSummariesOptions(null),
  );

  const issueTitlesById = Object.fromEntries(
    (issueSummariesQuery.data?.issues ?? []).map((issue) => [issue.id, issue.title] as const),
  );
  const runEpicTitle =
    projectRunSummaryQuery.data?.epics.find((epic) => epic.epicIssueId === run?.epicIssueId)
      ?.epicTitle ??
    run?.epicIssueId ??
    null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {run ? `Run ${run.runId}` : "Run"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {runEpicTitle ?? project?.name ?? "Project"}
                </div>
              </div>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-4">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-wide text-foreground">
                {run ? `Run ${run.runId}` : "Run"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground/70">
                {runEpicTitle ?? project?.name ?? "Project"}
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex flex-1 flex-col">
          <RunView
            run={run}
            executions={executions}
            issueTitlesById={issueTitlesById}
            activeThreadId={
              executions.find((execution) => execution.status === "running")?.workerThreadId
            }
          />
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/projects/$projectId/runs/$runId")({
  component: ProjectRunRouteView,
});
