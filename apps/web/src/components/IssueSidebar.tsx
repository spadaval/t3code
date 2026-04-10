import { DEFAULT_MODEL_BY_PROVIDER, type ModelSelection, type ThreadId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowLeftIcon, ListTodoIcon, XIcon } from "lucide-react";

import { parseChatRouteSearch, stripRightPaneSearchParams } from "~/chatRouteSearch";
import { useComposerThreadDraft } from "~/composerDraftStore";
import {
  beadsIssueGraphOptions,
  beadsQueryIssuesOptions,
  beadsUpdateIssueMutationOptions,
} from "~/lib/beadsReactQuery";
import { listIssueLinkedThreads } from "~/issueThreads";
import { getIssuePaneState, useIssuePaneStore, type IssuePaneScope } from "~/issuePaneStore";
import { useStore } from "~/store";
import { useThreadProjectContext } from "~/threadProjectContext";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { IssueDetail } from "./issue/IssueDetail";
import { IssueWorkflowActions, useIssueWorkflowLaunchers } from "./issue/IssueWorkflowActions";
import type { IssueContextAction } from "./issue/IssueList";
import { IssueListPanel } from "./issue/IssueListPanel";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { toastManager } from "./ui/toast";

const ACTIVE_STATUSES = ["open", "in_progress", "blocked", "deferred"] as const;
const ALL_STATUSES = [...ACTIVE_STATUSES, "closed"] as const;

function statusesForScope(scope: IssuePaneScope): string[] {
  if (scope === "closed") {
    return ["closed"];
  }
  if (scope === "all") {
    return [...ALL_STATUSES];
  }
  return [...ACTIVE_STATUSES];
}

function resolveFallbackModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ModelSelection {
  if (modelSelection) {
    return modelSelection;
  }
  return {
    provider: "codex",
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };
}

