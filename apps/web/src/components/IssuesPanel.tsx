import type {
  AssistantDeliveryMode,
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorEpicStateKind,
  BeadsCoordinatorProjectConflict,
  BeadsIssueDetail,
  BeadsIssueSummary,
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  ModelSelection,
  OrchestrationStartSwarmRunInput,
  OrchestrationSwarmRun,
  ProjectId,
  ProviderKind,
  RuntimeMode,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { selectDeterministicReadyIssue } from "@t3tools/shared/swarm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BugIcon,
  CheckSquare2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  Clock3Icon,
  LightbulbIcon,
  LoaderIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  ScaleIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { useComposerThreadDraft, useEffectiveComposerModelState } from "~/composerDraftStore";
import { stripDiffSearchParams } from "~/diffRouteSearch";
import { useSettings } from "~/hooks/useSettings";
import {
  findLatestTrackerRefinementPlan,
  groupIssuesByEpic,
  isEpicIssueType,
  listEpicChildIssues,
  partitionCoordinatorEpics,
} from "~/issuePanel";
import { listIssueLinkedThreads } from "~/issueThreads";
import { getIssuePaneState, useIssuePaneStore, type IssuePaneScope } from "~/issuePaneStore";
import {
  beadsEpicCoordinatorSnapshotOptions,
  beadsQueryKeys,
  beadsIssueDetailOptions,
  beadsProjectCoordinatorSnapshotOptions,
  beadsQueryIssuesOptions,
  beadsStartEpicPlannedRefineMutationOptions,
  beadsStartEpicPlanImplementationMutationOptions,
  beadsStartEpicQuickRefineMutationOptions,
  beadsStartWorkflowMutationOptions,
} from "~/lib/beadsReactQuery";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { cn } from "~/lib/utils";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { formatShortTimestamp } from "~/timestampFormat";
import { getComposerProviderState } from "./chat/composerProviderRegistry";
import { threadHasStarted } from "./ChatView.logic";
import { useServerConfig } from "~/rpc/serverState";
import { useThreadById } from "~/storeSelectors";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "~/providerModels";

const ACTIVE_STATUSES = ["open", "in_progress", "blocked", "deferred"] as const;
type CoordinatorWorkflowAction =
  | "refine"
  | "quick_refine"
  | "planned_refine"
  | "plan_implementation"
  | "solve"
  | null;

function statusesForScope(scope: IssuePaneScope): string[] | undefined {
  if (scope === "all") {
    return undefined;
  }
  return scope === "closed" ? ["closed"] : [...ACTIVE_STATUSES];
}

type SemanticVariant = "success" | "warning" | "info" | "error" | "secondary";

function statusVariant(status: string): SemanticVariant {
  switch (status) {
    case "closed":
      return "success";
    case "in_progress":
    case "open":
      return "info";
    case "blocked":
      return "error";
    case "deferred":
      return "warning";
    default:
      return "secondary";
  }
}

function priorityVariant(priority: number | null): SemanticVariant {
  if (priority === null) return "secondary";
  if (priority <= 1) return "error";
  if (priority === 2) return "warning";
  return "secondary";
}

const SEMANTIC_TEXT_COLOR: Record<SemanticVariant, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  error: "text-destructive-foreground",
  secondary: "text-muted-foreground",
};

const ISSUE_TYPE_ICON_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  bug: { icon: BugIcon, className: "text-red-500" },
  feature: { icon: LightbulbIcon, className: "text-green-500" },
  task: { icon: CheckSquare2Icon, className: "text-blue-500" },
  epic: { icon: ZapIcon, className: "text-purple-500" },
  chore: { icon: WrenchIcon, className: "text-muted-foreground" },
  decision: { icon: ScaleIcon, className: "text-amber-500" },
};

const DEFAULT_ISSUE_TYPE_ICON = { icon: CircleDotIcon, className: "text-muted-foreground" };

function IssueTypeIcon(props: { issueType: string; className?: string }) {
  const config = ISSUE_TYPE_ICON_CONFIG[props.issueType.toLowerCase()] ?? DEFAULT_ISSUE_TYPE_ICON;
  const Icon = config.icon;
  return <Icon className={cn("size-4 shrink-0", config.className, props.className)} />;
}

