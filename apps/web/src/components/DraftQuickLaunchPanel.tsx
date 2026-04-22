import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ThreadId,
  RuntimeMode,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, AlertTriangleIcon, Loader2Icon } from "lucide-react";
import { useCallback, useMemo, type MouseEvent } from "react";

import {
  ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
  beadsEpicCoordinationDetailOptions,
  beadsProjectRunSummaryOptions,
  beadsQueryIssuesOptions,
  beadsUpdateIssueMutationOptions,
} from "~/lib/beadsReactQuery";
import {
  deriveDraftQuickLaunchSections,
  type DraftQuickLaunchEpicRow,
  type DraftQuickLaunchStandaloneIssueRow,
} from "~/lib/draftQuickLaunch";
import { cn } from "~/lib/utils";
import { useIssueWorkflowLaunchers } from "./issue/IssueWorkflowActions";
import { type IssueContextAction, useIssueContextMenu } from "./issue/issueContextMenu";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { toastManager } from "./ui/toast";

type DraftQuickLaunchRow = DraftQuickLaunchEpicRow | DraftQuickLaunchStandaloneIssueRow;

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatWarningDetail(messages: readonly string[]): string {
  return messages.join(" | ");
}

function SkeletonRows() {
  return (
    <div className="space-y-4" data-testid="draft-quick-launch-loading">
      {["section-1", "section-2"].map((sectionKey) => (
        <div key={sectionKey} className="space-y-2">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="overflow-hidden rounded-xl border border-border/60">
            {["row-1", "row-2", "row-3"].map((rowKey) => (
              <div
                key={`${sectionKey}-${rowKey}`}
                className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3 last:border-b-0"
              >
                <div className="space-y-1.5">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex gap-2">
                  <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RowMeta(props: { row: DraftQuickLaunchRow }) {
  if (props.row.kind === "epic") {
    return (
      <>
        <span>{formatCountLabel(props.row.readyIssueCount, "ready", "ready")}</span>
        <span>{formatCountLabel(props.row.totalIssueCount, "issue")}</span>
        {props.row.activeWorkerCount > 0 ? (
          <span>{formatCountLabel(props.row.activeWorkerCount, "worker")}</span>
        ) : null}
      </>
    );
  }

  return <span>{props.row.status.replace(/_/g, " ")}</span>;
}

function QuickLaunchRow(props: {
  row: DraftQuickLaunchRow;
  onOpen: (row: DraftQuickLaunchRow) => void;
  onContextMenu: (row: DraftQuickLaunchRow, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`draft-quick-launch-row-${props.row.kind}-${props.row.id}`}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-border/60 border-b px-4 py-3 text-left transition-colors last:border-b-0",
        "hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none",
      )}
      onClick={() => props.onOpen(props.row)}
      onContextMenu={(event) => props.onContextMenu(props.row, event)}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm text-foreground">{props.row.title}</div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">{props.row.id}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
        <RowMeta row={props.row} />
      </div>
    </button>
  );
}

export function DraftQuickLaunchPanel(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  draftId: string;
  cwd: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectRunSummaryQuery = useQuery(
    beadsProjectRunSummaryOptions({
      cwd: props.cwd,
      projectId: props.projectId,
    }),
  );
  const issuesQuery = useQuery(
    beadsQueryIssuesOptions({
      cwd: props.cwd,
      mode: "all",
      sortBy: "updated",
      refetchIntervalMs: ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: "always",
    }),
  );
  const issuesById = useMemo(
    () => new Map((issuesQuery.data?.issues ?? []).map((issue) => [issue.id, issue] as const)),
    [issuesQuery.data?.issues],
  );
  const candidateEpicIds = useMemo(
    () => projectRunSummaryQuery.data?.epics.map((epic) => epic.epicIssueId) ?? [],
    [projectRunSummaryQuery.data?.epics],
  );
  const epicCoordinationDetailQueries = useQueries({
    queries: candidateEpicIds.map((epicIssueId) =>
      beadsEpicCoordinationDetailOptions({
        cwd: props.cwd,
        projectId: props.projectId,
        epicIssueId,
      }),
    ),
  });
  const epicCoordinationDetailById = useMemo(() => {
    const next = new Map<
      string,
      NonNullable<(typeof epicCoordinationDetailQueries)[number]["data"]>
    >();
    epicCoordinationDetailQueries.forEach((query, index) => {
      if (!query.data) {
        return;
      }
      next.set(candidateEpicIds[index]!, query.data);
    });
    return next;
  }, [candidateEpicIds, epicCoordinationDetailQueries]);
  const quickLaunch = useMemo(
    () =>
      deriveDraftQuickLaunchSections({
        projectRunSummary: projectRunSummaryQuery.data,
        issuesById,
        epicCoordinationDetailById,
      }),
    [epicCoordinationDetailById, issuesById, projectRunSummaryQuery.data],
  );
  const launchers = useIssueWorkflowLaunchers({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: props.modelSelection,
    runtimeMode: props.runtimeMode,
    onOpenThread: (threadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: props.environmentId,
          threadId,
        },
      });
    },
  });
  const closeIssueMutation = useMutation(beadsUpdateIssueMutationOptions({ queryClient }));

  const navigateToTracker = useCallback(
    (input?: { epicId?: string; issueId?: string }) => {
      void navigate({
        to: "/projects/$projectId/issues" as never,
        params: { projectId: props.projectId } as never,
        search: {
          tab: "issues",
          ...(input?.epicId ? { epicId: input.epicId } : {}),
          ...(input?.issueId ? { issueId: input.issueId } : {}),
        } as never,
      });
    },
    [navigate, props.projectId],
  );

  const rowById = useMemo(
    () =>
      new Map(
        [...quickLaunch.epicRows, ...quickLaunch.standaloneRows].map(
          (row) => [row.id, row] as const,
        ),
      ),
    [quickLaunch.epicRows, quickLaunch.standaloneRows],
  );

  const handleIssueContextAction = useCallback(
    async (issueId: string, action: IssueContextAction) => {
      const row = rowById.get(issueId);
      if (!row) {
        return;
      }

      switch (action) {
        case "implement":
          if (row.kind === "standalone") {
            await launchers.startIssueWorkflow(issueId, "solve");
          }
          return;
        case "refine":
          if (row.kind === "standalone") {
            await launchers.startIssueWorkflow(issueId, "refine");
          }
          return;
        case "quick_refine":
          if (row.kind === "epic") {
            await launchers.startEpicQuickRefine(issueId);
          }
          return;
        case "planned_refine":
          if (row.kind === "epic") {
            await launchers.startEpicPlannedRefine(issueId);
          }
          return;
        case "open_in_tracker":
          navigateToTracker(
            row.kind === "epic"
              ? { epicId: row.id, issueId: row.id }
              : {
                  issueId: row.id,
                },
          );
          return;
        case "mark_closed":
          try {
            await closeIssueMutation.mutateAsync({
              cwd: props.cwd,
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
    [closeIssueMutation, launchers, navigateToTracker, props.cwd, rowById],
  );
  const showIssueContextMenu = useIssueContextMenu(handleIssueContextAction);
  const warningMessages = useMemo(() => {
    const messages: string[] = [];
    if (projectRunSummaryQuery.error instanceof Error) {
      messages.push(projectRunSummaryQuery.error.message);
    } else if (projectRunSummaryQuery.error) {
      messages.push("Project run summary is unavailable.");
    }
    if (issuesQuery.error instanceof Error) {
      messages.push(issuesQuery.error.message);
    } else if (issuesQuery.error) {
      messages.push("Issue list is unavailable.");
    }
    epicCoordinationDetailQueries.forEach((query, index) => {
      if (!query.error) {
        return;
      }
      if (query.error instanceof Error) {
        messages.push(`Epic ${candidateEpicIds[index]}: ${query.error.message}`);
        return;
      }
      messages.push(`Epic ${candidateEpicIds[index]}: coordination detail is unavailable.`);
    });
    return [...new Set(messages)];
  }, [
    candidateEpicIds,
    epicCoordinationDetailQueries,
    issuesQuery.error,
    projectRunSummaryQuery.error,
  ]);
  const totalFailure =
    !projectRunSummaryQuery.data &&
    !issuesQuery.data &&
    warningMessages.length > 0 &&
    !projectRunSummaryQuery.isPending &&
    !issuesQuery.isPending;
  const epicQueriesPending = epicCoordinationDetailQueries.some((query) => query.isPending);
  const isLoading =
    projectRunSummaryQuery.isPending ||
    issuesQuery.isPending ||
    (candidateEpicIds.length > 0 &&
      epicQueriesPending &&
      quickLaunch.sections.length === 0 &&
      warningMessages.length === 0);

  const openRow = useCallback(
    (row: DraftQuickLaunchRow) => {
      navigateToTracker(
        row.kind === "epic"
          ? { epicId: row.id, issueId: row.id }
          : {
              issueId: row.id,
            },
      );
    },
    [navigateToTracker],
  );

  return (
    <div
      data-testid="draft-quick-launch-panel"
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 pb-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Ready now</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Start a ready epic or issue from the project backlog.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="draft-quick-launch-open-tracker"
          onClick={() => navigateToTracker()}
        >
          <ArrowUpRightIcon className="size-4" />
          Open Tracker
        </Button>
      </div>

      {warningMessages.length > 0 && !totalFailure ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-950 dark:text-amber-100">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div data-testid="draft-quick-launch-warning">{formatWarningDetail(warningMessages)}</div>
        </div>
      ) : null}

      {totalFailure ? (
        <div
          className="rounded-xl border border-border/60 bg-muted/10 px-4 py-4"
          data-testid="draft-quick-launch-error"
        >
          <div className="text-sm font-medium text-foreground">Unable to load ready work</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {formatWarningDetail(warningMessages)}
          </div>
          <div className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => navigateToTracker()}>
              <ArrowUpRightIcon className="size-4" />
              Open Tracker
            </Button>
          </div>
        </div>
      ) : isLoading ? (
        <SkeletonRows />
      ) : quickLaunch.sections.length === 0 ? (
        <div
          className="rounded-xl border border-border/60 bg-muted/10 px-4 py-5"
          data-testid="draft-quick-launch-empty"
        >
          <div className="text-sm font-medium text-foreground">Nothing ready right now</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Open the tracker to inspect blocked work, backlog state, or closed items.
          </div>
          <div className="mt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => navigateToTracker()}>
              <ArrowUpRightIcon className="size-4" />
              Open Tracker
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {quickLaunch.sections.map((section, sectionIndex) => (
            <section
              key={section.kind}
              data-testid={`draft-quick-launch-section-${section.kind}`}
              className="space-y-2.5"
            >
              {sectionIndex > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-sm text-foreground">{section.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {formatCountLabel(section.items.length, "item")}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-background/80">
                {section.items.map((row) => {
                  const issueSummary = issuesById.get(row.id);
                  return (
                    <QuickLaunchRow
                      key={`${row.kind}:${row.id}`}
                      row={row}
                      onOpen={openRow}
                      onContextMenu={(nextRow, event) =>
                        showIssueContextMenu(
                          {
                            id: nextRow.id,
                            title: nextRow.title,
                            status: issueSummary?.status ?? nextRow.status,
                            issueType: issueSummary?.issueType ?? nextRow.issueType,
                          },
                          event,
                        )
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {(launchers.startWorkflowMutation.isPending ||
        launchers.startEpicQuickRefineMutation.isPending ||
        launchers.startEpicPlannedRefineMutation.isPending ||
        closeIssueMutation.isPending) &&
      !totalFailure ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Updating ready work…
        </div>
      ) : null}
    </div>
  );
}
