import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, lazy, Suspense } from "react";

import { ProjectId } from "@t3tools/contracts";
import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import { parseIssuesRouteSearch } from "~/issuesRouteSearch";
import { useProjectById } from "~/storeSelectors";
import { isElectron } from "~/env";

const IssuesPageContent = lazy(() => import("~/components/issues-page/IssuesPageContent"));

function ProjectTrackerRouteView() {
  const projectId = Route.useParams({
    select: (params) => ProjectId.makeUnsafe(params.projectId),
  });
  const project = useProjectById(projectId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        window.history.back();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Tracker</div>
                <div className="truncate text-xs text-muted-foreground">
                  {project?.name ?? "Project"}
                </div>
              </div>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-4">
            <div className="min-w-0">
              <div className="text-xs font-medium tracking-wide text-foreground">Tracker</div>
              <div className="truncate text-[11px] text-muted-foreground/70">
                {project?.name ?? "Project"}
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex flex-1 flex-col">
          <Suspense>
            <IssuesPageContent projectId={projectId} />
          </Suspense>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/projects/$projectId/issues")({
  validateSearch: (search) => parseIssuesRouteSearch(search),
  beforeLoad: ({ search, params }) => {
    if (search.tab) {
      return;
    }
    throw redirect({
      to: "/projects/$projectId/issues",
      params,
      search: { ...search, tab: "coordinator" },
      replace: true,
    });
  },
  component: ProjectTrackerRouteView,
});
