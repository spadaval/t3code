import { DEFAULT_MODEL_BY_PROVIDER, type ModelSelection, type ThreadId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { ArrowLeftIcon, ArrowUpRightIcon, ExternalLinkIcon, PlayIcon, XIcon } from "lucide-react";

import { parseChatRouteSearch, stripRightPaneSearchParams } from "~/chatRouteSearch";
import { useComposerThreadDraft } from "~/composerDraftStore";
import {
  beadsIssueDetailOptions,
  beadsQueryIssuesOptions,
  beadsStartWorkflowMutationOptions,
} from "~/lib/beadsReactQuery";
import { listIssueLinkedThreads } from "~/issueThreads";
import { isEpicIssueType } from "~/issuePanel";
import { getIssuePaneState, useIssuePaneStore, type IssuePaneScope } from "~/issuePaneStore";
import { useStore } from "~/store";
import { useThreadProjectContext } from "~/threadProjectContext";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { IssueDetail } from "./issue/IssueDetail";
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

  const selectedIssueId = routeSearch.issueId ?? paneState.selectedIssueId;
  const initialLinkedIssueId = thread?.issueLink?.issueId ?? null;

  useEffect(() => {
    if (routeSearch.rightPane !== "issues") {
      return;
    }
    if (selectedIssueId !== null) {
      return;
    }
    if (initialLinkedIssueId === null) {
      return;
    }
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
      ? beadsIssueDetailOptions({
          cwd: project.cwd,
          issueId: selectedIssueId,
        })
      : beadsIssueDetailOptions(null),
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

  const startWorkflowMutation = useMutation(beadsStartWorkflowMutationOptions({ queryClient }));
  const startWork = useCallback(async () => {
    if (!project || !selectedIssueId) {
      return;
    }
    try {
      const result = await startWorkflowMutation.mutateAsync({
        cwd: project.cwd,
        projectId: project.id,
        issueId: selectedIssueId,
        workflow: "solve",
        modelSelection: resolveFallbackModelSelection(
          composerDraft.modelSelectionByProvider[composerDraft.activeProvider ?? "codex"] ??
            thread?.modelSelection ??
            project.defaultModelSelection,
        ),
        runtimeMode: composerDraft.runtimeMode ?? thread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      });

      if (!result.created) {
        toastManager.add({
          type: "info",
          title: "Reused linked thread",
          description: "An existing linked thread was reused for this issue.",
        });
      }

      void navigate({
        to: "/$threadId",
        params: { threadId: result.threadId },
        search: () => ({}),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to start work",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    }
  }, [
    composerDraft.activeProvider,
    composerDraft.modelSelectionByProvider,
    composerDraft.runtimeMode,
    navigate,
    project,
    selectedIssueId,
    startWorkflowMutation,
    thread?.modelSelection,
    thread?.runtimeMode,
  ]);

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
    setSelectedIssueId(threadId, null);
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => ({
        ...stripRightPaneSearchParams(previous),
        rightPane: "issues" as const,
      }),
    });
  }, [navigate, setSelectedIssueId, threadId]);

  const selectedIssue = selectedIssueDetailQuery.data ?? null;
  const startWorkDisabled =
    selectedIssue === null ||
    isEpicIssueType(selectedIssue.issueType) ||
    startWorkflowMutation.isPending;

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
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close issue sidebar"
          onClick={onClose}
          className="shrink-0"
        >
          <XIcon className="size-4" />
        </Button>
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

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="xs" variant="outline" onClick={openIssueInTracker}>
                  <ExternalLinkIcon className="size-3.5" />
                  Open in tracker
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={linkedThreads.length === 0}
                  onClick={openLinkedThread}
                >
                  <ArrowUpRightIcon className="size-3.5" />
                  {linkedThreads.length > 0
                    ? linkedThreads.length === 1
                      ? "Open linked thread"
                      : `Open linked thread (${linkedThreads.length})`
                    : "Open linked thread"}
                </Button>
                <Button size="xs" disabled={startWorkDisabled} onClick={() => void startWork()}>
                  <PlayIcon className="size-3.5" />
                  Start work
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {selectedIssueDetailQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading issue details...</p>
              ) : selectedIssueDetailQuery.error ? (
                <p className="text-sm text-destructive">{selectedIssueDetailQuery.error.message}</p>
              ) : selectedIssue ? (
                <IssueDetail
                  issue={selectedIssue}
                  showCompactSections
                  autoFocus
                  onClose={onBackToList}
                  onDependencyClick={onSelectIssue}
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
