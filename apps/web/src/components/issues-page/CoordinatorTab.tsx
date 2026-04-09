import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorEpicStateKind,
  BeadsIssueRelationSummary,
  BeadsProjectCoordinatorSnapshot,
  BeadsSwarmSupport,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
  DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
} from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { describeCoordinatorEpicState } from "@t3tools/shared/swarm";
import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  Loader2Icon,
  OctagonAlertIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { resolveDefaultModelSelection } from "~/lib/modelSelection";
import { ensureNativeApi } from "~/nativeApi";
import { partitionCoordinatorEpics } from "~/issuePanel";
import { cn } from "~/lib/utils";
import { useProjectById } from "~/storeSelectors";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { ErrorDisplay } from "../shared/ErrorDisplay";
import { toastManager } from "../ui/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CoordinatorTabProps = {
  cwd: string;
  projectId: ProjectId | null;
  swarmSupport: BeadsSwarmSupport | null;
  swarmSupportPending: boolean;
  swarmSupportError: Error | null;
  snapshot: BeadsProjectCoordinatorSnapshot | null;
  snapshotPending: boolean;
  snapshotError: Error | null;
  selectedEpicId: string | null;
  onSelectEpic: (epicId: string | null) => void;
  onOpenEpicIssue: (epicId: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
};

type CoordinatorActionInput =
  | { kind: "open_coordination_prep_thread"; epicIssueId: string }
  | { kind: "start_swarm"; epicIssueId: string }
  | { kind: "run_next_swarm_task"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "resume_paused_swarm_run"; runId: OrchestrationSwarmRun["runId"] }
  | {
      kind: "retry_swarm_task_execution";
      runId: OrchestrationSwarmRun["runId"];
      executionId: OrchestrationSwarmTaskExecution["executionId"];
    }
  | { kind: "pause_swarm"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "cancel_swarm"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "refresh_swarm_state"; epicIssueId: string };

// ---------------------------------------------------------------------------
// Status styling (matches CoordinatorPanel sidebar)
// ---------------------------------------------------------------------------

type StatusColor = "red" | "amber" | "green" | "blue" | "gray";

function categoryColor(
  category: ReturnType<typeof describeCoordinatorEpicState>["category"],
): StatusColor {
  switch (category) {
    case "active":
      return "blue";
    case "ready":
      return "green";
    case "blocked":
      return "red";
    case "setup":
      return "amber";
    case "done":
      return "gray";
    case "loading":
      return "gray";
  }
}

const DOT_CLASSES: Record<StatusColor, string> = {
  red: "bg-destructive",
  amber: "bg-warning",
  green: "bg-success",
  blue: "bg-info",
  gray: "bg-muted-foreground/50",
};

const LABEL_CLASSES: Record<StatusColor, string> = {
  red: "text-destructive",
  amber: "text-warning-foreground",
  green: "text-success-foreground",
  blue: "text-info-foreground",
  gray: "text-muted-foreground",
};

const CARD_BG_CLASSES: Record<StatusColor, string> = {
  red: "bg-destructive/5",
  amber: "bg-warning/5",
  green: "bg-success/5",
  blue: "bg-info/5",
  gray: "bg-muted/30",
};

// ---------------------------------------------------------------------------
// Sort / rank helpers (matches sidebar CoordinatorPanel)
// ---------------------------------------------------------------------------

function stateRank(kind: BeadsCoordinatorEpicStateKind): number {
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
    case "needs_preparation":
      return 7;
    case "ready":
      return 8;
    case "running":
      return 9;
    case "cancelled":
      return 10;
    case "completed":
      return 11;
    case "unsupported":
      return 12;
    case "checking":
      return 13;
  }
}