export function IssueSidebar({ threadId, onClose }: { threadId: ThreadId; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routeSearch = useSearch({
    strict: false,
    select: (search) => parseChatRouteSearch(search),
  });
  const { project, projectId, thread } = useThreadProjectContext(threadId);
  const composerDraft = useComposerThreadDraft(threadId);
  const threads = useStore((store) => store.threads);
  const paneState = useIssuePaneStore(
    (store) => store.byThreadId[threadId as string] ?? getIssuePaneState(threadId),
  );
  const setSelectedIssueId = useIssuePaneStore((store) => store.setSelectedIssueId);
  const setSearch = useIssuePaneStore((store) => store.setSearch);
  const setScope = useIssuePaneStore((store) => store.setScope);
  const hasBootstrappedLinkedIssueSelectionRef = useRef(false);

  const selectedIssueId = routeSearch.issueId ?? paneState.selectedIssueId;
  const initialLinkedIssueId = thread?.issueLink?.issueId ?? null;

  useEffect(() => {
    hasBootstrappedLinkedIssueSelectionRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (routeSearch.rightPane !== "issues") {
      hasBootstrappedLinkedIssueSelectionRef.current = false;
      return;
    }
    if (hasBootstrappedLinkedIssueSelectionRef.current) {
      return;
    }
    if (selectedIssueId !== null) {
      hasBootstrappedLinkedIssueSelectionRef.current = true;
      return;
    }
    if (initialLinkedIssueId === null) {
      return;
    }
    hasBootstrappedLinkedIssueSelectionRef.current = true;
    setSelectedIssueId(threadId, initialLinkedIssueId);
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => ({
        ...stripRightPaneSearchParams(previous),
        rightPane: "issues" as const,
        issueId: initialLinkedIssueId,
      }),
    });
  }, [
    initialLinkedIssueId,
    navigate,
    routeSearch.rightPane,
    selectedIssueId,
    setSelectedIssueId,
    threadId,
  ]);

  const issueListQuery = useQuery(
    beadsQueryIssuesOptions({
      cwd: project?.cwd ?? "",
      statuses: statusesForScope(paneState.scope),
      sortBy: "updated",
      enabled: project !== undefined,
    }),
  );

  const selectedIssueDetailQuery = useQuery(
    project && selectedIssueId
      ? beadsIssueGraphOptions({
          cwd: project.cwd,
          epicIssueId: selectedIssueId,
        })
      : beadsIssueGraphOptions(null),
  );

  const linkedThreads = useMemo(
    () =>
      listIssueLinkedThreads({
        threads,
        projectId,
        issueId: selectedIssueId,
      }),
    [projectId, selectedIssueId, threads],
  );

  const openLinkedThread = useCallback(() => {
    const targetThreadId = linkedThreads[0]?.id;
    if (!targetThreadId) {
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: targetThreadId },
      search: () => ({}),
    });
  }, [linkedThreads, navigate]);

  const openIssueInTracker = useCallback(() => {
    if (!project || !selectedIssueId) {
      return;
    }
    void navigate({
      to: "/projects/$projectId/issues",
      params: { projectId: project.id },
      search: {
        tab: "issues",
        issueId: selectedIssueId,
      },
    });
  }, [navigate, project, selectedIssueId]);

  const closeIssueMutation = useMutation(beadsUpdateIssueMutationOptions({ queryClient }));
  const resolvedModelSelection = useMemo(
    () =>
      resolveFallbackModelSelection(
        composerDraft.modelSelectionByProvider[composerDraft.activeProvider ?? "codex"] ??
          thread?.modelSelection ??
          project?.defaultModelSelection,
      ),
    [
      composerDraft.activeProvider,
      composerDraft.modelSelectionByProvider,
      project?.defaultModelSelection,
      thread?.modelSelection,
    ],
  );
  const resolvedRuntimeMode =
    composerDraft.runtimeMode ?? thread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const workflowLaunchers = useIssueWorkflowLaunchers(
    project
      ? {
          cwd: project.cwd,
          projectId: project.id,
          modelSelection: resolvedModelSelection,
          runtimeMode: resolvedRuntimeMode,
          onOpenThread: (nextThreadId) => {
            void navigate({
              to: "/$threadId",
              params: { threadId: nextThreadId },
              search: () => ({}),
            });
          },
        }
      : {
          cwd: "",
          projectId: "" as never,
          modelSelection: resolvedModelSelection,
          runtimeMode: resolvedRuntimeMode,
          onOpenThread: () => {},
        },
  );
  const startBacklogGrooming = useCallback(() => {
    void workflowLaunchers.startBacklogGrooming();
  }, [workflowLaunchers]);

  const onSelectIssue = useCallback(
    (issueId: string) => {
      setSelectedIssueId(threadId, issueId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
        replace: true,
        search: (previous) => ({
          ...stripRightPaneSearchParams(previous),
          rightPane: "issues" as const,
          issueId,
        }),
      });
    },
    [navigate, setSelectedIssueId, threadId],
  );

  const onBackToList = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => ({
        ...stripRightPaneSearchParams(previous),
        rightPane: "issues" as const,
      }),
    }).then(() => {
      setSelectedIssueId(threadId, null);
    });
  }, [navigate, setSelectedIssueId, threadId]);

  const selectedIssue = selectedIssueDetailQuery.data?.epic ?? null;
  const selectedIssueSubIssues = selectedIssueDetailQuery.data?.children ?? [];
  const openCoordinator = useCallback(
    (epicId: string) => {
      if (!project) {
        return;
      }

      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId: project.id },
        search: {
          tab: "coordinator",
          epicId,
        },
      });
    },
    [navigate, project],
  );
  const handleIssueContextAction = useCallback(
    async (issueId: string, action: IssueContextAction) => {
      if (!project) {
        return;
      }

      switch (action) {
        case "implement":
          await workflowLaunchers.startIssueWorkflow(issueId, "solve");
          return;
        case "refine":
          await workflowLaunchers.startIssueWorkflow(issueId, "refine");
          return;
        case "quick_refine":
          await workflowLaunchers.startEpicQuickRefine(issueId);
          return;
        case "planned_refine":
          await workflowLaunchers.startEpicPlannedRefine(issueId);
          return;
        case "open_in_tracker":
          void navigate({
            to: "/projects/$projectId/issues",
            params: { projectId: project.id },
            search: {
              tab: "issues",
              issueId,
            },
          });
          return;
        case "mark_closed":
          try {
            await closeIssueMutation.mutateAsync({
              cwd: project.cwd,
              issueId,
              status: "closed",
            });
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Failed to close issue",
              description: error instanceof Error ? error.message : "An unknown error occurred.",
            });
          }
          return;
        case "copy_id":
        case "copy_title":
          return;
      }
    },
    [closeIssueMutation, navigate, project, workflowLaunchers],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
            Issues
          </div>
          <div className="truncate text-sm font-medium text-foreground">
            {project?.name ?? "Project"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={startBacklogGrooming}
            disabled={!project || workflowLaunchers.startBacklogGroomingMutation.isPending}
          >
            <ListTodoIcon className="size-4" />
            {workflowLaunchers.startBacklogGroomingMutation.isPending
              ? "Starting..."
              : "Groom backlog"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close issue sidebar"
            onClick={onClose}
            className="shrink-0"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      {project ? (
        selectedIssueId ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBackToList}
                    className="-ml-2 gap-1.5 px-2"
                  >
                    <ArrowLeftIcon className="size-4" />
                    Back
                  </Button>
                  <div className="mt-2 min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {selectedIssue?.title ?? selectedIssueId}
                    </div>
                    <div className="text-xs text-muted-foreground">{selectedIssueId}</div>
                  </div>
                </div>
              </div>

              {selectedIssue ? (
                <div className="mt-3">
                  <IssueWorkflowActions
                    issue={selectedIssue}
                    cwd={project.cwd}
                    projectId={project.id}
                    modelSelection={resolvedModelSelection}
                    runtimeMode={resolvedRuntimeMode}
                    linkedThreadCount={linkedThreads.length}
                    linkedThreadLabel="Open linked thread"
                    launchers={workflowLaunchers}
                    onOpenLinkedThread={openLinkedThread}
                    onOpenInTracker={openIssueInTracker}
                    onOpenThread={(nextThreadId) => {
                      void navigate({
                        to: "/$threadId",
                        params: { threadId: nextThreadId },
                        search: () => ({}),
                      });
                    }}
                    onOpenCoordinator={openCoordinator}
                  />
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {selectedIssueDetailQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading issue details...</p>
              ) : selectedIssueDetailQuery.error ? (
                <p className="text-sm text-destructive">{selectedIssueDetailQuery.error.message}</p>
              ) : selectedIssue ? (
                <IssueDetail
                  issue={selectedIssue}
                  subIssues={selectedIssueSubIssues}
                  showCompactSections
                  autoFocus
                  onClose={onBackToList}
                  onDependencyClick={onSelectIssue}
                  onSubIssueClick={onSelectIssue}
                  className="pb-6"
                />
              ) : (
                <div className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
                  This issue could not be loaded.
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="min-h-0 flex-1">
            <IssueListPanel
              threadId={threadId}
              issues={issueListQuery.data?.issues ?? []}
              selectedIssueId={selectedIssueId}
              searchValue={paneState.search}
              scopeFilter={paneState.scope}
              loading={issueListQuery.isPending}
              error={issueListQuery.error?.message ?? null}
              onIssueSelect={onSelectIssue}
              onIssueContextAction={(issueId, action) =>
                void handleIssueContextAction(issueId, action)
              }
              onSearchChange={(value) => setSearch(threadId, value)}
              onScopeChange={(scope) => setScope(threadId, scope)}
              className="h-full"
            />
          </div>
        )
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          This thread is not attached to a project with tracker data.
        </div>
      )}

      <Separator />
    </div>
  );
}
