import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsProjectCoordinatorSnapshot,
  BeadsSwarmSupport,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  OctagonAlertIcon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { resolveDefaultModelSelection } from "~/lib/modelSelection";
import { isIssueDoneStatus } from "~/lib/issueConstants";
import { partitionCoordinatorEpics } from "~/issuePanel";
import { cn } from "~/lib/utils";
import { useProjectById } from "~/storeSelectors";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import {
  type CoordinatorActionInput,
  useEpicCoordinatorActionRunner,
} from "~/hooks/useEpicCoordinatorActionRunner";
import { WorkGraph } from "./WorkGraph";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { ErrorDisplay } from "../shared/ErrorDisplay";

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

// ---------------------------------------------------------------------------
// Status styling (matches CoordinatorPanel sidebar)
// ---------------------------------------------------------------------------

type CoordinatorStatusCategory = "active" | "ready" | "blocked" | "setup" | "done" | "loading";

type CoordinatorStatusDescription = {
  readonly label: string;
  readonly summary: string;
  readonly category: CoordinatorStatusCategory;
};

type StatusColor = "red" | "amber" | "green" | "blue" | "gray";

function categoryColor(category: CoordinatorStatusCategory): StatusColor {
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

function getLatestRun(epic: BeadsCoordinatorEpicSnapshot): OrchestrationSwarmRun | null {
  return epic.runs[0] ?? null;
}

function getActiveRun(epic: BeadsCoordinatorEpicSnapshot): OrchestrationSwarmRun | null {
  return epic.activeRunId
    ? (epic.runs.find((run) => run.runId === epic.activeRunId) ?? null)
    : null;
}

function getActiveExecution(
  epic: BeadsCoordinatorEpicSnapshot,
): OrchestrationSwarmTaskExecution | null {
  return epic.activeExecutionId
    ? (epic.executions.find((execution) => execution.executionId === epic.activeExecutionId) ??
        null)
    : null;
}

function isNeedsAttention(epic: BeadsCoordinatorEpicSnapshot): boolean {
  const activeRun = getActiveRun(epic);
  return (
    epic.trackerLoadState !== "ready" ||
    !epic.coordinationSupported ||
    epic.validationState === "invalid" ||
    epic.projectConflict !== null ||
    activeRun?.status === "failed"
  );
}

function isActiveEpic(epic: BeadsCoordinatorEpicSnapshot): boolean {
  return epic.activeRunId !== null || epic.trackerState === "in_progress";
}

function sectionRank(epic: BeadsCoordinatorEpicSnapshot): number {
  if (isNeedsAttention(epic)) return 0;
  if (isActiveEpic(epic)) return 1;
  return 2;
}

function compareEpics(
  left: BeadsCoordinatorEpicSnapshot,
  right: BeadsCoordinatorEpicSnapshot,
): number {
  const leftRank = sectionRank(left);
  const rightRank = sectionRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftActiveRun = getActiveRun(left);
  const rightActiveRun = getActiveRun(right);
  if (leftActiveRun !== null && rightActiveRun === null) return -1;
  if (rightActiveRun !== null && leftActiveRun === null) return 1;

  const leftTs = leftActiveRun?.updatedAt ?? getLatestRun(left)?.requestedAt ?? "";
  const rightTs = rightActiveRun?.updatedAt ?? getLatestRun(right)?.requestedAt ?? "";
  const tsDelta = rightTs.localeCompare(leftTs);
  if (tsDelta !== 0) return tsDelta;

  return left.epicTitle.localeCompare(right.epicTitle);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeEpic(epic: BeadsCoordinatorEpicSnapshot) {
  const activeRun = getActiveRun(epic);
  const latestRun = getLatestRun(epic);
  const lastError =
    activeRun?.failureContext?.message ??
    latestRun?.failureContext?.message ??
    getActiveExecution(epic)?.failureContext?.message;

  if (epic.trackerLoadState === "timeout") {
    return {
      label: "Timed out",
      summary: epic.trackerLoadDetail ?? "Tracker status request timed out. Retry to refresh.",
      category: "blocked",
    } satisfies CoordinatorStatusDescription;
  }

  if (epic.trackerLoadState === "error") {
    return {
      label: "Unavailable",
      summary: epic.trackerLoadDetail ?? "Could not load tracker status. Retry to refresh.",
      category: "blocked",
    } satisfies CoordinatorStatusDescription;
  }

  if (!epic.coordinationSupported) {
    return {
      label: "Unavailable",
      summary:
        epic.coordinationUnsupportedReason ?? "This backend does not support epic coordination.",
      category: "done",
    } satisfies CoordinatorStatusDescription;
  }

  if (epic.validationState === "invalid") {
    return {
      label: "Invalid",
      summary: epic.validationErrors[0] ?? "Epic is not currently valid to start.",
      category: "setup",
    } satisfies CoordinatorStatusDescription;
  }

  if (activeRun !== null) {
    switch (activeRun.status) {
      case "pending":
      case "running":
        return {
          label: "Run Active",
          summary:
            epic.progress.activeWorkerCount > 0
              ? `${epic.progress.activeWorkerCount} worker${epic.progress.activeWorkerCount !== 1 ? "s" : ""} active, ${epic.progress.completedIssueCount}/${epic.progress.totalIssueCount} issues done`
              : `${epic.progress.completedIssueCount}/${epic.progress.totalIssueCount} issues done`,
          category: "active",
        } satisfies CoordinatorStatusDescription;
      case "stopping":
        return {
          label: "Stopping",
          summary: "Stopping the run.",
          category: "active",
        } satisfies CoordinatorStatusDescription;
      case "failed":
        return {
          label: "Failed",
          summary: lastError ?? "The latest run failed. Fix the issue and start a new run.",
          category: "blocked",
        } satisfies CoordinatorStatusDescription;
      case "stopped":
        return {
          label: "Stopped",
          summary: "The latest run was stopped. Start a new run to continue.",
          category: "done",
        } satisfies CoordinatorStatusDescription;
      case "completed":
        break;
    }
  }

  switch (epic.trackerState) {
    case "completed":
      return {
        label: "Completed",
        summary:
          epic.progress.totalIssueCount > 0
            ? `All ${epic.progress.totalIssueCount} issues completed.`
            : "All tracked work is complete.",
        category: "done",
      } satisfies CoordinatorStatusDescription;
    case "in_progress":
      return {
        label: "In Progress",
        summary:
          epic.progress.activeIssueCount > 0
            ? `${epic.progress.activeIssueCount} active issue${epic.progress.activeIssueCount !== 1 ? "s" : ""} in Beads`
            : `${epic.progress.completedIssueCount}/${epic.progress.totalIssueCount} issues done`,
        category: "active",
      } satisfies CoordinatorStatusDescription;
    case "blocked":
      return {
        label: "Blocked",
        summary:
          epic.progress.externalBlockedIssueCount > 0
            ? `${epic.progress.externalBlockedIssueCount} externally blocked issue${epic.progress.externalBlockedIssueCount !== 1 ? "s" : ""} in Beads`
            : epic.progress.unknownBlockedIssueCount > 0
              ? `${epic.progress.unknownBlockedIssueCount} blocked issue${epic.progress.unknownBlockedIssueCount !== 1 ? "s" : ""} with unknown provenance in Beads`
              : "Tracker reports blocked work.",
        category: "blocked",
      } satisfies CoordinatorStatusDescription;
    case "not_started":
      if (
        epic.progress.externalBlockedIssueCount === 0 &&
        epic.progress.unknownBlockedIssueCount === 0 &&
        epic.progress.internalBlockedIssueCount > 0 &&
        epic.progress.readyIssueCount === 0 &&
        epic.progress.activeIssueCount === 0
      ) {
        return {
          label: "Waiting",
          summary: "Waiting on internal dependencies.",
          category: "ready",
        } satisfies CoordinatorStatusDescription;
      }
      return {
        label: "Ready",
        summary:
          latestRun?.status === "stopped"
            ? "The latest run was stopped. Start a new run to continue."
            : latestRun?.status === "completed"
              ? "The latest run completed. Start a new run if more work remains."
              : "Tracker is ready for a run.",
        category: "ready",
      } satisfies CoordinatorStatusDescription;
    case "unknown":
      return {
        label: "Unavailable",
        summary: epic.trackerLoadDetail ?? "Tracker state is unavailable.",
        category: "loading",
      } satisfies CoordinatorStatusDescription;
  }
}

function progressPercent(epic: BeadsCoordinatorEpicSnapshot): number | null {
  const total = epic.progress.totalIssueCount;
  if (total === 0) return null;
  return Math.round((epic.progress.completedIssueCount / total) * 100);
}

function formatRunStatus(status: OrchestrationSwarmRun["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
  }
}

function runStatusBadgeVariant(
  status: OrchestrationSwarmRun["status"],
): "success" | "error" | "warning" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "warning";
    case "stopping":
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoordinatorTab(props: CoordinatorTabProps) {
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
  const coordinatorActions = useEpicCoordinatorActionRunner({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: project ? resolveDefaultModelSelection(project.defaultModelSelection) : null,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    onOpenThread: props.onOpenThread,
    onOpenCoordinator: props.onSelectEpic,
  });

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
              cwd={props.cwd}
              epic={effectiveSelectedEpic}
              busyActionKey={coordinatorActions.busyActionKey}
              onOpenEpicIssue={props.onOpenEpicIssue}
              onOpenThread={props.onOpenThread}
              onRunAction={(action) => void coordinatorActions.runAction(action)}
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
            <p
              className={cn(
                "truncate text-sm font-medium text-foreground",
                epic.issue !== null && isIssueDoneStatus(epic.issue.status) && "line-through",
              )}
            >
              {epic.epicTitle}
            </p>
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
  cwd: string;
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
  const summary = epic.progress;
  const validation = epic.validation;
  const activeRun = getActiveRun(epic);
  const latestRun = getLatestRun(epic);

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
              <h2
                className={cn(
                  "text-lg font-semibold text-foreground",
                  epic.issue !== null && isIssueDoneStatus(epic.issue.status) && "line-through",
                )}
              >
                {epic.epicTitle}
              </h2>
              <EpicIssueLink epicId={epic.epicId} onOpenEpicIssue={props.onOpenEpicIssue} />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("text-sm font-medium", LABEL_CLASSES[color])}>{desc.label}</span>
              <span className="text-sm text-muted-foreground">{desc.summary}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  color === "red"
                    ? "error"
                    : color === "amber"
                      ? "warning"
                      : color === "blue"
                        ? "info"
                        : color === "green"
                          ? "success"
                          : "neutral"
                }
                size="sm"
              >
                Tracker: {desc.label}
              </Badge>
              {activeRun ? (
                <Badge variant={runStatusBadgeVariant(activeRun.status)} size="sm">
                  Active run: {formatRunStatus(activeRun.status)}
                </Badge>
              ) : latestRun ? (
                <Badge variant={runStatusBadgeVariant(latestRun.status)} size="sm">
                  Latest run: {formatRunStatus(latestRun.status)}
                </Badge>
              ) : (
                <Badge variant="neutral" size="sm">
                  No runs
                </Badge>
              )}
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

      {epic.validationState === "invalid" ? (
        <div className="space-y-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5">
          <div className="text-sm font-medium text-foreground">Invalid to start</div>
          <div className="space-y-1 text-sm text-muted-foreground">
            {(epic.validationErrors.length > 0
              ? epic.validationErrors
              : ["This epic is not currently valid to start."]
            ).map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        </div>
      ) : null}

      {/* Progress bar */}
      {summary.totalIssueCount > 0 ? (
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
                {summary.externalBlockedIssueCount > 0
                  ? `${summary.externalBlockedIssueCount} external blocked`
                  : summary.unknownBlockedIssueCount > 0
                    ? `${summary.unknownBlockedIssueCount} unknown blocked`
                    : `${summary.internalBlockedIssueCount} internal blocked`}
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

      {/* Project conflict warning */}
      {epic.projectConflict ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
          <p className="min-w-0 flex-1 text-foreground">{epic.projectConflict.message}</p>
        </div>
      ) : null}

      {/* Latest run error */}
      {latestRun?.failureContext?.message && desc.category === "blocked" ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          {latestRun.failureContext.message}
        </div>
      ) : null}

      {/* Validation messages */}
      {validation && (validation.errors.length > 0 || validation.warnings.length > 0) ? (
        <ValidationMessages validation={validation} />
      ) : null}

      {/* Unified work graph */}
      <WorkGraph cwd={props.cwd} epic={epic} onOpenThread={props.onOpenThread} />
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
  const run = getActiveRun(epic);
  const primaryAction = epic.primaryAction as typeof epic.primaryAction & {
    kind:
      | "checking"
      | "unsupported"
      | "open_coordination_prep_thread"
      | "refresh_swarm_state"
      | "start_swarm"
      | "stop_swarm"
      | "open_coordinator";
  };
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
    case "stop_swarm":
      if (run) {
        actions.push({
          key: `stop:${run.runId}`,
          label: primaryAction.label,
          busyLabel: primaryAction.busyLabel,
          disabled: primaryAction.disabled,
          variant: "destructive-outline",
          icon: <XIcon className="size-3" />,
          onClick: () => props.onRunAction({ kind: "stop_swarm", runId: run.runId }),
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
    case "unsupported":
      break;
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

// ---------------------------------------------------------------------------
// Detail section wrapper
// ---------------------------------------------------------------------------

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