function EpicGroupSection(props: {
  group: ReturnType<typeof groupIssuesByEpic>[number];
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const epicIssue = props.group.epicIssue;
  const childIssueCount = props.group.issues.length;

  // Ungrouped issues render without a header
  if (props.group.epicId === null) {
    return (
      <>
        {props.group.issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            selected={props.selectedIssueId === issue.id}
            timestampFormat={props.timestampFormat}
            onSelect={() => props.onSelectIssue(issue.id)}
          />
        ))}
      </>
    );
  }

  return (
    <div data-epic-group className="overflow-hidden">
      {epicIssue ? (
        <div
          data-epic-header
          className={cn(
            "flex items-stretch border-b border-border/70",
            props.selectedIssueId === epicIssue.id ? "bg-muted/55" : "bg-muted/15",
          )}
        >
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={`${collapsed ? "Expand" : "Collapse"} epic group ${props.group.epicTitle ?? props.group.epicId}`}
            className="flex shrink-0 items-center justify-center px-2 text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRightIcon className="size-3.5 shrink-0" />
            ) : (
              <ChevronDownIcon className="size-3.5 shrink-0" />
            )}
          </button>
          <button
            type="button"
            onClick={() => props.onSelectIssue(epicIssue.id)}
            aria-label={`Select issue ${epicIssue.id}: ${epicIssue.title}`}
            className="min-w-0 flex-1 px-4 py-2.5 text-left transition-colors hover:bg-muted/35"
          >
            <IssueRowContent issue={epicIssue} timestampFormat={props.timestampFormat} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={`${collapsed ? "Expand" : "Collapse"} epic group ${props.group.epicTitle ?? props.group.epicId}`}
          className="flex w-full items-center gap-1.5 bg-muted/30 px-4 py-1.5 text-left transition-colors hover:bg-muted/50"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <ZapIcon className="size-3.5 shrink-0 text-purple-500" />
          <span className="min-w-0 flex-1 truncate font-medium text-xs text-foreground/80">
            {props.group.epicTitle ?? props.group.epicId}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{childIssueCount}</span>
        </button>
      )}
      {!collapsed && props.group.issues.length > 0 ? (
        <div data-epic-children className="pl-4">
          {props.group.issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              selected={props.selectedIssueId === issue.id}
              timestampFormat={props.timestampFormat}
              onSelect={() => props.onSelectIssue(issue.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IssueRowContent(props: {
  issue: BeadsIssueSummary;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
}) {
  const statusClass = SEMANTIC_TEXT_COLOR[statusVariant(props.issue.status)];
  const priorityClass =
    props.issue.priority !== null
      ? SEMANTIC_TEXT_COLOR[priorityVariant(props.issue.priority)]
      : null;

  return (
    <>
      <div className="flex items-center gap-2">
        <IssueTypeIcon issueType={props.issue.issueType} />
        <p className="min-w-0 flex-1 truncate font-medium text-sm text-foreground">
          {props.issue.title}
        </p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatShortTimestamp(props.issue.updatedAt, props.timestampFormat)}
        </span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-1 pl-6 text-xs text-muted-foreground">
        <span>{props.issue.id}</span>
        <span className="opacity-40">·</span>
        <span className={statusClass}>{props.issue.status.replace(/_/g, " ")}</span>
        {priorityClass !== null ? (
          <>
            <span className="opacity-40">·</span>
            <span className={priorityClass}>P{props.issue.priority}</span>
          </>
        ) : null}
      </p>
    </>
  );
}

function IssueRow(props: {
  issue: BeadsIssueSummary;
  selected: boolean;
  onSelect: () => void;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-label={`Select issue ${props.issue.id}: ${props.issue.title}`}
      className={cn(
        "w-full border-b border-border/70 px-4 py-2.5 text-left transition-colors hover:bg-muted/35",
        props.selected ? "bg-muted/55" : "bg-transparent",
      )}
    >
      <IssueRowContent issue={props.issue} timestampFormat={props.timestampFormat} />
    </button>
  );
}

function IssueSummaryLine(props: {
  issue: Pick<BeadsIssueSummary, "id" | "title" | "issueType" | "status" | "priority">;
  onSelect?: (() => void) | undefined;
}) {
  const statusClass = SEMANTIC_TEXT_COLOR[statusVariant(props.issue.status)];
  const priorityClass =
    props.issue.priority !== null
      ? SEMANTIC_TEXT_COLOR[priorityVariant(props.issue.priority)]
      : null;
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <IssueTypeIcon issueType={props.issue.issueType} className="size-3.5" />
        <span className="truncate font-medium text-sm text-foreground">{props.issue.title}</span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-xs text-muted-foreground">
        <span>{props.issue.id}</span>
        <span className="opacity-40">·</span>
        <span className={statusClass}>{props.issue.status.replace(/_/g, " ")}</span>
        {priorityClass !== null ? (
          <>
            <span className="opacity-40">·</span>
            <span className={priorityClass}>P{props.issue.priority}</span>
          </>
        ) : null}
      </p>
    </>
  );

  if (!props.onSelect) {
    return <div className="rounded-lg border border-border/60 px-3 py-2">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={props.onSelect}
      className="w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/35"
    >
      {content}
    </button>
  );
}

type LinkedThreadSummary = {
  id: ThreadId;
  title: string;
  archivedAt: string | null;
  updatedAt?: string | undefined;
  createdAt: string;
};

type LatestPlannedRefineSummary = {
  threadId: ThreadId;
  threadTitle: string;
  planId: string;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
};

function LatestPlannedRefineSection(props: {
  latestPlannedRefine: LatestPlannedRefineSummary | null;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  onOpenLinkedThread: (threadId: ThreadId) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
        Latest planned refine
      </h3>
      {props.latestPlannedRefine ? (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="secondary">
              {props.latestPlannedRefine.threadTitle}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Updated{" "}
              {formatShortTimestamp(props.latestPlannedRefine.updatedAt, props.timestampFormat)}
            </span>
            {props.latestPlannedRefine.implementedAt ? (
              <Badge size="sm" variant="outline">
                Applied
              </Badge>
            ) : (
              <Badge size="sm" variant="success">
                Ready for apply flow
              </Badge>
            )}
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-foreground">
            {props.latestPlannedRefine.planMarkdown}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.onOpenLinkedThread(props.latestPlannedRefine!.threadId)}
            >
              Open planned refine thread
            </Button>
            <span className="text-xs text-muted-foreground">
              {props.latestPlannedRefine.planId}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tracker refinement plan yet. Use Planned refine to capture one and keep it linked here.
        </p>
      )}
    </section>
  );
}

function LinkedThreadsSection(props: {
  linkedThreads: ReadonlyArray<LinkedThreadSummary>;
  activeThreadId: ThreadId;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  onOpenLinkedThread: (threadId: ThreadId) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
        Linked threads ({props.linkedThreads.length})
      </h3>
      {props.linkedThreads.length > 0 ? (
        <div className="space-y-2">
          {props.linkedThreads.map((thread) => {
            const timestamp = formatShortTimestamp(
              thread.updatedAt ?? thread.createdAt,
              props.timestampFormat,
            );

            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => props.onOpenLinkedThread(thread.id)}
                className="w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/35"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-sm text-foreground">
                    {thread.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {thread.id === props.activeThreadId
                      ? "Current thread"
                      : thread.archivedAt === null
                        ? `Updated ${timestamp}`
                        : `Archived · updated ${timestamp}`}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground text-xs">{thread.id}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No linked threads yet. Launching a workflow keeps you here and adds the new thread to this
          list when orchestration state updates.
        </p>
      )}
    </section>
  );
}

type CoordinatorCardData = BeadsCoordinatorEpicSnapshot & {
  activeWorkerThreadTitle: string | null;
};

type CoordinatorStateView = {
  kind: BeadsCoordinatorEpicStateKind;
  latestRun: OrchestrationSwarmRun | null;
  fetchLifecycle: BeadsCoordinatorEpicSnapshot["fetchLifecycle"];
};

type StartSwarmDialogState = {
  epicId: string;
  epicTitle: string;
  validation: BeadsSwarmValidation | null;
  status: BeadsSwarmStatus | null;
};

function describeCoordinatorState(kind: BeadsCoordinatorEpicStateKind): {
  label: string;
  variant: "outline" | "warning" | "success" | "info" | "destructive" | "secondary";
  copy: string;
} {
  switch (kind) {
    case "no_swarm":
      return {
        label: "No swarm",
        variant: "outline",
        copy: "No swarm exists for this epic yet. Create one before implementation can be coordinated.",
      };
    case "needs_repair":
      return {
        label: "Needs repair",
        variant: "warning",
        copy: "This epic already has a swarm, but it needs repair before coordinated implementation can start.",
      };
    case "ready":
      return {
        label: "Ready",
        variant: "success",
        copy: "The epic swarm is valid and ready to start.",
      };
    case "running":
      return {
        label: "Running",
        variant: "info",
        copy: "A swarm run is active for this epic.",
      };
    case "idle":
      return {
        label: "Idle",
        variant: "warning",
        copy: "The current swarm run is idle and ready for the next issue.",
      };
    case "paused":
      return {
        label: "Paused",
        variant: "warning",
        copy: "The current swarm run is paused.",
      };
    case "blocked":
      return {
        label: "Blocked",
        variant: "destructive",
        copy: "The current swarm run is blocked and needs attention before it can continue.",
      };
    case "failed":
      return {
        label: "Failed",
        variant: "destructive",
        copy: "The latest swarm run failed due to a fatal coordinator or configuration problem.",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        variant: "secondary",
        copy: "The latest swarm run was cancelled.",
      };
    case "completed":
      return {
        label: "Completed",
        variant: "success",
        copy: "The latest swarm run completed.",
      };
    case "unsupported":
      return {
        label: "Unavailable",
        variant: "secondary",
        copy: "Swarm-backed implementation is unavailable for this backend.",
      };
    case "checking":
      return {
        label: "Checking",
        variant: "secondary",
        copy: "Checking swarm state...",
      };
    case "timeout":
      return {
        label: "Timed out",
        variant: "warning",
        copy: "Swarm state request timed out. Retry the request or inspect the backend error.",
      };
    case "stale":
      return {
        label: "Stale",
        variant: "warning",
        copy: "Showing the last known swarm state until the latest refresh succeeds.",
      };
    case "error":
      return {
        label: "Error",
        variant: "destructive",
        copy: "Swarm state could not be loaded. Retry the request or inspect the backend error.",
      };
  }
}

function isRecoverableWorkerFailureRun(run: OrchestrationSwarmRun | null): boolean {
  return run?.status === "blocked" && run.blockedContext?.kind === "worker_failure";
}

function selectRecoverableNextReadyIssue(input: {
  validation: BeadsSwarmValidation | null;
  status: BeadsSwarmStatus | null;
}): BeadsIssueRelationSummary | null {
  return selectDeterministicReadyIssue({
    validation: input.validation,
    status: input.status,
  });
}

function canRecoverableWorkerFailureRunContinue(input: {
  run: OrchestrationSwarmRun | null;
  validation: BeadsSwarmValidation | null;
  status: BeadsSwarmStatus | null;
}): boolean {
  if (!isRecoverableWorkerFailureRun(input.run)) {
    return false;
  }

  if (selectRecoverableNextReadyIssue(input) !== null) {
    return true;
  }

  return (
    input.status !== null && input.status.active.length === 0 && input.status.blocked.length === 0
  );
}

function formatSwarmSchedulerMode(mode: OrchestrationSwarmRun["schedulerMode"]): string {
  return mode === "semi-automatic" ? "Semi-automatic" : "Automatic";
}

function formatSwarmRunStatus(status: OrchestrationSwarmRun["status"]): string {
  const label = status === "requested" ? "Requested" : status.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatSharedWorkspaceProjectConflictMessage(
  conflict: BeadsCoordinatorProjectConflict,
): string {
  return conflict.message;
}

const SHARED_WORKSPACE_CONFLICT_ERROR_PATTERN =
  /Shared-workspace swarm execution is blocked by run '([^']+)' for epic '([^']+)' with status '([^']+)' in project '([^']+)'\.?/;

function describeSwarmActionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "An error occurred.";
  }

  const match = SHARED_WORKSPACE_CONFLICT_ERROR_PATTERN.exec(error.message);
  if (!match) {
    return error.message;
  }

  const [, runId, epicIssueId, status] = match;
  return `Shared workspace is already busy with ${epicIssueId} (${status}, ${runId}). Open the coordinator and pause, cancel, or finish that run before starting or resuming another shared-workspace run in this project.`;
}

function formatRuntimeMode(mode: RuntimeMode): string {
  return mode === "approval-required" ? "Supervised" : "Full access";
}

function formatAssistantDeliveryMode(mode: AssistantDeliveryMode): string {
  return mode === "streaming" ? "Streaming" : "Buffered";
}

function compareRunsNewestFirst(left: OrchestrationSwarmRun, right: OrchestrationSwarmRun): number {
  const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const requestedAtDelta = right.requestedAt.localeCompare(left.requestedAt);
  if (requestedAtDelta !== 0) {
    return requestedAtDelta;
  }

  return right.runId.localeCompare(left.runId);
}

function coordinatorCardStateRank(kind: CoordinatorCardData["stateKind"]): number {
  switch (kind) {
    case "error":
      return 0;
    case "timeout":
      return 1;
    case "stale":
      return 2;
    case "failed":
      return 3;
    case "blocked":
      return 4;
    case "paused":
      return 5;
    case "idle":
      return 6;
    case "needs_repair":
      return 7;
    case "no_swarm":
      return 8;
    case "ready":
      return 9;
    case "running":
      return 10;
    case "cancelled":
      return 11;
    case "completed":
      return 12;
    case "unsupported":
      return 13;
    case "checking":
      return 14;
  }
}

function compareCoordinatorCards(left: CoordinatorCardData, right: CoordinatorCardData): number {
  const rankDelta =
    coordinatorCardStateRank(left.stateKind) - coordinatorCardStateRank(right.stateKind);
  if (rankDelta !== 0) {
    return rankDelta;
  }

  const leftTimestamp = left.latestRun?.updatedAt ?? left.issue?.updatedAt ?? "";
  const rightTimestamp = right.latestRun?.updatedAt ?? right.issue?.updatedAt ?? "";
  const timestampDelta = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.epicTitle.localeCompare(right.epicTitle);
}

function buildCoordinatorRunTimeline(run: OrchestrationSwarmRun): ReadonlyArray<{
  label: string;
  timestamp: string;
  description: string | null;
}> {
  const entries = [
    { label: "Requested", timestamp: run.requestedAt, description: null },
    run.startedAt ? { label: "Started", timestamp: run.startedAt, description: null } : null,
    run.idledAt ? { label: "Idled", timestamp: run.idledAt, description: null } : null,
    run.pausedAt ? { label: "Paused", timestamp: run.pausedAt, description: null } : null,
    run.blockedAt
      ? { label: "Blocked", timestamp: run.blockedAt, description: run.lastError }
      : null,
    run.failedAt ? { label: "Failed", timestamp: run.failedAt, description: run.lastError } : null,
    run.cancelledAt
      ? { label: "Cancelled", timestamp: run.cancelledAt, description: run.lastError }
      : null,
    run.completedAt ? { label: "Completed", timestamp: run.completedAt, description: null } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return entries.toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function EpicSwarmStatusOverviewSection(props: {
  swarmSupport: BeadsSwarmSupport | null;
  swarmValidation: BeadsSwarmValidation | null;
  swarmStatus: BeadsSwarmStatus | null;
  coordinatorState: CoordinatorStateView;
  projectConflict: BeadsCoordinatorProjectConflict | null;
  swarmSupportPending: boolean;
  swarmValidationPending: boolean;
  swarmStatusPending: boolean;
  swarmSupportError: Error | null;
  swarmValidationError: Error | null;
  swarmStatusError: Error | null;
  refreshPending: boolean;
  onRefreshSwarmStatus: () => void;
  onOpenProjectConflict: (epicId: string) => void;
}) {
  const swarmSummary = props.swarmValidation?.swarm ?? props.swarmStatus?.swarm ?? null;
  const state = describeCoordinatorState(props.coordinatorState.kind);
  const projectConflictRun = props.projectConflict?.run ?? null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
          Swarm status
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.refreshPending}
          onClick={props.onRefreshSwarmStatus}
        >
          {props.refreshPending ? "Refreshing..." : "Refresh swarm status"}
        </Button>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
        {props.swarmSupportPending ? (
          <p className="text-sm text-muted-foreground">Loading swarm support...</p>
        ) : props.swarmSupportError ? (
          <p className="text-sm text-destructive">{props.swarmSupportError.message}</p>
        ) : props.swarmSupport?.supported === false ? (
          <div className="space-y-1.5">
            <p className="text-sm text-foreground">Swarm-backed implementation is unavailable.</p>
            {props.swarmSupport.reason ? (
              <p className="text-sm text-muted-foreground">{props.swarmSupport.reason}</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="success">
                Swarm supported
              </Badge>
              <Badge size="sm" variant={state.variant}>
                {state.label}
              </Badge>
              {swarmSummary ? (
                <Badge size="sm" variant="secondary">
                  {swarmSummary.swarmId}
                </Badge>
              ) : (
                <Badge size="sm" variant="outline">
                  No swarm yet
                </Badge>
              )}
            </div>
            <p className="text-sm text-foreground">{state.copy}</p>
            {props.coordinatorState.fetchLifecycle.detail ? (
              <p className="text-sm text-muted-foreground">
                {props.coordinatorState.fetchLifecycle.detail}
              </p>
            ) : null}

            {props.projectConflict && projectConflictRun ? (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                <p className="text-sm text-foreground">
                  {formatSharedWorkspaceProjectConflictMessage(props.projectConflict)}
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => props.onOpenProjectConflict(projectConflictRun.epicIssueId)}
                  >
                    Open active swarm
                  </Button>
                </div>
              </div>
            ) : null}

            {props.swarmValidationPending ? (
              <p className="text-sm text-muted-foreground">Validating epic swarm...</p>
            ) : props.swarmValidationError ? (
              <p className="text-sm text-destructive">{props.swarmValidationError.message}</p>
            ) : props.swarmValidation ? (
              <div className="space-y-1.5">
                <p className="text-sm text-foreground">
                  {props.swarmValidation.valid ? "Epic swarm is valid." : "Epic swarm is invalid."}
                </p>
                {props.swarmValidation.maxParallelism !== null ? (
                  <p className="text-sm text-muted-foreground">
                    Max parallelism: {props.swarmValidation.maxParallelism}
                  </p>
                ) : null}
                {props.swarmValidation.errors.length > 0 ? (
                  <p className="text-sm text-destructive">
                    {props.swarmValidation.errors.join(" ")}
                  </p>
                ) : null}
                {props.swarmValidation.warnings.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {props.swarmValidation.warnings.join(" ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {props.swarmStatusPending ? (
              <p className="text-sm text-muted-foreground">Loading swarm progress...</p>
            ) : props.swarmStatusError ? (
              <p className="text-sm text-destructive">{props.swarmStatusError.message}</p>
            ) : swarmSummary ? (
              <p className="text-sm text-muted-foreground">
                {swarmSummary.completedIssueCount}/{swarmSummary.totalIssueCount} completed ·{" "}
                {swarmSummary.activeIssueCount} active · {swarmSummary.readyIssueCount} ready ·{" "}
                {swarmSummary.blockedIssueCount} blocked · {swarmSummary.activeWorkerCount} workers
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function StartSwarmRunDialog(props: {
  open: boolean;
  dialogState: StartSwarmDialogState | null;
  providers: ReadonlyArray<ServerProvider>;
  defaultProvider: ProviderKind;
  defaultModel: string;
  defaultRuntimeMode: RuntimeMode;
  defaultAssistantDeliveryMode: AssistantDeliveryMode;
  isStarting: boolean;
  startDisabled: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (
    input: Pick<
      OrchestrationStartSwarmRunInput,
      "schedulerMode" | "provider" | "model" | "runtimeMode" | "assistantDeliveryMode"
    >,
  ) => void;
}) {
  const [schedulerMode, setSchedulerMode] =
    useState<OrchestrationStartSwarmRunInput["schedulerMode"]>("automatic");
  const [provider, setProvider] = useState<ProviderKind>(() =>
    resolveSelectableProvider(props.providers, props.defaultProvider),
  );
  const [model, setModel] = useState(props.defaultModel);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(props.defaultRuntimeMode);
  const [assistantDeliveryMode, setAssistantDeliveryMode] = useState<AssistantDeliveryMode>(
    props.defaultAssistantDeliveryMode,
  );
  const providerModels = getProviderModels(props.providers, provider);
  const validation = props.dialogState?.validation ?? null;
  const swarmSummary = validation?.swarm ?? props.dialogState?.status?.swarm ?? null;
  const readyCount = props.dialogState?.status?.ready.length ?? swarmSummary?.readyIssueCount ?? 0;

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const nextProvider = resolveSelectableProvider(props.providers, props.defaultProvider);
    setSchedulerMode("automatic");
    setProvider(nextProvider);
    setModel(props.defaultModel);
    setRuntimeMode(props.defaultRuntimeMode);
    setAssistantDeliveryMode(props.defaultAssistantDeliveryMode);
  }, [
    props.defaultAssistantDeliveryMode,
    props.defaultModel,
    props.defaultProvider,
    props.defaultRuntimeMode,
    props.open,
    props.dialogState?.epicId,
    props.providers,
  ]);

  useEffect(() => {
    if (!props.open || providerModels.length === 0) {
      return;
    }

    if (providerModels.some((candidate) => candidate.slug === model)) {
      return;
    }

    setModel(getDefaultServerModel(props.providers, provider));
  }, [model, props.open, props.providers, provider, providerModels]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start swarm</DialogTitle>
          <DialogDescription>
            {props.dialogState
              ? `${props.dialogState.epicId}: ${props.dialogState.epicTitle}`
              : "Select an epic to start a swarm run."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {props.dialogState ? (
            <>
              <div className="space-y-2 rounded-xl border border-border/60 bg-muted/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {swarmSummary ? (
                    <Badge size="sm" variant="secondary">
                      {swarmSummary.swarmId}
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="outline">
                      No swarm
                    </Badge>
                  )}
                  <Badge size="sm" variant="outline">
                    Shared workspace
                  </Badge>
                  <Badge size="sm" variant="outline">
                    {readyCount} ready
                  </Badge>
                </div>
                <p className="text-sm text-foreground">
                  Workers run sequentially in the shared project workspace for this MVP.
                </p>
                {validation ? (
                  <div className="space-y-1">
                    <p className="text-sm text-foreground">
                      {validation.valid ? "Validation passed." : "Validation failed."}
                    </p>
                    {validation.errors.length > 0 ? (
                      <p className="text-sm text-destructive">{validation.errors.join(" ")}</p>
                    ) : null}
                    {validation.warnings.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {validation.warnings.join(" ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Validation details are still loading for this swarm.
                  </p>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Scheduler mode</span>
                  <Select
                    value={schedulerMode}
                    onValueChange={(value) =>
                      value &&
                      setSchedulerMode(value as OrchestrationStartSwarmRunInput["schedulerMode"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="automatic">Automatic</SelectItem>
                      <SelectItem value="semi-automatic">Semi-automatic</SelectItem>
                    </SelectPopup>
                  </Select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Provider</span>
                  <Select
                    value={provider}
                    onValueChange={(value) => value && setProvider(value as ProviderKind)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {props.providers.map((providerEntry) => (
                        <SelectItem key={providerEntry.provider} value={providerEntry.provider}>
                          {providerEntry.provider}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Model</span>
                  {providerModels.length > 0 ? (
                    <Select value={model} onValueChange={(value) => value && setModel(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {providerModels.map((candidate) => (
                          <SelectItem key={candidate.slug} value={candidate.slug}>
                            {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : (
                    <Input value={model} onChange={(event) => setModel(event.target.value)} />
                  )}
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">Runtime mode</span>
                  <Select
                    value={runtimeMode}
                    onValueChange={(value) => value && setRuntimeMode(value as RuntimeMode)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="full-access">Full access</SelectItem>
                      <SelectItem value="approval-required">Supervised</SelectItem>
                    </SelectPopup>
                  </Select>
                </label>

                <label className="grid gap-1.5 md:col-span-2">
                  <span className="text-xs font-medium text-foreground">
                    Assistant delivery mode
                  </span>
                  <Select
                    value={assistantDeliveryMode}
                    onValueChange={(value) =>
                      value && setAssistantDeliveryMode(value as AssistantDeliveryMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="streaming">Streaming</SelectItem>
                      <SelectItem value="buffered">Buffered</SelectItem>
                    </SelectPopup>
                  </Select>
                </label>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Swarm details are unavailable.</p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isStarting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={props.startDisabled || props.isStarting || model.trim().length === 0}
            onClick={() =>
              props.onStart({
                schedulerMode,
                provider,
                model: model.trim(),
                runtimeMode,
                assistantDeliveryMode,
              })
            }
          >
            {props.isStarting ? "Starting..." : "Start swarm"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function CoordinatorEpicCard(props: {
  card: CoordinatorCardData;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  swarmActionKey: string | null;
  onOpenEpic: (epicId: string) => void;
  onSelectIssue: (issueId: string) => void;
  onOpenWorkerThread: (threadId: ThreadId) => void;
  onCreateSwarm: (epicId: string) => void;
  onRepairSwarm: (epicId: string) => void;
  onOpenStartSwarm: (card: CoordinatorCardData) => void;
  onContinueRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onRefreshSwarmStatus: (epicId: string) => void;
  onPauseRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onResumeRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onCancelRun: (runId: OrchestrationSwarmRun["runId"]) => void;
}) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const state = describeCoordinatorState(props.card.stateKind);
  const latestRun = props.card.latestRun;
  const projectConflict = props.card.projectConflict;
  const swarmSummary = props.card.swarmSummary;
  const readyPreviews = props.card.status?.ready.slice(0, 3) ?? [];
  const latestFailure = latestRun?.lastError ?? props.card.activeExecution?.lastError ?? null;
  const activeWorkerThreadId = props.card.activeExecution?.workerThreadId ?? null;
  const recoverableWorkerFailure = isRecoverableWorkerFailureRun(latestRun);
  const recoverableContinueEnabled = canRecoverableWorkerFailureRunContinue({
    run: latestRun,
    validation: props.card.validation,
    status: props.card.status,
  });
  const recoverableWorkerThreadId = latestRun?.blockedContext?.workerThreadId ?? null;
  const recoverableIssueId = latestRun?.blockedContext?.issueId ?? null;
  const startActionKey = `start:${props.card.epicId}`;
  const createActionKey = `create:${props.card.epicId}`;
  const repairActionKey = `repair:${props.card.epicId}`;
  const refreshActionKey = `refresh:${props.card.epicId}`;
  const continueActionKey = latestRun ? `continue:${latestRun.runId}` : null;
  const pauseActionKey = latestRun ? `pause:${latestRun.runId}` : null;
  const resumeActionKey = latestRun ? `resume:${latestRun.runId}` : null;
  const cancelActionKey = latestRun ? `cancel:${latestRun.runId}` : null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-sm text-foreground">{props.card.epicTitle}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{props.card.epicId}</span>
            <span className="opacity-40">·</span>
            <span>{swarmSummary?.swarmId ?? "No swarm"}</span>
            {latestRun ? (
              <>
                <span className="opacity-40">·</span>
                <span>{formatSwarmSchedulerMode(latestRun.schedulerMode)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" variant={state.variant}>
            {state.label}
          </Badge>
          {latestRun ? (
            <Badge size="sm" variant="outline">
              {formatSwarmRunStatus(latestRun.status)}
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-sm text-foreground">{state.copy}</p>
      {props.card.fetchLifecycle.detail ? (
        <p className="mt-1 text-sm text-muted-foreground">{props.card.fetchLifecycle.detail}</p>
      ) : null}

      {projectConflict ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium text-sm text-foreground">Shared workspace busy</p>
              <p className="text-sm text-muted-foreground">
                {formatSharedWorkspaceProjectConflictMessage(projectConflict)}
              </p>
            </div>
            <Badge size="sm" variant="outline">
              {projectConflict.run.epicIssueId}
            </Badge>
          </div>
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.onOpenEpic(projectConflict.run.epicIssueId)}
            >
              Open active swarm
            </Button>
          </div>
        </div>
      ) : null}

      {swarmSummary ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge size="sm" variant="secondary">
            {swarmSummary.completedIssueCount}/{swarmSummary.totalIssueCount} completed
          </Badge>
          <Badge size="sm" variant="outline">
            {swarmSummary.activeIssueCount} active
          </Badge>
          <Badge size="sm" variant="outline">
            {swarmSummary.readyIssueCount} ready
          </Badge>
          <Badge size="sm" variant="outline">
            {swarmSummary.blockedIssueCount} blocked
          </Badge>
          <Badge size="sm" variant="outline">
            {swarmSummary.activeWorkerCount} workers
          </Badge>
        </div>
      ) : null}

      {latestFailure ? (
        <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{latestFailure}</p>
        </div>
      ) : null}

      {latestRun ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge size="sm" variant="outline">
            {formatRuntimeMode(latestRun.runtimeMode)}
          </Badge>
          <Badge size="sm" variant="outline">
            {formatAssistantDeliveryMode(latestRun.assistantDeliveryMode ?? "buffered")}
          </Badge>
          <Badge size="sm" variant="outline">
            {latestRun.provider ?? "Default provider"}
          </Badge>
          <Badge size="sm" variant="outline">
            {latestRun.model ?? "Default model"}
          </Badge>
        </div>
      ) : null}

      {props.card.activeExecution ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/70 p-3">
          <p className="font-medium text-sm text-foreground">Active worker</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.card.activeExecution.issueId} · execution #
            {props.card.activeExecution.sequenceNumber}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Started{" "}
            {formatShortTimestamp(
              props.card.activeExecution.startedAt ?? props.card.activeExecution.requestedAt,
              props.timestampFormat,
            )}
          </p>
          {activeWorkerThreadId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="outline">
                {props.card.activeWorkerThreadTitle ?? activeWorkerThreadId}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => props.onOpenWorkerThread(activeWorkerThreadId)}
              >
                Open active worker
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {latestRun?.status === "idle" && latestRun.schedulerMode === "semi-automatic" ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-sm text-foreground">Ready for next issue</p>
              <p className="text-sm text-muted-foreground">
                Continue this shared-workspace run one issue at a time.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={props.swarmActionKey === continueActionKey}
              onClick={() => latestRun && props.onContinueRun(latestRun.runId)}
            >
              {props.swarmActionKey === continueActionKey ? "Continuing..." : "Continue"}
            </Button>
          </div>
          {readyPreviews.length > 0 ? (
            <div className="mt-3 space-y-2">
              {readyPreviews.map((issue) => (
                <IssueSummaryLine
                  key={issue.id}
                  issue={issue}
                  onSelect={() => props.onSelectIssue(issue.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {recoverableWorkerFailure && latestRun ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="font-medium text-sm text-foreground">Recoverable worker failure</p>
              <p className="text-sm text-muted-foreground">
                A worker stopped before the swarm could finish this issue. Resolve the tracker
                state, refresh, then continue the run.
              </p>
            </div>
            {recoverableIssueId ? (
              <Badge size="sm" variant="outline">
                {recoverableIssueId}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.swarmActionKey === refreshActionKey}
              onClick={() => props.onRefreshSwarmStatus(props.card.epicId)}
            >
              {props.swarmActionKey === refreshActionKey ? "Refreshing..." : "Refresh status"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={props.swarmActionKey === continueActionKey || !recoverableContinueEnabled}
              onClick={() => props.onContinueRun(latestRun.runId)}
            >
              {props.swarmActionKey === continueActionKey ? "Continuing..." : "Continue"}
            </Button>
            {recoverableWorkerThreadId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => props.onOpenWorkerThread(recoverableWorkerThreadId)}
              >
                Open failed worker
              </Button>
            ) : null}
          </div>
          {!recoverableContinueEnabled ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Close or otherwise unblock the failed issue in Beads, then refresh swarm status to
              continue.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {props.card.stateKind === "timeout" ||
        props.card.stateKind === "stale" ||
        props.card.stateKind === "error" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.swarmActionKey === refreshActionKey}
            onClick={() => props.onRefreshSwarmStatus(props.card.epicId)}
          >
            {props.swarmActionKey === refreshActionKey
              ? props.card.stateKind === "stale"
                ? "Refreshing..."
                : "Retrying..."
              : props.card.stateKind === "stale"
                ? "Refresh swarm status"
                : "Retry swarm status"}
          </Button>
        ) : null}
        {props.card.stateKind === "no_swarm" ? (
          <Button
            type="button"
            size="sm"
            disabled={props.swarmActionKey === createActionKey}
            onClick={() => props.onCreateSwarm(props.card.epicId)}
          >
            {props.swarmActionKey === createActionKey ? "Starting..." : "Create swarm"}
          </Button>
        ) : null}
        {props.card.stateKind === "needs_repair" ? (
          <Button
            type="button"
            size="sm"
            disabled={props.swarmActionKey === repairActionKey}
            onClick={() => props.onRepairSwarm(props.card.epicId)}
          >
            {props.swarmActionKey === repairActionKey ? "Starting..." : "Repair swarm"}
          </Button>
        ) : null}
        {props.card.stateKind === "ready" && !projectConflict ? (
          <Button
            type="button"
            size="sm"
            disabled={props.swarmActionKey === startActionKey}
            onClick={() => props.onOpenStartSwarm(props.card)}
          >
            {props.swarmActionKey === startActionKey ? "Starting..." : "Start swarm"}
          </Button>
        ) : null}
        {latestRun?.status === "running" && props.card.activeExecution === null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.swarmActionKey === pauseActionKey}
            onClick={() => props.onPauseRun(latestRun.runId)}
          >
            {props.swarmActionKey === pauseActionKey ? "Pausing..." : "Pause"}
          </Button>
        ) : null}
        {latestRun?.status === "paused" && !projectConflict ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.swarmActionKey === resumeActionKey}
            onClick={() => props.onResumeRun(latestRun.runId)}
          >
            {props.swarmActionKey === resumeActionKey ? "Resuming..." : "Resume"}
          </Button>
        ) : null}
        {latestRun &&
        latestRun.status !== "cancelled" &&
        latestRun.status !== "completed" &&
        latestRun.status !== "failed" ? (
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            disabled={props.swarmActionKey === cancelActionKey}
            onClick={() => props.onCancelRun(latestRun.runId)}
          >
            {props.swarmActionKey === cancelActionKey ? "Cancelling..." : "Cancel"}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => props.onOpenEpic(props.card.epicId)}
        >
          Open epic
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setHistoryExpanded((current) => !current)}
        >
          {historyExpanded ? "Hide history" : "View history"}
        </Button>
        {activeWorkerThreadId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onOpenWorkerThread(activeWorkerThreadId)}
          >
            Open active worker
          </Button>
        ) : null}
      </div>

      {historyExpanded ? (
        <div className="mt-4 space-y-3">
          {props.card.runs.length > 0 ? (
            props.card.runs.toSorted(compareRunsNewestFirst).map((run) => {
              const timeline = buildCoordinatorRunTimeline(run);
              const runExecutions = props.card.executions
                .filter((execution) => execution.runId === run.runId)
                .toSorted((left, right) => left.sequenceNumber - right.sequenceNumber);

              return (
                <div
                  key={run.runId}
                  className="rounded-lg border border-border/60 bg-background/70 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-sm text-foreground">{run.runId}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatSwarmRunStatus(run.status)}</span>
                        <span className="opacity-40">·</span>
                        <span>{formatSwarmSchedulerMode(run.schedulerMode)}</span>
                        <span className="opacity-40">·</span>
                        <span>
                          Requested {formatShortTimestamp(run.requestedAt, props.timestampFormat)}
                        </span>
                      </p>
                    </div>
                    <Badge
                      size="sm"
                      variant={
                        describeCoordinatorState(
                          run.status === "requested" ? "running" : run.status,
                        ).variant
                      }
                    >
                      {formatSwarmRunStatus(run.status)}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Timeline
                      </p>
                      {timeline.map((entry) => (
                        <div
                          key={`${run.runId}:${entry.label}:${entry.timestamp}`}
                          className="rounded-md border border-border/50 px-2.5 py-2"
                        >
                          <p className="text-sm text-foreground">{entry.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatShortTimestamp(entry.timestamp, props.timestampFormat)}
                          </p>
                          {entry.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {entry.description}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1.5">
                      <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Executions ({runExecutions.length})
                      </p>
                      {runExecutions.length > 0 ? (
                        runExecutions.map((execution) => (
                          <div
                            key={execution.executionId}
                            className="rounded-md border border-border/50 px-2.5 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-foreground">
                                {execution.issueId} · #{execution.sequenceNumber}
                              </p>
                              <Badge size="sm" variant="outline">
                                {execution.status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {execution.startedAt ? "Started " : "Requested "}
                              {formatShortTimestamp(
                                execution.startedAt ?? execution.requestedAt,
                                props.timestampFormat,
                              )}
                            </p>
                            {execution.workerThreadId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                onClick={() => props.onOpenWorkerThread(execution.workerThreadId!)}
                              >
                                Open worker thread
                              </Button>
                            ) : null}
                            {execution.lastError ? (
                              <p className="mt-2 text-xs text-destructive">{execution.lastError}</p>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No worker executions recorded.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No swarm runs recorded yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProjectCoordinatorContent(props: {
  swarmSupport: BeadsSwarmSupport | null;
  swarmSupportPending: boolean;
  swarmSupportError: Error | null;
  cards: ReadonlyArray<CoordinatorCardData>;
  cardsPending: boolean;
  cardsError: Error | null;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  swarmActionKey: string | null;
  onOpenEpic: (epicId: string) => void;
  onSelectIssue: (issueId: string) => void;
  onOpenWorkerThread: (threadId: ThreadId) => void;
  onCreateSwarm: (epicId: string) => void;
  onRepairSwarm: (epicId: string) => void;
  onOpenStartSwarm: (card: CoordinatorCardData) => void;
  onContinueRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onRefreshSwarmStatus: (epicId: string) => void;
  onPauseRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onResumeRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onCancelRun: (runId: OrchestrationSwarmRun["runId"]) => void;
}) {
  const sections = partitionCoordinatorEpics(props.cards.toSorted(compareCoordinatorCards));
  const totalCards =
    sections.needsAttention.length + sections.active.length + sections.history.length;

  return (
    <div
      role="tabpanel"
      aria-label="Coordinator"
      className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <p className="text-sm text-foreground">
          Track swarm state across the project and jump back into an epic without losing your
          current thread selection.
        </p>
      </div>

      {props.swarmSupportPending ? (
        <p className="text-sm text-muted-foreground">Loading swarm support...</p>
      ) : props.swarmSupportError ? (
        <p className="text-sm text-destructive">{props.swarmSupportError.message}</p>
      ) : props.swarmSupport?.supported === false ? (
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <p className="text-sm text-foreground">Coordinator is unavailable for this backend.</p>
          {props.swarmSupport.reason ? (
            <p className="mt-1 text-sm text-muted-foreground">{props.swarmSupport.reason}</p>
          ) : null}
        </div>
      ) : props.cardsPending ? (
        <p className="text-sm text-muted-foreground">Loading coordinator history...</p>
      ) : props.cardsError ? (
        <p className="text-sm text-destructive">{props.cardsError.message}</p>
      ) : totalCards === 0 ? (
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <p className="text-sm text-muted-foreground">No epics or swarm history were found.</p>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              Needs Attention ({sections.needsAttention.length})
            </h3>
            {sections.needsAttention.length > 0 ? (
              <div className="space-y-3">
                {sections.needsAttention.map((card) => (
                  <CoordinatorEpicCard
                    key={card.epicId}
                    card={card}
                    timestampFormat={props.timestampFormat}
                    swarmActionKey={props.swarmActionKey}
                    onOpenEpic={props.onOpenEpic}
                    onSelectIssue={props.onSelectIssue}
                    onOpenWorkerThread={props.onOpenWorkerThread}
                    onCreateSwarm={props.onCreateSwarm}
                    onRepairSwarm={props.onRepairSwarm}
                    onOpenStartSwarm={props.onOpenStartSwarm}
                    onContinueRun={props.onContinueRun}
                    onRefreshSwarmStatus={props.onRefreshSwarmStatus}
                    onPauseRun={props.onPauseRun}
                    onResumeRun={props.onResumeRun}
                    onCancelRun={props.onCancelRun}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              Active ({sections.active.length})
            </h3>
            {sections.active.length > 0 ? (
              <div className="space-y-3">
                {sections.active.map((card) => (
                  <CoordinatorEpicCard
                    key={card.epicId}
                    card={card}
                    timestampFormat={props.timestampFormat}
                    swarmActionKey={props.swarmActionKey}
                    onOpenEpic={props.onOpenEpic}
                    onSelectIssue={props.onSelectIssue}
                    onOpenWorkerThread={props.onOpenWorkerThread}
                    onCreateSwarm={props.onCreateSwarm}
                    onRepairSwarm={props.onRepairSwarm}
                    onOpenStartSwarm={props.onOpenStartSwarm}
                    onContinueRun={props.onContinueRun}
                    onRefreshSwarmStatus={props.onRefreshSwarmStatus}
                    onPauseRun={props.onPauseRun}
                    onResumeRun={props.onResumeRun}
                    onCancelRun={props.onCancelRun}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No swarm runs are currently active.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
              History ({sections.history.length})
            </h3>
            {sections.history.length > 0 ? (
              <div className="space-y-3">
                {sections.history.map((card) => (
                  <CoordinatorEpicCard
                    key={card.epicId}
                    card={card}
                    timestampFormat={props.timestampFormat}
                    swarmActionKey={props.swarmActionKey}
                    onOpenEpic={props.onOpenEpic}
                    onSelectIssue={props.onSelectIssue}
                    onOpenWorkerThread={props.onOpenWorkerThread}
                    onCreateSwarm={props.onCreateSwarm}
                    onRepairSwarm={props.onRepairSwarm}
                    onOpenStartSwarm={props.onOpenStartSwarm}
                    onContinueRun={props.onContinueRun}
                    onRefreshSwarmStatus={props.onRefreshSwarmStatus}
                    onPauseRun={props.onPauseRun}
                    onResumeRun={props.onResumeRun}
                    onCancelRun={props.onCancelRun}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed or cancelled swarm runs yet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function IssueOverviewContent(props: {
  issue: BeadsIssueDetail;
  childIssues: readonly BeadsIssueSummary[];
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  onSelectChildIssue: (issueId: string) => void;
  linkedThreads: ReadonlyArray<LinkedThreadSummary>;
  activeThreadId: ThreadId;
  onOpenLinkedThread: (threadId: ThreadId) => void;
  latestPlannedRefine: LatestPlannedRefineSummary | null;
  swarmSupport: BeadsSwarmSupport | null;
  swarmValidation: BeadsSwarmValidation | null;
  swarmStatus: BeadsSwarmStatus | null;
  coordinatorState: CoordinatorStateView;
  projectConflict: BeadsCoordinatorProjectConflict | null;
  swarmSupportPending: boolean;
  swarmValidationPending: boolean;
  swarmStatusPending: boolean;
  swarmSupportError: Error | null;
  swarmValidationError: Error | null;
  swarmStatusError: Error | null;
  swarmRefreshPending: boolean;
  onRefreshSwarmStatus: () => void;
  onOpenProjectConflict: (epicId: string) => void;
}) {
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const COLLAPSE_LIMIT = 3;

  useEffect(() => {
    setCommentsExpanded(false);
    setHistoryExpanded(false);
  }, [props.issue.id]);

  const metaFragments: { key: string; content: ReactNode }[] = [];
  if (props.issue.owner) {
    metaFragments.push({ key: "owner", content: `Owner: ${props.issue.owner}` });
  }
  if (props.issue.assignee) {
    metaFragments.push({ key: "assignee", content: `Assignee: ${props.issue.assignee}` });
  }
  metaFragments.push({
    key: "updated",
    content: `Updated ${formatShortTimestamp(props.issue.updatedAt, props.timestampFormat)}`,
  });
  metaFragments.push({
    key: "created",
    content: `Created ${formatShortTimestamp(props.issue.createdAt, props.timestampFormat)}`,
  });

  const visibleComments = commentsExpanded
    ? props.issue.comments
    : props.issue.comments.slice(0, COLLAPSE_LIMIT);
  const hiddenCommentCount = props.issue.comments.length - COLLAPSE_LIMIT;
  const visibleHistory = historyExpanded
    ? props.issue.history
    : props.issue.history.slice(0, COLLAPSE_LIMIT);
  const hiddenHistoryCount = props.issue.history.length - COLLAPSE_LIMIT;
  const showChildrenSection =
    isEpicIssueType(props.issue.issueType) || props.childIssues.length > 0;
  const showEpicSections = isEpicIssueType(props.issue.issueType);

  return (
    <div role="tabpanel" aria-label="Overview" className="space-y-4">
      {metaFragments.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {metaFragments.map((fragment, i) => (
            <span key={fragment.key} className="flex items-center gap-2">
              {i > 0 && <span className="opacity-40">·</span>}
              {fragment.content}
            </span>
          ))}
        </p>
      )}

      <div className="whitespace-pre-wrap text-sm text-foreground">
        {props.issue.description?.trim() || (
          <span className="text-muted-foreground">No description.</span>
        )}
      </div>

      {props.issue.notes?.trim() ? (
        <section className="space-y-1.5">
          <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Notes
          </h3>
          <div className="whitespace-pre-wrap text-sm text-foreground">{props.issue.notes}</div>
        </section>
      ) : null}

      {props.issue.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {props.issue.labels.map((label) => (
            <Badge key={label} size="sm" variant="outline">
              {label}
            </Badge>
          ))}
        </div>
      ) : null}

      {showEpicSections ? (
        <>
          <EpicSwarmStatusOverviewSection
            swarmSupport={props.swarmSupport}
            swarmValidation={props.swarmValidation}
            swarmStatus={props.swarmStatus}
            coordinatorState={props.coordinatorState}
            projectConflict={props.projectConflict}
            swarmSupportPending={props.swarmSupportPending}
            swarmValidationPending={props.swarmValidationPending}
            swarmStatusPending={props.swarmStatusPending}
            swarmSupportError={props.swarmSupportError}
            swarmValidationError={props.swarmValidationError}
            swarmStatusError={props.swarmStatusError}
            refreshPending={props.swarmRefreshPending}
            onRefreshSwarmStatus={props.onRefreshSwarmStatus}
            onOpenProjectConflict={props.onOpenProjectConflict}
          />
          <LatestPlannedRefineSection
            latestPlannedRefine={props.latestPlannedRefine}
            timestampFormat={props.timestampFormat}
            onOpenLinkedThread={props.onOpenLinkedThread}
          />
          <LinkedThreadsSection
            linkedThreads={props.linkedThreads}
            activeThreadId={props.activeThreadId}
            timestampFormat={props.timestampFormat}
            onOpenLinkedThread={props.onOpenLinkedThread}
          />
        </>
      ) : null}

      {(showEpicSections ||
        showChildrenSection ||
        props.issue.dependencies.length > 0 ||
        props.issue.comments.length > 0 ||
        props.issue.history.length > 0) && <hr className="border-border/50" />}

      {showChildrenSection ? (
        <section className="space-y-1.5">
          <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Children ({props.childIssues.length})
          </h3>
          {props.childIssues.length > 0 ? (
            <div className="space-y-2">
              {props.childIssues.map((childIssue) => (
                <IssueSummaryLine
                  key={childIssue.id}
                  issue={childIssue}
                  onSelect={() => props.onSelectChildIssue(childIssue.id)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No child issues yet.</p>
          )}
        </section>
      ) : null}

      {props.issue.dependencies.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Dependencies ({props.issue.dependencies.length})
          </h3>
          <div className="space-y-2">
            {props.issue.dependencies.map((dependency) => (
              <IssueSummaryLine
                key={`${dependency.id}:${dependency.dependencyType}`}
                issue={dependency}
              />
            ))}
          </div>
        </section>
      ) : null}

      {props.issue.comments.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Comments ({props.issue.comments.length})
          </h3>
          <div className="divide-y divide-border/40">
            {visibleComments.map((comment) => (
              <div key={comment.id} className="py-2 first:pt-0">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquareTextIcon className="size-3" />
                  <span className="font-medium">{comment.author ?? "Unknown"}</span>
                  <span className="opacity-40">·</span>
                  <span>{formatShortTimestamp(comment.createdAt, props.timestampFormat)}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{comment.text}</p>
              </div>
            ))}
          </div>
          {!commentsExpanded && hiddenCommentCount > 0 ? (
            <button
              type="button"
              onClick={() => setCommentsExpanded(true)}
              className="text-xs text-info-foreground hover:underline"
            >
              Show {hiddenCommentCount} more comment
              {hiddenCommentCount !== 1 ? "s" : ""}
            </button>
          ) : null}
        </section>
      ) : null}

      {props.issue.history.length > 0 ? (
        <section className="space-y-1.5">
          <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            History ({props.issue.history.length})
          </h3>
          <div className="space-y-0.5">
            {visibleHistory.map((entry) => (
              <p
                key={entry.commitHash}
                className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
              >
                <Clock3Icon className="size-3" />
                <span className="font-mono">{entry.commitHash.slice(0, 8)}</span>
                <span className="opacity-40">·</span>
                <span>{entry.committer ?? "Unknown"}</span>
                <span className="opacity-40">·</span>
                <span>{formatShortTimestamp(entry.commitDate, props.timestampFormat)}</span>
                <span className="opacity-40">-</span>
                <span className="text-foreground">{entry.title}</span>
              </p>
            ))}
          </div>
          {!historyExpanded && hiddenHistoryCount > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryExpanded(true)}
              className="text-xs text-info-foreground hover:underline"
            >
              Show {hiddenHistoryCount} more entr
              {hiddenHistoryCount !== 1 ? "ies" : "y"}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function IssueDetailDialog(props: {
  issue: BeadsIssueDetail | null;
  issueId: string | null;
  isPending: boolean;
  error: Error | null;
  swarmSupport: BeadsSwarmSupport | null;
  swarmValidation: BeadsSwarmValidation | null;
  swarmStatus: BeadsSwarmStatus | null;
  coordinatorState: CoordinatorStateView;
  projectConflict: BeadsCoordinatorProjectConflict | null;
  swarmSupportPending: boolean;
  swarmValidationPending: boolean;
  swarmStatusPending: boolean;
  swarmSupportError: Error | null;
  swarmValidationError: Error | null;
  swarmStatusError: Error | null;
  swarmRefreshPending: boolean;
  onRefreshSwarmStatus: () => void;
  onOpenProjectConflict: (epicId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timestampFormat: ReturnType<typeof useSettings>["timestampFormat"];
  childIssues: readonly BeadsIssueSummary[];
  onSelectChildIssue: (issueId: string) => void;
  linkedThreads: ReadonlyArray<{
    id: ThreadId;
    title: string;
    archivedAt: string | null;
    updatedAt?: string | undefined;
    createdAt: string;
  }>;
  activeThreadId: ThreadId;
  onOpenLinkedThread: (threadId: ThreadId) => void;
  onStartIssueRefine: () => void;
  onStartIssueImplement: () => void;
  onStartEpicQuickRefine: () => void;
  onStartEpicPlannedRefine: () => void;
  onTriggerEpicPrimaryAction: () => void;
  workflowActionsDisabled: boolean;
  workflowActionsBusy: boolean;
  activeWorkflow: CoordinatorWorkflowAction;
  epicPrimaryActionLabel: string;
  epicPrimaryActionDisabled: boolean;
  epicPrimaryActionBusy: boolean;
  epicPrimaryActionBusyLabel: string;
  latestPlannedRefine: {
    threadId: ThreadId;
    threadTitle: string;
    planId: string;
    planMarkdown: string;
    implementedAt: string | null;
    implementationThreadId: ThreadId | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}) {
  const issue = props.issue;
  const showBasicWorkflowActions = issue !== null && !isEpicIssueType(issue.issueType);
  const showEpicWorkflowActions = issue !== null && isEpicIssueType(issue.issueType);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{issue?.title ?? props.issueId ?? "Issue"}</DialogTitle>
          <DialogDescription>
            {issue ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <IssueTypeIcon issueType={issue.issueType} className="size-3.5" />
                  {issue.id}
                </span>
                <Badge size="sm" variant={statusVariant(issue.status)}>
                  {issue.status.replace(/_/g, " ")}
                </Badge>
                {issue.priority !== null ? (
                  <Badge size="sm" variant={priorityVariant(issue.priority)}>
                    P{issue.priority}
                  </Badge>
                ) : null}
              </span>
            ) : props.isPending ? (
              "Loading issue details..."
            ) : props.error ? (
              props.error.message
            ) : (
              "Issue details are unavailable."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {props.isPending ? (
            <p className="text-sm text-muted-foreground">Loading issue details...</p>
          ) : props.error ? (
            <p className="text-sm text-destructive">{props.error.message}</p>
          ) : issue ? (
            <IssueOverviewContent
              issue={issue}
              childIssues={props.childIssues}
              timestampFormat={props.timestampFormat}
              onSelectChildIssue={props.onSelectChildIssue}
              linkedThreads={props.linkedThreads}
              activeThreadId={props.activeThreadId}
              onOpenLinkedThread={props.onOpenLinkedThread}
              latestPlannedRefine={props.latestPlannedRefine}
              swarmSupport={props.swarmSupport}
              swarmValidation={props.swarmValidation}
              swarmStatus={props.swarmStatus}
              coordinatorState={props.coordinatorState}
              projectConflict={props.projectConflict}
              swarmSupportPending={props.swarmSupportPending}
              swarmValidationPending={props.swarmValidationPending}
              swarmStatusPending={props.swarmStatusPending}
              swarmSupportError={props.swarmSupportError}
              swarmValidationError={props.swarmValidationError}
              swarmStatusError={props.swarmStatusError}
              swarmRefreshPending={props.swarmRefreshPending}
              onRefreshSwarmStatus={props.onRefreshSwarmStatus}
              onOpenProjectConflict={props.onOpenProjectConflict}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Issue details are unavailable.</p>
          )}
        </DialogPanel>
        {issue ? (
          <DialogFooter>
            {showEpicWorkflowActions ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.workflowActionsDisabled}
                  onClick={props.onStartEpicQuickRefine}
                >
                  {props.workflowActionsBusy && props.activeWorkflow === "quick_refine"
                    ? "Starting..."
                    : "Quick refine"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.workflowActionsDisabled}
                  onClick={props.onStartEpicPlannedRefine}
                >
                  {props.workflowActionsBusy && props.activeWorkflow === "planned_refine"
                    ? "Starting..."
                    : "Planned refine"}
                </Button>
                <Button
                  type="button"
                  disabled={
                    props.workflowActionsDisabled ||
                    props.epicPrimaryActionDisabled ||
                    props.epicPrimaryActionBusy
                  }
                  onClick={props.onTriggerEpicPrimaryAction}
                >
                  {props.epicPrimaryActionBusy
                    ? props.epicPrimaryActionBusyLabel
                    : props.workflowActionsBusy &&
                        (props.activeWorkflow === "solve" ||
                          props.activeWorkflow === "plan_implementation")
                      ? "Starting..."
                      : props.epicPrimaryActionLabel}
                </Button>
              </>
            ) : showBasicWorkflowActions ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={props.workflowActionsDisabled}
                  onClick={props.onStartIssueRefine}
                >
                  {props.workflowActionsBusy && props.activeWorkflow === "refine"
                    ? "Starting..."
                    : "Refine"}
                </Button>
                <Button
                  type="button"
                  disabled={props.workflowActionsDisabled}
                  onClick={props.onStartIssueImplement}
                >
                  {props.workflowActionsBusy && props.activeWorkflow === "solve"
                    ? "Starting..."
                    : "Implement"}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

interface IssuesPanelProps {
  activeThreadId: ThreadId;
  cwd: string | null;
  projectId: ProjectId | null;
  projectDefaultModelSelection: ModelSelection | null;
  onClose: () => void;
}

export function IssuesPanel({
  activeThreadId,
  cwd,
  projectId,
  projectDefaultModelSelection,
  onClose,
}: IssuesPanelProps) {
  const settings = useSettings();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const serverConfig = useServerConfig();
  const providerStatuses = serverConfig?.providers ?? [];
  const serverThread = useThreadById(activeThreadId);
  const composerDraft = useComposerThreadDraft(activeThreadId);
  const state = useIssuePaneStore(
    (store) => store.byThreadId[activeThreadId as string] ?? getIssuePaneState(activeThreadId),
  );
  const setActivePanelTab = useIssuePaneStore((store) => store.setActivePanelTab);
  const setSelectedIssueId = useIssuePaneStore((store) => store.setSelectedIssueId);
  const setSearch = useIssuePaneStore((store) => store.setSearch);
  const setScope = useIssuePaneStore((store) => store.setScope);
  const [activeWorkflow, setActiveWorkflow] = useState<CoordinatorWorkflowAction>(null);
  const [swarmActionKey, setSwarmActionKey] = useState<string | null>(null);
  const [startSwarmDialogState, setStartSwarmDialogState] = useState<StartSwarmDialogState | null>(
    null,
  );
  const startIssueWorkflowMutation = useMutation(
    beadsStartWorkflowMutationOptions({ queryClient }),
  );
  const startEpicQuickRefineMutation = useMutation(
    beadsStartEpicQuickRefineMutationOptions({ queryClient }),
  );
  const startEpicPlannedRefineMutation = useMutation(
    beadsStartEpicPlannedRefineMutationOptions({ queryClient }),
  );
  const startEpicPlanImplementationMutation = useMutation(
    beadsStartEpicPlanImplementationMutationOptions({ queryClient }),
  );
  const [debouncedSearch] = useDebouncedValue(state.search, { wait: 250 });
  const sessionProvider = serverThread?.session?.provider ?? null;
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    serverThread?.modelSelection.provider ?? projectDefaultModelSelection?.provider ?? null;
  const lockedProvider: ProviderKind | null = threadHasStarted(serverThread)
    ? (sessionProvider ?? threadProvider ?? selectedProviderByThreadId ?? null)
    : null;
  const unlockedSelectedProvider = resolveSelectableProvider(
    providerStatuses,
    selectedProviderByThreadId ?? threadProvider ?? "codex",
  );
  const selectedProvider: ProviderKind = lockedProvider ?? unlockedSelectedProvider;
  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId: activeThreadId,
    providers: providerStatuses,
    selectedProvider,
    threadModelSelection: serverThread?.modelSelection,
    projectModelSelection: projectDefaultModelSelection,
    settings,
  });
  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider);
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        prompt: composerDraft.prompt,
        modelOptions: composerModelOptions,
      }),
    [
      composerDraft.prompt,
      composerModelOptions,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
    ],
  );
  const selectedModelSelection = useMemo<ModelSelection>(
    () => ({
      provider: selectedProvider,
      model: selectedModel,
      ...(composerProviderState.modelOptionsForDispatch
        ? { options: composerProviderState.modelOptionsForDispatch }
        : {}),
    }),
    [composerProviderState.modelOptionsForDispatch, selectedModel, selectedProvider],
  );
  const runtimeMode =
    composerDraft.runtimeMode ?? serverThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const assistantDeliveryMode: AssistantDeliveryMode = settings.enableAssistantStreaming
    ? "streaming"
    : "buffered";
  const threads = useStore((store) => store.threads);
  const selectedIssueDetailQuery = useQuery(
    cwd && state.selectedIssueId
      ? beadsIssueDetailOptions({
          cwd,
          issueId: state.selectedIssueId,
        })
      : beadsIssueDetailOptions(null),
  );
  const issueListQuery = useQuery(
    beadsQueryIssuesOptions({
      cwd: cwd ?? "",
      search: debouncedSearch.trim().length > 0 ? debouncedSearch.trim() : undefined,
      statuses: statusesForScope(state.scope),
      sortBy: "updated",
      enabled: Boolean(cwd),
    }),
  );
  const refreshIssues = () => {
    void issueListQuery.refetch();
  };
  const closeSelectedIssue = () => setSelectedIssueId(activeThreadId, null);
  const handleClosePane = () => {
    closeSelectedIssue();
    onClose();
  };
  const workflowActionsDisabled =
    cwd === null ||
    projectId === null ||
    state.selectedIssueId === null ||
    startIssueWorkflowMutation.isPending ||
    startEpicQuickRefineMutation.isPending ||
    startEpicPlannedRefineMutation.isPending ||
    startEpicPlanImplementationMutation.isPending;
  const linkedThreads = useMemo(
    () =>
      listIssueLinkedThreads({
        threads,
        projectId,
        issueId: state.selectedIssueId,
      }),
    [projectId, state.selectedIssueId, threads],
  );
  const epicGroups = useMemo(
    () => (issueListQuery.data ? groupIssuesByEpic(issueListQuery.data.issues) : []),
    [issueListQuery.data],
  );
  const epicIssueGroups = useMemo(
    () => epicGroups.filter((group) => group.epicId !== null),
    [epicGroups],
  );
  const otherIssueGroups = useMemo(
    () => epicGroups.filter((group) => group.epicId === null),
    [epicGroups],
  );
  const childIssues = useMemo(
    () =>
      listEpicChildIssues({
        issues: issueListQuery.data?.issues ?? [],
        epicId: selectedIssueDetailQuery.data?.id ?? null,
      }),
    [issueListQuery.data?.issues, selectedIssueDetailQuery.data?.id],
  );
  const selectedIssueIsEpic = isEpicIssueType(selectedIssueDetailQuery.data?.issueType ?? null);
  const selectedEpicIssueId = selectedIssueIsEpic ? state.selectedIssueId : null;
  const latestPlannedRefine = useMemo(
    () =>
      findLatestTrackerRefinementPlan({
        threads,
        projectId,
        issueId: selectedEpicIssueId,
      }),
    [projectId, selectedEpicIssueId, threads],
  );
  const epicCoordinatorSnapshotQuery = useQuery(
    selectedIssueIsEpic && cwd && projectId && selectedEpicIssueId
      ? beadsEpicCoordinatorSnapshotOptions({
          cwd,
          projectId,
          epicIssueId: selectedEpicIssueId,
        })
      : beadsEpicCoordinatorSnapshotOptions(null),
  );
  const projectCoordinatorSnapshotQuery = useQuery(
    cwd && projectId && state.activePanelTab === "coordinator"
      ? beadsProjectCoordinatorSnapshotOptions({
          cwd,
          projectId,
        })
      : beadsProjectCoordinatorSnapshotOptions(null),
  );
  const threadTitlesById = useMemo(() => {
    return new Map(threads.map((thread) => [thread.id, thread.title] as const));
  }, [threads]);
  const coordinatorCards = useMemo<CoordinatorCardData[]>(() => {
    return (projectCoordinatorSnapshotQuery.data?.epics ?? []).map((card) => {
      const activeWorkerThreadTitle =
        card.activeExecution?.workerThreadId !== null &&
        card.activeExecution?.workerThreadId !== undefined
          ? (threadTitlesById.get(card.activeExecution.workerThreadId) ?? null)
          : null;

      return Object.assign({}, card, {
        activeWorkerThreadTitle,
      });
    });
  }, [projectCoordinatorSnapshotQuery.data?.epics, threadTitlesById]);
  const selectedEpicCoordinatorSnapshot = selectedIssueIsEpic
    ? (epicCoordinatorSnapshotQuery.data?.epic ?? null)
    : null;
  const epicCoordinatorState: CoordinatorStateView = selectedEpicCoordinatorSnapshot
    ? {
        kind: selectedEpicCoordinatorSnapshot.stateKind,
        latestRun: selectedEpicCoordinatorSnapshot.latestRun,
        fetchLifecycle: selectedEpicCoordinatorSnapshot.fetchLifecycle,
      }
    : {
        kind: "checking",
        latestRun: null,
        fetchLifecycle: { kind: "loading", detail: null },
      };
  const epicPrimaryAction = selectedEpicCoordinatorSnapshot?.primaryAction ?? {
    kind: "checking",
    label: "Checking swarm...",
    busyLabel: "Checking...",
    disabled: true,
  };
  const epicPrimaryActionBusy =
    selectedIssueIsEpic &&
    ((epicPrimaryAction.kind === "continue_swarm" && epicCoordinatorState.latestRun !== null
      ? swarmActionKey === `continue:${epicCoordinatorState.latestRun.runId}`
      : false) ||
      ((epicPrimaryAction.kind === "refresh_swarm_state" ||
        epicPrimaryAction.kind === "checking") &&
        selectedEpicIssueId !== null &&
        swarmActionKey === `refresh:${selectedEpicIssueId}`));
  const openLinkedThread = async (threadId: ThreadId) => {
    closeSelectedIssue();
    await navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => stripDiffSearchParams(previous),
    });
  };
  const runIssueWorkflow = async (workflow: "refine" | "solve") => {
    if (!cwd || !projectId || !state.selectedIssueId) {
      return;
    }

    setActiveWorkflow(workflow);
    try {
      const selectedIssueType = selectedIssueDetailQuery.data?.issueType ?? null;
      const result = await startIssueWorkflowMutation.mutateAsync({
        cwd,
        projectId,
        issueId: state.selectedIssueId,
        workflow,
        modelSelection: selectedModelSelection,
        runtimeMode,
      });

      if (isEpicIssueType(selectedIssueType)) {
        toastManager.add({
          type: "success",
          title: workflow === "refine" ? "Refine thread started" : "Implementation thread started",
          description:
            "The new thread was created and linked to this epic. Open it from Linked threads when you want to switch context.",
        });
      } else {
        closeSelectedIssue();
        await navigate({
          to: "/$threadId",
          params: { threadId: result.threadId },
          search: (previous) => stripDiffSearchParams(previous),
        });
      }
      if (!result.created) {
        toastManager.add({
          type: "info",
          title: "Reused linked thread",
          description: "An existing linked thread was reused for this workflow.",
        });
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Workflow failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setActiveWorkflow(null);
    }
  };

  const startEpicRefine = async (workflow: "quick_refine" | "planned_refine") => {
    if (!cwd || !projectId || !selectedEpicIssueId) {
      return;
    }

    setActiveWorkflow(workflow);
    try {
      const mutation =
        workflow === "quick_refine" ? startEpicQuickRefineMutation : startEpicPlannedRefineMutation;
      await mutation.mutateAsync({
        cwd,
        projectId,
        epicIssueId: selectedEpicIssueId,
        modelSelection: selectedModelSelection,
        runtimeMode,
      });
      toastManager.add({
        type: "success",
        title: workflow === "quick_refine" ? "Quick refine started" : "Planned refine started",
        description:
          "The new thread was created and linked to this epic. Open it from Linked threads when you want to switch context.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Workflow failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setActiveWorkflow(null);
    }
  };

  const openCoordinator = () => {
    closeSelectedIssue();
    setActivePanelTab(activeThreadId, "coordinator");
  };

  const openCoordinatorIssue = (issueId: string) => {
    setSelectedIssueId(activeThreadId, issueId);
    setActivePanelTab(activeThreadId, "issues");
  };

  const invalidateCoordinatorQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
  };

  const refreshEpicSwarmStatus = async (epicIssueId: string) => {
    if (!cwd) {
      return;
    }

    const actionKey = `refresh:${epicIssueId}`;
    setSwarmActionKey(actionKey);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: beadsQueryKeys.swarmSupport(cwd),
        }),
        queryClient.invalidateQueries({
          queryKey: beadsQueryKeys.epicSwarmValidation(cwd, epicIssueId),
        }),
        queryClient.invalidateQueries({
          queryKey: beadsQueryKeys.epicSwarmStatus(cwd, epicIssueId),
        }),
        queryClient.invalidateQueries({
          queryKey: beadsQueryKeys.issue(cwd, epicIssueId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["beads", "issues", cwd],
        }),
        queryClient.invalidateQueries({
          queryKey: beadsQueryKeys.swarms({ cwd }),
        }),
      ]);
      toastManager.add({
        type: "success",
        title: "Swarm status refreshed",
        description: `Reloaded tracker state for ${epicIssueId}.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Refresh failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setSwarmActionKey((current) => (current === actionKey ? null : current));
    }
  };

  const openStartSwarmDialog = (input: {
    epicId: string;
    epicTitle: string;
    validation: BeadsSwarmValidation | null;
    status: BeadsSwarmStatus | null;
  }) => {
    setStartSwarmDialogState({
      epicId: input.epicId,
      epicTitle: input.epicTitle,
      validation: input.validation,
      status: input.status,
    });
  };

  const startEpicPlanImplementation = async (input: {
    epicIssueId: string;
    actionKind: "create_swarm" | "repair_swarm";
  }) => {
    if (!cwd || !projectId) {
      return;
    }

    const actionKey = `${input.actionKind === "create_swarm" ? "create" : "repair"}:${input.epicIssueId}`;
    setActiveWorkflow("plan_implementation");
    setSwarmActionKey(actionKey);
    try {
      await startEpicPlanImplementationMutation.mutateAsync({
        cwd,
        projectId,
        epicIssueId: input.epicIssueId,
        modelSelection: selectedModelSelection,
        runtimeMode,
      });
      await invalidateCoordinatorQueries();
      toastManager.add({
        type: "success",
        title:
          input.actionKind === "create_swarm" ? "Swarm creation started" : "Swarm repair started",
        description:
          input.actionKind === "create_swarm"
            ? "A tracker-only thread was created to create the missing epic swarm and linked to this epic."
            : "A tracker-only thread was created to repair the existing epic swarm and linked to this epic.",
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Workflow failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setActiveWorkflow(null);
      setSwarmActionKey((current) => (current === actionKey ? null : current));
    }
  };

  const runSwarmControlAction = async (input: {
    actionKey: string;
    title: string;
    description: string;
    execute: (api: NonNullable<ReturnType<typeof readNativeApi>>) => Promise<unknown>;
  }): Promise<boolean> => {
    const api = readNativeApi();
    if (!api) {
      return false;
    }

    setSwarmActionKey(input.actionKey);
    try {
      await input.execute(api);
      await invalidateCoordinatorQueries();
      toastManager.add({
        type: "success",
        title: input.title,
        description: input.description,
      });
      return true;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Swarm action failed",
        description: describeSwarmActionError(error),
      });
      return false;
    } finally {
      setSwarmActionKey((current) => (current === input.actionKey ? null : current));
    }
  };

  const startSwarmRun = async (
    input: Pick<
      OrchestrationStartSwarmRunInput,
      "schedulerMode" | "provider" | "model" | "runtimeMode" | "assistantDeliveryMode"
    >,
  ) => {
    if (!cwd || !projectId || !startSwarmDialogState) {
      return;
    }

    const actionKey = `start:${startSwarmDialogState.epicId}`;
    const modelOptions =
      input.provider === selectedProvider &&
      input.model === selectedModel &&
      composerProviderState.modelOptionsForDispatch
        ? { [selectedProvider]: composerProviderState.modelOptionsForDispatch }
        : undefined;

    const started = await runSwarmControlAction({
      actionKey,
      title: "Swarm run started",
      description: `${startSwarmDialogState.epicId} entered ${formatSwarmSchedulerMode(input.schedulerMode).toLowerCase()} mode.`,
      execute: (api) =>
        api.orchestration.startSwarmRun({
          projectId,
          epicIssueId: startSwarmDialogState.epicId,
          schedulerMode: input.schedulerMode,
          workspaceMode: "shared",
          provider: input.provider,
          model: input.model,
          ...(modelOptions ? { modelOptions } : {}),
          assistantDeliveryMode: input.assistantDeliveryMode,
          runtimeMode: input.runtimeMode,
        }),
    });
    if (started) {
      setStartSwarmDialogState(null);
    }
  };

  const continueSwarmRun = async (runId: OrchestrationSwarmRun["runId"]) => {
    await runSwarmControlAction({
      actionKey: `continue:${runId}`,
      title: "Swarm run continued",
      description: "The coordinator queued the next ready issue for this run.",
      execute: (api) => api.orchestration.continueSwarmRun({ runId }),
    });
  };

  const pauseSwarmRun = async (runId: OrchestrationSwarmRun["runId"]) => {
    await runSwarmControlAction({
      actionKey: `pause:${runId}`,
      title: "Swarm run paused",
      description: "The coordinator paused this run.",
      execute: (api) => api.orchestration.pauseSwarmRun({ runId }),
    });
  };

  const resumeSwarmRun = async (runId: OrchestrationSwarmRun["runId"]) => {
    await runSwarmControlAction({
      actionKey: `resume:${runId}`,
      title: "Swarm run resumed",
      description: "The coordinator resumed this run.",
      execute: (api) => api.orchestration.resumeSwarmRun({ runId }),
    });
  };

  const cancelSwarmRun = async (runId: OrchestrationSwarmRun["runId"]) => {
    await runSwarmControlAction({
      actionKey: `cancel:${runId}`,
      title: "Swarm run cancelled",
      description: "The coordinator cancelled this run.",
      execute: (api) => api.orchestration.cancelSwarmRun({ runId }),
    });
  };

  useEffect(() => {
    return () => {
      setSelectedIssueId(activeThreadId, null);
    };
  }, [activeThreadId, setSelectedIssueId]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="font-medium text-sm">Issues</h2>
            <div role="tablist" aria-label="Issue pane tabs" className="flex items-center gap-1">
              {(["issues", "coordinator"] as const).map((tab) => {
                const selected = state.activePanelTab === tab;
                const label = tab === "issues" ? "Issues" : "Coordinator";
                return (
                  <Button
                    key={tab}
                    role="tab"
                    size="xs"
                    variant={selected ? "secondary" : "ghost"}
                    aria-selected={selected}
                    onClick={() => setActivePanelTab(activeThreadId, tab)}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            {state.activePanelTab === "issues" && issueListQuery.data?.issues.length != null ? (
              <Badge size="sm" variant="secondary">
                {issueListQuery.data.issues.length}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {state.activePanelTab === "issues" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                      disabled={!cwd || issueListQuery.isFetching}
                      onClick={refreshIssues}
                      aria-label="Refresh issues"
                    >
                      {issueListQuery.isFetching ? (
                        <LoaderIcon className="size-3 animate-spin" />
                      ) : (
                        <RefreshCwIcon className="size-3" />
                      )}
                    </Button>
                  }
                />
                <TooltipPopup side="top">Refresh issues</TooltipPopup>
              </Tooltip>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={handleClosePane}
              aria-label="Close issues"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </div>

        {state.activePanelTab === "issues" ? (
          <>
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
              <Input
                size="sm"
                value={state.search}
                onChange={(event) => setSearch(activeThreadId, event.target.value)}
                placeholder="Search issues"
                className="min-w-0 flex-1"
              />
              <Select
                value={state.scope}
                onValueChange={(value) =>
                  value && setScope(activeThreadId, value as IssuePaneScope)
                }
              >
                <SelectTrigger className="w-[7.5rem] shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectPopup>
              </Select>
            </div>

            {!cwd ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Issues are unavailable until this thread has an active project.
              </div>
            ) : issueListQuery.isPending ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">Loading issues...</div>
            ) : issueListQuery.isError ? (
              <div className="px-4 py-6 text-sm text-destructive">
                {issueListQuery.error instanceof Error
                  ? issueListQuery.error.message
                  : "Could not load issues."}
              </div>
            ) : issueListQuery.data?.issues.length ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                {epicIssueGroups.length > 0 ? (
                  <div data-issues-section="epic-groups" className="space-y-4 px-0 py-3">
                    {epicIssueGroups.map((group) => (
                      <EpicGroupSection
                        key={group.key}
                        group={group}
                        selectedIssueId={state.selectedIssueId}
                        timestampFormat={settings.timestampFormat}
                        onSelectIssue={(issueId) => setSelectedIssueId(activeThreadId, issueId)}
                      />
                    ))}
                  </div>
                ) : null}
                {epicIssueGroups.length > 0 && otherIssueGroups.length > 0 ? (
                  <div
                    data-issues-divider="epic-other"
                    className="mx-4 my-1.5 border-t border-border/70"
                  />
                ) : null}
                {otherIssueGroups.length > 0 ? (
                  <div
                    data-issues-section="other-issues"
                    className={cn("px-0", epicIssueGroups.length > 0 ? "pb-3" : "py-3")}
                  >
                    {otherIssueGroups.map((group) => (
                      <EpicGroupSection
                        key={group.key}
                        group={group}
                        selectedIssueId={state.selectedIssueId}
                        timestampFormat={settings.timestampFormat}
                        onSelectIssue={(issueId) => setSelectedIssueId(activeThreadId, issueId)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No issues matched the current filters.
              </div>
            )}
          </>
        ) : (
          <ProjectCoordinatorContent
            swarmSupport={projectCoordinatorSnapshotQuery.data?.support ?? null}
            swarmSupportPending={projectCoordinatorSnapshotQuery.isPending}
            swarmSupportError={
              projectCoordinatorSnapshotQuery.error instanceof Error
                ? projectCoordinatorSnapshotQuery.error
                : null
            }
            cards={coordinatorCards}
            cardsPending={projectCoordinatorSnapshotQuery.isPending}
            cardsError={
              projectCoordinatorSnapshotQuery.error instanceof Error
                ? projectCoordinatorSnapshotQuery.error
                : null
            }
            timestampFormat={settings.timestampFormat}
            swarmActionKey={swarmActionKey}
            onOpenEpic={openCoordinatorIssue}
            onSelectIssue={openCoordinatorIssue}
            onOpenWorkerThread={(threadId) => {
              void openLinkedThread(threadId);
            }}
            onCreateSwarm={(epicId) => {
              void startEpicPlanImplementation({ epicIssueId: epicId, actionKind: "create_swarm" });
            }}
            onRepairSwarm={(epicId) => {
              void startEpicPlanImplementation({ epicIssueId: epicId, actionKind: "repair_swarm" });
            }}
            onOpenStartSwarm={(card) =>
              openStartSwarmDialog({
                epicId: card.epicId,
                epicTitle: card.epicTitle,
                validation: card.validation,
                status: card.status,
              })
            }
            onContinueRun={(runId) => {
              void continueSwarmRun(runId);
            }}
            onRefreshSwarmStatus={(epicId) => {
              void refreshEpicSwarmStatus(epicId);
            }}
            onPauseRun={(runId) => {
              void pauseSwarmRun(runId);
            }}
            onResumeRun={(runId) => {
              void resumeSwarmRun(runId);
            }}
            onCancelRun={(runId) => {
              void cancelSwarmRun(runId);
            }}
          />
        )}
      </div>

      <IssueDetailDialog
        issue={selectedIssueDetailQuery.data ?? null}
        issueId={state.selectedIssueId}
        isPending={selectedIssueDetailQuery.isPending}
        error={
          selectedIssueDetailQuery.error instanceof Error ? selectedIssueDetailQuery.error : null
        }
        swarmSupport={
          selectedIssueIsEpic ? (epicCoordinatorSnapshotQuery.data?.support ?? null) : null
        }
        swarmValidation={
          selectedIssueIsEpic ? (selectedEpicCoordinatorSnapshot?.validation ?? null) : null
        }
        swarmStatus={selectedIssueIsEpic ? (selectedEpicCoordinatorSnapshot?.status ?? null) : null}
        coordinatorState={epicCoordinatorState}
        projectConflict={
          selectedIssueIsEpic ? (selectedEpicCoordinatorSnapshot?.projectConflict ?? null) : null
        }
        swarmSupportPending={selectedIssueIsEpic ? epicCoordinatorSnapshotQuery.isPending : false}
        swarmValidationPending={false}
        swarmStatusPending={false}
        swarmSupportError={
          selectedIssueIsEpic && epicCoordinatorSnapshotQuery.error instanceof Error
            ? epicCoordinatorSnapshotQuery.error
            : null
        }
        swarmValidationError={null}
        swarmStatusError={null}
        childIssues={childIssues}
        onSelectChildIssue={(issueId) => setSelectedIssueId(activeThreadId, issueId)}
        linkedThreads={linkedThreads}
        activeThreadId={activeThreadId}
        onOpenLinkedThread={(threadId) => {
          void openLinkedThread(threadId);
        }}
        onStartIssueRefine={() => {
          void runIssueWorkflow("refine");
        }}
        onStartIssueImplement={() => {
          void runIssueWorkflow("solve");
        }}
        onStartEpicQuickRefine={() => {
          void startEpicRefine("quick_refine");
        }}
        onStartEpicPlannedRefine={() => {
          void startEpicRefine("planned_refine");
        }}
        open={state.selectedIssueId !== null}
        onTriggerEpicPrimaryAction={() => {
          if (!selectedIssueIsEpic) {
            void runIssueWorkflow("solve");
            return;
          }

          if (
            epicPrimaryAction.kind === "create_swarm" ||
            epicPrimaryAction.kind === "repair_swarm"
          ) {
            if (!selectedEpicIssueId) {
              return;
            }
            void startEpicPlanImplementation({
              epicIssueId: selectedEpicIssueId,
              actionKind: epicPrimaryAction.kind,
            });
            return;
          }

          if (epicPrimaryAction.kind === "start_swarm" && selectedIssueDetailQuery.data) {
            openStartSwarmDialog({
              epicId: selectedIssueDetailQuery.data.id,
              epicTitle: selectedIssueDetailQuery.data.title,
              validation: selectedEpicCoordinatorSnapshot?.validation ?? null,
              status: selectedEpicCoordinatorSnapshot?.status ?? null,
            });
            return;
          }

          if (epicPrimaryAction.kind === "refresh_swarm_state" && selectedEpicIssueId !== null) {
            void refreshEpicSwarmStatus(selectedEpicIssueId);
            return;
          }

          if (
            epicPrimaryAction.kind === "continue_swarm" &&
            epicCoordinatorState.latestRun !== null
          ) {
            void continueSwarmRun(epicCoordinatorState.latestRun.runId);
            return;
          }

          if (epicPrimaryAction.kind === "open_coordinator") {
            openCoordinator();
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            closeSelectedIssue();
          }
        }}
        timestampFormat={settings.timestampFormat}
        workflowActionsDisabled={workflowActionsDisabled}
        workflowActionsBusy={workflowActionsDisabled}
        activeWorkflow={activeWorkflow}
        epicPrimaryActionLabel={selectedIssueIsEpic ? epicPrimaryAction.label : "Implement"}
        epicPrimaryActionDisabled={selectedIssueIsEpic ? epicPrimaryAction.disabled : false}
        epicPrimaryActionBusy={epicPrimaryActionBusy}
        epicPrimaryActionBusyLabel={
          selectedIssueIsEpic ? epicPrimaryAction.busyLabel : "Implementing..."
        }
        latestPlannedRefine={selectedIssueIsEpic ? latestPlannedRefine : null}
        swarmRefreshPending={
          selectedEpicIssueId !== null && swarmActionKey === `refresh:${selectedEpicIssueId}`
        }
        onRefreshSwarmStatus={() => {
          if (selectedEpicIssueId !== null) {
            void refreshEpicSwarmStatus(selectedEpicIssueId);
          }
        }}
        onOpenProjectConflict={(epicId) => {
          openCoordinatorIssue(epicId);
        }}
      />

      <StartSwarmRunDialog
        open={startSwarmDialogState !== null}
        dialogState={startSwarmDialogState}
        providers={providerStatuses}
        defaultProvider={selectedProvider}
        defaultModel={selectedModel}
        defaultRuntimeMode={runtimeMode}
        defaultAssistantDeliveryMode={assistantDeliveryMode}
        isStarting={
          startSwarmDialogState !== null &&
          swarmActionKey === `start:${startSwarmDialogState.epicId}`
        }
        startDisabled={
          projectId === null ||
          startSwarmDialogState === null ||
          startSwarmDialogState.validation?.valid !== true ||
          startSwarmDialogState.validation.swarm === null
        }
        onOpenChange={(open) => {
          if (!open) {
            setStartSwarmDialogState(null);
          }
        }}
        onStart={(input) => {
          void startSwarmRun(input);
        }}
      />
    </>
  );
}
