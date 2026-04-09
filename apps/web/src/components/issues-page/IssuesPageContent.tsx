import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { GitBranchIcon, KanbanIcon, LayoutListIcon } from "lucide-react";

import {
  beadsContextOptions,
  beadsProjectCoordinatorSnapshotOptions,
  beadsQueryIssuesOptions,
  beadsSwarmSupportOptions,
} from "~/lib/beadsReactQuery";
import { parseIssuesRouteSearch } from "~/issuesRouteSearch";
import { cn } from "~/lib/utils";
import { useProjectById } from "~/storeSelectors";
import { Button } from "../ui/button";
import { CoordinatorTab } from "./CoordinatorTab";
import { IssuesTab } from "./IssuesTab";
import { KanbanBoard } from "./KanbanBoard";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: "coordinator" as const, label: "Coordinator", icon: GitBranchIcon },
  { id: "issues" as const, label: "Issues", icon: LayoutListIcon },
  { id: "board" as const, label: "Board", icon: KanbanIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IssuesPageContent({ projectId }: { projectId: ProjectId }) {
  const navigate = useNavigate();
  const search = useSearch({
    from: "/projects/$projectId/issues",
    select: (current) => parseIssuesRouteSearch(current),
  });
  const activeTab = (search.tab ?? "coordinator") as TabId;
  const project = useProjectById(projectId) ?? null;
  const cwd = project?.cwd ?? null;

  // Core data queries
  useQuery(beadsContextOptions(cwd ? { cwd } : null));

  const swarmSupportQuery = useQuery(beadsSwarmSupportOptions({ cwd, enabled: cwd !== null }));

  const coordinatorQuery = useQuery(
    beadsProjectCoordinatorSnapshotOptions(
      cwd && projectId ? { cwd, projectId, enabled: activeTab === "coordinator" } : null,
    ),
  );

  const issuesQuery = useQuery(
    beadsQueryIssuesOptions({
      cwd: cwd ?? "",
      sortBy: "updated",
      enabled: cwd !== null && (activeTab === "issues" || activeTab === "board"),
    }),
  );

  // Navigation helpers
  const setTab = useCallback(
    (tab: TabId) => {
      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId },
        search: (prev) => ({
          tab,
          ...(prev.epicId ? { epicId: prev.epicId } : {}),
          ...(prev.issueId ? { issueId: prev.issueId } : {}),
        }),
        replace: true,
      });
    },
    [navigate, projectId],
  );

  const setSelectedEpicId = useCallback(
    (epicId: string | null) => {
      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId },
        search: (prev) => ({
          ...(prev.tab ? { tab: prev.tab } : {}),
          ...(epicId ? { epicId } : {}),
          ...(prev.issueId ? { issueId: prev.issueId } : {}),
        }),
      });
    },
    [navigate, projectId],
  );

  const setSelectedIssueId = useCallback(
    (issueId: string | null) => {
      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId },
        search: (prev) => ({
          ...(prev.tab ? { tab: prev.tab } : {}),
          ...(prev.epicId ? { epicId: prev.epicId } : {}),
          ...(issueId ? { issueId } : {}),
        }),
      });
    },
    [navigate, projectId],
  );

  const openEpicIssue = useCallback(
    (epicId: string) => {
      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId },
        search: {
          tab: "issues",
          epicId,
          issueId: epicId,
        },
      });
    },
    [navigate, projectId],
  );

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({ to: "/$threadId", params: { threadId } });
    },
    [navigate],
  );

  // Issue counts for tab badge
  const issueCount = issuesQuery.data?.issues.length ?? null;
  const epicCount = coordinatorQuery.data?.epics.length ?? null;

  if (!project || !cwd) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-1.5">
        {TABS.map((tab) => {
          const count = tab.id === "coordinator" ? epicCount : issueCount;
          return (
            <Button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="xs"
              onClick={() => setTab(tab.id)}
              className={cn("gap-1.5", activeTab !== tab.id && "text-muted-foreground")}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
              {count !== null && count > 0 ? (
                <span
                  className={cn(
                    "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                    activeTab === tab.id
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1">
        {activeTab === "coordinator" ? (
          <CoordinatorTab
            cwd={cwd}
            projectId={projectId}
            swarmSupport={swarmSupportQuery.data ?? null}
            swarmSupportPending={swarmSupportQuery.isPending}
            swarmSupportError={swarmSupportQuery.error}
            snapshot={coordinatorQuery.data ?? null}
            snapshotPending={coordinatorQuery.isPending}
            snapshotError={coordinatorQuery.error}
            selectedEpicId={search.epicId ?? null}
            onSelectEpic={setSelectedEpicId}
            onOpenEpicIssue={openEpicIssue}
            onOpenThread={openThread}
          />
        ) : activeTab === "board" ? (
          <KanbanBoard
            cwd={cwd}
            projectId={projectId}
            issues={issuesQuery.data?.issues ?? []}
            loading={issuesQuery.isPending}
            error={issuesQuery.error}
            selectedIssueId={search.issueId ?? null}
            onSelectIssue={setSelectedIssueId}
            onOpenThread={openThread}
          />
        ) : (
          <IssuesTab
            cwd={cwd}
            projectId={projectId}
            issues={issuesQuery.data?.issues ?? []}
            issuesPending={issuesQuery.isPending}
            issuesError={issuesQuery.error}
            selectedIssueId={search.issueId ?? null}
            onSelectIssue={setSelectedIssueId}
            onOpenThread={openThread}
          />
        )}
      </div>
    </div>
  );
}