function compareEpics(
  left: BeadsCoordinatorEpicSnapshot,
  right: BeadsCoordinatorEpicSnapshot,
): number {
  const leftRank = stateRank(left.stateKind);
  const rightRank = stateRank(right.stateKind);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftTs = left.latestRun?.updatedAt ?? "";
  const rightTs = right.latestRun?.updatedAt ?? "";
  const tsDelta = rightTs.localeCompare(leftTs);
  if (tsDelta !== 0) return tsDelta;

  return left.epicTitle.localeCompare(right.epicTitle);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeEpic(epic: BeadsCoordinatorEpicSnapshot) {
  return describeCoordinatorEpicState({
    stateKind: epic.stateKind,
    lastError: epic.latestRun?.lastError ?? epic.activeExecution?.lastError ?? null,
    fetchDetail: epic.fetchLifecycle.detail,
    activeWorkerCount: epic.swarmSummary?.activeWorkerCount ?? 0,
    completedIssueCount: epic.swarmSummary?.completedIssueCount ?? 0,
    totalIssueCount: epic.swarmSummary?.totalIssueCount ?? 0,
  });
}

function progressPercent(epic: BeadsCoordinatorEpicSnapshot): number | null {
  const total = epic.swarmSummary?.totalIssueCount ?? 0;
  if (total === 0) return null;
  return Math.round(((epic.swarmSummary?.completedIssueCount ?? 0) / total) * 100);
}

function formatRunStatus(status: OrchestrationSwarmRun["status"]): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
  }
}

function formatExecutionStatus(status: OrchestrationSwarmTaskExecution["status"]): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStatusBadgeVariant(
  status: OrchestrationSwarmRun["status"],
): "success" | "error" | "warning" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "blocked":
    case "paused":
      return "warning";
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

