import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { ActivityIcon, GitBranchIcon, LayoutListIcon } from "lucide-react";

import { useStore } from "~/store";
import {
  beadsContextOptions,
  beadsProjectCoordinatorSnapshotOptions,
  beadsQueryIssuesOptions,
  beadsSessionActivityOptions,
  beadsSwarmSupportOptions,
} from "~/lib/beadsReactQuery";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { CoordinatorTab } from "./CoordinatorTab";
import { IssuesTab } from "./IssuesTab";
import { ActivityTab } from "./ActivityTab";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: "coordinator" as const, label: "Coordinator", icon: GitBranchIcon },
  { id: "issues" as const, label: "Issues", icon: LayoutListIcon },
  { id: "activity" as const, label: "Activity", icon: ActivityIcon },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IssuesPageContent() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/issues/" });
  const activeTab = (search.tab ?? "coordinator") as TabId;

  // Resolve project context -- use the first project as a reasonable default.
  // In a multi-project setup this would need a project selector.
  const project = useStore((store) => store.projects[0] ?? null);
  const cwd = project?.cwd ?? null;
  const projectId = (project?.id ?? null) as ProjectId | null;

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
      enabled: cwd !== null && activeTab === "issues",
    }),
  );

  const activityQuery = useQuery(
    beadsSessionActivityOptions({
      cwd: cwd ?? "",
      enabled: cwd !== null && activeTab === "activity",
    }),
  );

  // Navigation helpers
  const setTab = useCallback(
    (tab: TabId) => {
      void navigate({
        to: "/issues",
        search: (prev) => ({
          tab,
          ...(prev.epicId ? { epicId: prev.epicId } : {}),
          ...(prev.issueId ? { issueId: prev.issueId } : {}),
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSelectedEpicId = useCallback(
    (epicId: string | null) => {
      void navigate({
        to: "/issues",
        search: (prev) => ({
          ...(prev.tab ? { tab: prev.tab } : {}),
          ...(epicId ? { epicId } : {}),
          ...(prev.issueId ? { issueId: prev.issueId } : {}),
        }),
      });
    },
    [navigate],
  );

  const setSelectedIssueId = useCallback(
    (issueId: string | null) => {
      void navigate({
        to: "/issues",
        search: (prev) => ({
          ...(prev.tab ? { tab: prev.tab } : {}),
          ...(prev.epicId ? { epicId: prev.epicId } : {}),
          ...(issueId ? { issueId } : {}),
        }),
      });
    },
    [navigate],
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
  const activityCount = activityQuery.data?.entries.length ?? null;

  if (!cwd) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          No project found. Create a thread to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-1.5">
        {TABS.map((tab) => {
          const count =
            tab.id === "coordinator" ? epicCount : tab.id === "issues" ? issueCount : activityCount;
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
            onOpenThread={openThread}
          />
        ) : activeTab === "issues" ? (
          <IssuesTab
            cwd={cwd}
            issues={issuesQuery.data?.issues ?? []}
            issuesPending={issuesQuery.isPending}
            issuesError={issuesQuery.error}
            selectedIssueId={search.issueId ?? null}
            onSelectIssue={setSelectedIssueId}
            onOpenThread={openThread}
          />
        ) : (
          <ActivityTab
            cwd={cwd}
            entries={activityQuery.data?.entries ?? []}
            entriesPending={activityQuery.isPending}
            entriesError={activityQuery.error}
            onSelectIssue={setSelectedIssueId}
            onOpenThread={openThread}
          />
        )}
      </div>
    </div>
  );
}