function executionStatusBadgeVariant(
  status: OrchestrationSwarmTaskExecution["status"],
): "success" | "error" | "warning" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "active":
      return "info";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoordinatorTab(props: CoordinatorTabProps) {
  const queryClient = useQueryClient();
  const project = useProjectById(props.projectId);
  const epics = props.snapshot?.epics ?? null;
  const sorted = useMemo(() => [...(epics ?? [])].toSorted(compareEpics), [epics]);
  const sections = useMemo(() => partitionCoordinatorEpics(sorted), [sorted]);

  const selectedEpic = useMemo(
    () => (props.selectedEpicId ? sorted.find((e) => e.epicId === props.selectedEpicId) : null),
    [sorted, props.selectedEpicId],
  );

  // Auto-select first epic if none selected and epics exist
  const effectiveSelectedEpic = selectedEpic ?? sorted[0] ?? null;

  const coordinatorActionMutation = useMutation({
    mutationFn: async (
      action: CoordinatorActionInput,
    ): Promise<{ threadId: ThreadId; created: boolean } | null> => {
      const api = ensureNativeApi();

      switch (action.kind) {
        case "open_coordination_prep_thread":
          if (!props.projectId || !project) {
            throw new Error("Project context is unavailable.");
          }

          return api.beads.startEpicCoordinationPrep({
            cwd: props.cwd,
            projectId: props.projectId,
            epicIssueId: action.epicIssueId,
            modelSelection: resolveDefaultModelSelection(project.defaultModelSelection),
            runtimeMode: DEFAULT_RUNTIME_MODE,
          });
        case "start_swarm":
          if (!props.projectId) {
            throw new Error("Project context is unavailable.");
          }

          await api.orchestration.startSwarmRun({
            projectId: props.projectId,
            epicIssueId: action.epicIssueId,
            schedulerMode: DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
            workspaceMode: DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
            runtimeMode: DEFAULT_RUNTIME_MODE,
          });
          return null;
        case "run_next_swarm_task":
          await api.orchestration.runNextSwarmTask({ runId: action.runId });
          return null;
        case "resume_paused_swarm_run":
          await api.orchestration.resumePausedSwarmRun({ runId: action.runId });
          return null;
        case "retry_swarm_task_execution":
          await api.orchestration.retrySwarmTaskExecution({
            runId: action.runId,
            executionId: action.executionId,
          });
          return null;
        case "pause_swarm":
          await api.orchestration.pauseSwarmRun({ runId: action.runId });
          return null;
        case "cancel_swarm":
          await api.orchestration.cancelSwarmRun({ runId: action.runId });
          return null;
        case "refresh_swarm_state":
          await queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
          return null;
      }
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });

      if (result) {
        if (!result.created) {
          toastManager.add({
            type: "info",
            title: "Reused linked thread",
            description: "An existing coordination prep thread was reused for this epic.",
          });
        }

        props.onOpenThread(result.threadId);
      }
    },
  });

  const busyActionKey = useMemo(() => {
    const action = coordinatorActionMutation.variables;
    if (!coordinatorActionMutation.isPending || !action) {
      return null;
    }

    switch (action.kind) {
      case "open_coordination_prep_thread":
        return `prep:${action.epicIssueId}`;
      case "start_swarm":
        return `start:${action.epicIssueId}`;
      case "run_next_swarm_task":
        return `run-next:${action.runId}`;
      case "resume_paused_swarm_run":
        return `resume:${action.runId}`;
      case "retry_swarm_task_execution":
        return `retry:${action.executionId}`;
      case "pause_swarm":
        return `pause:${action.runId}`;
      case "cancel_swarm":
        return `cancel:${action.runId}`;
      case "refresh_swarm_state":
        return `refresh:${action.epicIssueId}`;
    }
  }, [coordinatorActionMutation.isPending, coordinatorActionMutation.variables]);

  const handleCoordinatorAction = async (action: CoordinatorActionInput) => {
    try {
      await coordinatorActionMutation.mutateAsync(action);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: describeCoordinatorActionError(action.kind),
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    }
  };

  // Gate: loading / error / unsupported states
  if (props.swarmSupportPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (props.swarmSupportError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorDisplay error={props.swarmSupportError} variant="minimal" />
      </div>
    );
  }

  if (props.swarmSupport?.supported === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Coordinator is unavailable for this backend.
        </p>
        {props.swarmSupport.reason ? (
          <p className="text-xs text-muted-foreground/70">{props.swarmSupport.reason}</p>
        ) : null}
      </div>
    );
  }

  if (props.snapshotPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (props.snapshotError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorDisplay error={props.snapshotError} variant="minimal" />
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <ZapIcon className="size-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No epics found.</p>
        <p className="text-xs text-muted-foreground/70">
          Create an epic issue to get started with the coordinator.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel: epic list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border lg:w-80">
        <ScrollArea>
          <div className="space-y-4 p-3">
            <EpicListSection
              label="Needs Attention"
              epics={sections.needsAttention}
              emptyText="Nothing needs attention."
              selectedEpicId={effectiveSelectedEpic?.epicId ?? null}
              onSelect={props.onSelectEpic}
              onOpenEpicIssue={props.onOpenEpicIssue}
            />
            <EpicListSection
              label="Active"
              epics={sections.active}
              emptyText="No active epics."
              selectedEpicId={effectiveSelectedEpic?.epicId ?? null}
              onSelect={props.onSelectEpic}
              onOpenEpicIssue={props.onOpenEpicIssue}
            />
            <EpicListSection
              label="History"
              epics={sections.history}
              emptyText="No completed or cancelled runs."
              selectedEpicId={effectiveSelectedEpic?.epicId ?? null}
              onSelect={props.onSelectEpic}
              onOpenEpicIssue={props.onOpenEpicIssue}
              defaultCollapsed={
                sections.needsAttention.length + sections.active.length > 0 &&
                sections.history.length > 3
              }
            />
          </div>
        </ScrollArea>
      </div>

      {/* Right panel: epic detail */}
      <div className="min-w-0 flex-1">
        {effectiveSelectedEpic ? (
          <ScrollArea>
            <EpicDetail
              epic={effectiveSelectedEpic}
              busyActionKey={busyActionKey}
              onOpenEpicIssue={props.onOpenEpicIssue}
              onOpenThread={props.onOpenThread}
              onRunAction={(action) => void handleCoordinatorAction(action)}
              onSelectEpic={props.onSelectEpic}
            />
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Select an epic to see details.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epic list section (left panel)
// ---------------------------------------------------------------------------

function EpicListSection(props: {
  label: string;
  epics: ReadonlyArray<BeadsCoordinatorEpicSnapshot>;
  emptyText: string;
  selectedEpicId: string | null;
  onSelect: (epicId: string | null) => void;
  onOpenEpicIssue: (epicId: string) => void;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {props.label}
        </h3>
        <span className="text-xs text-muted-foreground/60">({props.epics.length})</span>
      </button>
      {!collapsed &&
        (props.epics.length > 0 ? (
          <div className="space-y-1">
            {props.epics.map((epic) => (
              <EpicListItem
                key={epic.epicId}
                epic={epic}
                selected={epic.epicId === props.selectedEpicId}
                onSelect={() => props.onSelect(epic.epicId)}
                onOpenEpicIssue={props.onOpenEpicIssue}
              />
            ))}
          </div>
        ) : (
          <p className="pl-5 text-xs text-muted-foreground">{props.emptyText}</p>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Epic list item (left panel)
// ---------------------------------------------------------------------------

function EpicListItem(props: {
  epic: BeadsCoordinatorEpicSnapshot;
  selected: boolean;
  onSelect: () => void;
  onOpenEpicIssue: (epicId: string) => void;
}) {
  const { epic, selected } = props;
  const desc = describeEpic(epic);
  const color = categoryColor(desc.category);
  const pct = progressPercent(epic);

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 transition-colors",
        selected
          ? cn("border-primary/30 bg-primary/5", CARD_BG_CLASSES[color])
          : "border-transparent hover:bg-muted/50",
      )}
    >
      <button type="button" className="w-full text-left" onClick={props.onSelect}>
        <div className="flex items-start gap-2">
          <span
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT_CLASSES[color])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{epic.epicTitle}</p>
            <p className={cn("mt-0.5 text-xs", LABEL_CLASSES[color])}>{desc.label}</p>
          </div>
          {pct !== null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct}%</span>
          )}
        </div>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 pl-4">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Epic</span>
        <EpicIssueLink epicId={epic.epicId} onOpenEpicIssue={props.onOpenEpicIssue} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epic detail (right panel)
// ---------------------------------------------------------------------------

function EpicDetail(props: {
  epic: BeadsCoordinatorEpicSnapshot;
  busyActionKey: string | null;
  onOpenEpicIssue: (epicId: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onRunAction: (action: CoordinatorActionInput) => void;
  onSelectEpic: (epicId: string | null) => void;
}) {
  const { epic } = props;
  const desc = describeEpic(epic);
  const color = categoryColor(desc.category);
  const summary = epic.swarmSummary;
  const status = epic.status;
  const validation = epic.validation;
  const runs = epic.runs ?? [];
  const executions = epic.executions ?? [];

  return (
    <div className="space-y-6 p-5">
      {/* Header */}
      <div>
        <div className="flex items-start gap-3">
          <span
            className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT_CLASSES[color])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{epic.epicTitle}</h2>
              <EpicIssueLink epicId={epic.epicId} onOpenEpicIssue={props.onOpenEpicIssue} />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("text-sm font-medium", LABEL_CLASSES[color])}>{desc.label}</span>
              <span className="text-sm text-muted-foreground">{desc.summary}</span>
            </div>
          </div>
        </div>
      </div>

      <CoordinatorActionBar
        epic={epic}
        busyActionKey={props.busyActionKey}
        onRunAction={props.onRunAction}
        onSelectEpic={props.onSelectEpic}
      />

      {/* Progress bar */}
      {summary && summary.totalIssueCount > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Progress</span>
            <span className="tabular-nums text-muted-foreground">
              {summary.completedIssueCount}/{summary.totalIssueCount} issues completed
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
              style={{
                width: `${(summary.completedIssueCount / summary.totalIssueCount) * 100}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {summary.activeIssueCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-info" />
                {summary.activeIssueCount} active
              </span>
            )}
            {summary.readyIssueCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-success" />
                {summary.readyIssueCount} ready
              </span>
            )}
            {summary.blockedIssueCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-destructive" />
                {summary.blockedIssueCount} blocked
              </span>
            )}
            {summary.activeWorkerCount > 0 && (
              <span>
                {summary.activeWorkerCount} worker
                {summary.activeWorkerCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* Active worker card */}
      {epic.activeExecution ? (
        <ActiveWorkerCard execution={epic.activeExecution} onOpenThread={props.onOpenThread} />
      ) : null}

      {/* Project conflict warning */}
      {epic.projectConflict ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
          <p className="min-w-0 flex-1 text-foreground">{epic.projectConflict.message}</p>
        </div>
      ) : null}

      {/* Latest run error */}
      {epic.latestRun?.lastError && desc.category === "blocked" ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {epic.latestRun.lastError}
        </div>
      ) : null}

      {/* Issue breakdown by status */}
      {status ? <IssueBreakdown status={status} /> : null}

      {/* Parallelism wavefronts */}
      {validation && validation.readyFronts.length > 0 ? (
        <WavefrontDisplay validation={validation} />
      ) : null}

      {/* Validation messages */}
      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) ? (
        <ValidationMessages validation={validation} />
      ) : null}

      {/* Run history */}
      {runs.length > 0 ? <RunHistory runs={runs} /> : null}

      {/* Execution log */}
      {executions.length > 0 ? (
        <ExecutionLog executions={executions} onOpenThread={props.onOpenThread} />
      ) : null}
    </div>
  );
}

type CoordinatorAction = {
  key: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive-outline";
  icon?: ReactNode;
  onClick: () => void;
};

function CoordinatorActionBar(props: {
  epic: BeadsCoordinatorEpicSnapshot;
  busyActionKey: string | null;
  onRunAction: (action: CoordinatorActionInput) => void;
  onSelectEpic: (epicId: string | null) => void;
}) {
  const { epic } = props;
  const run = epic.latestRun;
  const primaryAction = epic.primaryAction;
  const retryableExecution =
    epic.executions
      .filter(
        (execution) =>
          run !== null &&
          execution.runId === run.runId &&
          (execution.status === "failed" || execution.status === "cancelled"),
      )
      .toSorted(
        (left, right) =>
          right.sequenceNumber - left.sequenceNumber ||
          right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null;
  const actions: CoordinatorAction[] = [];

  switch (primaryAction.kind) {
    case "open_coordination_prep_thread":
      actions.push({
        key: `prep:${epic.epicId}`,
        label: primaryAction.label,
        busyLabel: primaryAction.busyLabel,
        disabled: primaryAction.disabled,
        icon: <PlayIcon className="size-3" />,
        onClick: () =>
          props.onRunAction({ kind: "open_coordination_prep_thread", epicIssueId: epic.epicId }),
      });
      break;
    case "start_swarm":
      actions.push({
        key: `start:${epic.epicId}`,
        label: primaryAction.label,
        busyLabel: primaryAction.busyLabel,
        disabled: primaryAction.disabled,
        icon: <PlayIcon className="size-3" />,
        onClick: () => props.onRunAction({ kind: "start_swarm", epicIssueId: epic.epicId }),
      });
      break;
    case "run_next_swarm_task":
      if (run) {
        actions.push({
          key: `run-next:${run.runId}`,
          label: primaryAction.label,
          busyLabel: primaryAction.busyLabel,
          disabled: primaryAction.disabled,
          icon: <PlayIcon className="size-3" />,
          onClick: () => props.onRunAction({ kind: "run_next_swarm_task", runId: run.runId }),
        });
      }
      break;
    case "resume_paused_swarm_run":
      if (run) {
        actions.push({
          key: `resume:${run.runId}`,
          label: primaryAction.label,
          busyLabel: primaryAction.busyLabel,
          disabled: primaryAction.disabled,
          icon: <PlayIcon className="size-3" />,
          onClick: () => props.onRunAction({ kind: "resume_paused_swarm_run", runId: run.runId }),
        });
      }
      break;
    case "refresh_swarm_state":
      actions.push({
        key: `refresh:${epic.epicId}`,
        label: primaryAction.label,
        busyLabel: primaryAction.busyLabel,
        disabled: primaryAction.disabled,
        variant: "outline",
        icon: <RefreshCwIcon className="size-3" />,
        onClick: () => props.onRunAction({ kind: "refresh_swarm_state", epicIssueId: epic.epicId }),
      });
      break;
    case "open_coordinator":
      if (epic.projectConflict) {
        actions.push({
          key: `conflict:${epic.projectConflict.run.runId}`,
          label: primaryAction.label,
          busyLabel: primaryAction.busyLabel,
          disabled: primaryAction.disabled,
          variant: "outline",
          icon: <ExternalLinkIcon className="size-3" />,
          onClick: () => props.onSelectEpic(epic.projectConflict?.run.epicIssueId ?? null),
        });
      }
      break;
    case "checking":
    case "unsupported":
      break;
  }

  if (
    run?.status === "blocked" &&
    run.blockedContext?.kind === "worker_failure" &&
    retryableExecution !== null
  ) {
    actions.push({
      key: `retry:${retryableExecution.executionId}`,
      label: "Retry failed task",
      busyLabel: "Retrying...",
      variant: "outline",
      icon: <RefreshCwIcon className="size-3" />,
      onClick: () =>
        props.onRunAction({
          kind: "retry_swarm_task_execution",
          runId: run.runId,
          executionId: retryableExecution.executionId,
        }),
    });
  }

  if (run?.status === "running" && epic.activeExecution === null) {
    actions.push({
      key: `pause:${run.runId}`,
      label: "Pause epic",
      busyLabel: "Pausing...",
      variant: "outline",
      icon: <PauseIcon className="size-3" />,
      onClick: () => props.onRunAction({ kind: "pause_swarm", runId: run.runId }),
    });
  }

  if (run && run.status !== "cancelled" && run.status !== "completed" && run.status !== "failed") {
    actions.push({
      key: `cancel:${run.runId}`,
      label: "Cancel epic",
      busyLabel: "Cancelling...",
      variant: "destructive-outline",
      icon: <XIcon className="size-3" />,
      onClick: () => props.onRunAction({ kind: "cancel_swarm", runId: run.runId }),
    });
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <DetailSection title="Actions">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const busy = props.busyActionKey === action.key;
          return (
            <Button
              key={action.key}
              size="sm"
              variant={action.variant ?? "default"}
              disabled={busy || action.disabled}
              onClick={action.onClick}
              className="gap-1.5"
            >
              {busy ? <Loader2Icon className="size-3 animate-spin" /> : action.icon}
              {busy ? action.busyLabel : action.label}
            </Button>
          );
        })}
      </div>
    </DetailSection>
  );
}

function describeCoordinatorActionError(actionKind: CoordinatorActionInput["kind"]): string {
  switch (actionKind) {
    case "open_coordination_prep_thread":
      return "Unable to open prep thread";
    case "start_swarm":
      return "Unable to start epic";
    case "run_next_swarm_task":
      return "Unable to run the next epic task";
    case "resume_paused_swarm_run":
      return "Unable to resume the paused epic";
    case "retry_swarm_task_execution":
      return "Unable to retry the epic task";
    case "pause_swarm":
      return "Unable to pause epic";
    case "cancel_swarm":
      return "Unable to cancel epic";
    case "refresh_swarm_state":
      return "Unable to refresh epic status";
    default:
      return "Unable to run coordinator action";
  }
}

function EpicIssueLink(props: { epicId: string; onOpenEpicIssue: (epicId: string) => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      onClick={() => props.onOpenEpicIssue(props.epicId)}
      aria-label={`Open epic ${props.epicId} in issues tab`}
    >
      {props.epicId}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Active worker card
// ---------------------------------------------------------------------------

function ActiveWorkerCard(props: {
  execution: OrchestrationSwarmTaskExecution;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { execution } = props;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-info/20 bg-info/5 px-3.5 py-3">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-info" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Working on <span className="font-semibold">{execution.issueId}</span>
        </p>
        {execution.startedAt ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Started {formatRelativeTimeLabel(execution.startedAt)}
          </p>
        ) : null}
      </div>
      {execution.workerThreadId ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => props.onOpenThread(execution.workerThreadId!)}
          className="shrink-0 gap-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLinkIcon className="size-3" />
          Open thread
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue breakdown by status
// ---------------------------------------------------------------------------

function IssueBreakdown(props: { status: NonNullable<BeadsCoordinatorEpicSnapshot["status"]> }) {
  const { status } = props;
  const groups: Array<{
    label: string;
    icon: ReactNode;
    issues: ReadonlyArray<BeadsIssueRelationSummary>;
    color: string;
  }> = [
    {
      label: "Completed",
      icon: <CheckCircle2Icon className="size-3.5 text-success-foreground" />,
      issues: status.completed,
      color: "text-success-foreground",
    },
    {
      label: "Active",
      icon: <PlayIcon className="size-3.5 text-info-foreground" />,
      issues: status.active,
      color: "text-info-foreground",
    },
    {
      label: "Ready",
      icon: <CircleDotIcon className="size-3.5 text-muted-foreground" />,
      issues: status.ready,
      color: "text-foreground",
    },
    {
      label: "Blocked",
      icon: <OctagonAlertIcon className="size-3.5 text-destructive" />,
      issues: status.blocked,
      color: "text-destructive",
    },
  ];

  const nonEmpty = groups.filter((g) => g.issues.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <DetailSection title="Issue Breakdown">
      <div className="space-y-3">
        {nonEmpty.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 flex items-center gap-1.5">
              {group.icon}
              <span className={cn("text-xs font-medium", group.color)}>{group.label}</span>
              <span className="text-xs text-muted-foreground/60">({group.issues.length})</span>
            </div>
            <div className="space-y-1 pl-5">
              {group.issues.map((issue) => (
                <div key={issue.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground">{issue.title}</span>
                  <Badge variant="neutral" size="sm">
                    {issue.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

// ---------------------------------------------------------------------------
// Wavefront display (parallelism)
// ---------------------------------------------------------------------------

function WavefrontDisplay(props: {
  validation: NonNullable<BeadsCoordinatorEpicSnapshot["validation"]>;
}) {
  const { validation } = props;
  const maxParallelism = validation.maxParallelism;
  const estimatedWorkers = validation.estimatedWorkerSessions;

  return (
    <DetailSection title="Parallelism Wavefronts">
      {(maxParallelism !== null || estimatedWorkers !== null) && (
        <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
          {maxParallelism !== null && <span>Max parallelism: {maxParallelism}</span>}
          {estimatedWorkers !== null && <span>Est. worker sessions: {estimatedWorkers}</span>}
        </div>
      )}
      <div className="space-y-2">
        {validation.readyFronts.map((front, frontIndex) => (
          <div
            key={`front-${frontIndex.toString()}`}
            className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
          >
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Wave {(frontIndex + 1).toString()}
              <span className="ml-1 text-muted-foreground/50">
                ({front.length} issue{front.length !== 1 ? "s" : ""})
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {front.map((issue) => (
                <Badge key={issue.id} variant="neutral" size="sm">
                  {issue.title}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

// ---------------------------------------------------------------------------
// Validation messages
// ---------------------------------------------------------------------------

function ValidationMessages(props: {
  validation: NonNullable<BeadsCoordinatorEpicSnapshot["validation"]>;
}) {
  const { validation } = props;
  return (
    <DetailSection title="Validation">
      <div className="space-y-1.5">
        {validation.errors.map((msg, i) => (
          <div
            key={`err-${i.toString()}`}
            className="flex items-start gap-2 text-xs text-destructive"
          >
            <OctagonAlertIcon className="mt-0.5 size-3 shrink-0" />
            <span>{msg}</span>
          </div>
        ))}
        {validation.warnings.map((msg, i) => (
          <div
            key={`warn-${i.toString()}`}
            className="flex items-start gap-2 text-xs text-warning-foreground"
          >
            <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
            <span>{msg}</span>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

// ---------------------------------------------------------------------------
// Run history table
// ---------------------------------------------------------------------------

function RunHistory(props: { runs: ReadonlyArray<OrchestrationSwarmRun> }) {
  // Sort by most recent first
  const sorted = useMemo(
    () => [...props.runs].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [props.runs],
  );

  return (
    <DetailSection title="Run History">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Mode</th>
              <th className="pb-2 pr-3 font-medium">Started</th>
              <th className="pb-2 pr-3 font-medium">Updated</th>
              <th className="pb-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {sorted.map((run) => (
              <tr key={run.runId}>
                <td className="py-2 pr-3">
                  <Badge variant={runStatusBadgeVariant(run.status)} size="sm">
                    {formatRunStatus(run.status)}
                  </Badge>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{run.schedulerMode}</td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                  {run.startedAt ? formatRelativeTimeLabel(run.startedAt) : "—"}
                </td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                  {formatRelativeTimeLabel(run.updatedAt)}
                </td>
                <td className="max-w-48 truncate py-2 text-destructive">{run.lastError ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

// ---------------------------------------------------------------------------
// Execution log table
// ---------------------------------------------------------------------------

function ExecutionLog(props: {
  executions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const sorted = useMemo(
    () => [...props.executions].toSorted((a, b) => b.sequenceNumber - a.sequenceNumber),
    [props.executions],
  );

  return (
    <DetailSection title="Execution Log">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Issue</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Started</th>
              <th className="pb-2 font-medium">Thread</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {sorted.map((exec) => (
              <tr key={exec.executionId}>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                  {exec.sequenceNumber}
                </td>
                <td className="max-w-32 truncate py-2 pr-3 font-medium text-foreground">
                  {exec.issueId}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant={executionStatusBadgeVariant(exec.status)} size="sm">
                    {formatExecutionStatus(exec.status)}
                  </Badge>
                </td>
                <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                  {exec.startedAt ? formatRelativeTimeLabel(exec.startedAt) : "—"}
                </td>
                <td className="py-2">
                  {exec.workerThreadId ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => props.onOpenThread(exec.workerThreadId!)}
                    >
                      <ExternalLinkIcon className="size-3" />
                      <span>Open</span>
                    </button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

// ---------------------------------------------------------------------------
// Detail section wrapper
// ---------------------------------------------------------------------------

function DetailSection(props: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}
