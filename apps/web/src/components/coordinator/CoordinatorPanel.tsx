import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorEpicStateKind,
  BeadsSwarmSupport,
  OrchestrationSwarmRun,
  ThreadId,
} from "@t3tools/contracts";
import { describeCoordinatorEpicState } from "@t3tools/shared/swarm";
import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";

import { partitionCoordinatorEpics } from "~/issuePanel";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoordinatorCardData extends BeadsCoordinatorEpicSnapshot {
  activeWorkerThreadTitle: string | null;
}

export interface CoordinatorPanelProps {
  swarmSupport: BeadsSwarmSupport | null;
  swarmSupportPending: boolean;
  swarmSupportError: Error | null;
  cards: ReadonlyArray<CoordinatorCardData>;
  cardsPending: boolean;
  cardsError: Error | null;
  timestampFormat: string;
  swarmActionKey: string | null;
  onOpenEpic: (epicId: string) => void;
  onSelectIssue: (issueId: string) => void;
  onOpenWorkerThread: (threadId: ThreadId) => void;
  onOpenCoordinationPrepThread: (epicId: string) => void;
  onOpenStartSwarm: (card: CoordinatorCardData) => void;
  onContinueRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onRefreshSwarmStatus: (epicId: string) => void;
  onPauseRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onResumeRun: (runId: OrchestrationSwarmRun["runId"]) => void;
  onCancelRun: (runId: OrchestrationSwarmRun["runId"]) => void;
}

// ---------------------------------------------------------------------------
// Partitioning helpers (from issuePanel.ts)
// ---------------------------------------------------------------------------

function compareCoordinatorCards(left: CoordinatorCardData, right: CoordinatorCardData): number {
  const leftRank = stateRank(left.stateKind);
  const rightRank = stateRank(right.stateKind);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftTs = left.latestRun?.updatedAt ?? "";
  const rightTs = right.latestRun?.updatedAt ?? "";
  const tsDelta = rightTs.localeCompare(leftTs);
  if (tsDelta !== 0) return tsDelta;

  return left.epicTitle.localeCompare(right.epicTitle);
}

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

// ---------------------------------------------------------------------------
// Status styling
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

const CARD_BORDER_CLASSES: Record<StatusColor, string> = {
  red: "border-destructive/25",
  amber: "border-warning/25",
  green: "border-success/25",
  blue: "border-info/25",
  gray: "border-border/60",
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function CoordinatorPanel(props: CoordinatorPanelProps) {
  const sorted = useMemo(() => [...props.cards].toSorted(compareCoordinatorCards), [props.cards]);
  const sections = useMemo(() => partitionCoordinatorEpics(sorted), [sorted]);
  const totalCards =
    sections.needsAttention.length + sections.active.length + sections.history.length;

  if (props.swarmSupportPending) {
    return <PanelMessage>Loading coordinator...</PanelMessage>;
  }

  if (props.swarmSupportError) {
    return <PanelMessage variant="error">{props.swarmSupportError.message}</PanelMessage>;
  }

  if (props.swarmSupport?.supported === false) {
    return (
      <PanelMessage>
        Coordinator is unavailable for this backend.
        {props.swarmSupport.reason ? (
          <span className="block mt-1 text-muted-foreground">{props.swarmSupport.reason}</span>
        ) : null}
      </PanelMessage>
    );
  }

  if (props.cardsPending) {
    return <PanelMessage>Loading epics...</PanelMessage>;
  }

  if (props.cardsError) {
    return <PanelMessage variant="error">{props.cardsError.message}</PanelMessage>;
  }

  if (totalCards === 0) {
    return <PanelMessage>No epics or swarm history found for this project.</PanelMessage>;
  }

  return (
    <div
      role="tabpanel"
      aria-label="Coordinator"
      className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
    >
      <Section
        label="Needs Attention"
        count={sections.needsAttention.length}
        emptyText="Nothing needs attention."
      >
        {sections.needsAttention.map((card) => (
          <EpicCard key={card.epicId} card={card} {...props} />
        ))}
      </Section>

      <Section label="Active" count={sections.active.length} emptyText="No active swarm runs.">
        {sections.active.map((card) => (
          <EpicCard key={card.epicId} card={card} {...props} />
        ))}
      </Section>

      <Section
        label="History"
        count={sections.history.length}
        emptyText="No completed or cancelled runs."
        defaultCollapsed={sections.needsAttention.length + sections.active.length > 0}
      >
        {sections.history.map((card) => (
          <EpicCard key={card.epicId} card={card} {...props} />
        ))}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

function Section(props: {
  label: string;
  count: number;
  emptyText: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);

  return (
    <section className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3 text-muted-foreground shrink-0" />
        )}
        <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
          {props.label}
        </h3>
        <span className="text-xs text-muted-foreground/60">({props.count})</span>
      </button>
      {!collapsed &&
        (props.count > 0 ? (
          <div className="space-y-2">{props.children}</div>
        ) : (
          <p className="pl-5 text-sm text-muted-foreground">{props.emptyText}</p>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Epic card
// ---------------------------------------------------------------------------

function EpicCard(
  props: {
    card: CoordinatorCardData;
  } & Omit<
    CoordinatorPanelProps,
    | "cards"
    | "cardsPending"
    | "cardsError"
    | "swarmSupport"
    | "swarmSupportPending"
    | "swarmSupportError"
  >,
) {
  const { card } = props;
  const desc = describeCoordinatorEpicState({
    stateKind: card.stateKind,
    lastError: card.latestRun?.lastError ?? card.activeExecution?.lastError ?? null,
    fetchDetail: card.fetchLifecycle.detail,
    activeWorkerCount: card.swarmSummary?.activeWorkerCount ?? 0,
    completedIssueCount: card.swarmSummary?.completedIssueCount ?? 0,
    totalIssueCount: card.swarmSummary?.totalIssueCount ?? 0,
  });

  const color = categoryColor(desc.category);
  const latestRun = card.latestRun;

  return (
    <div className={cn("rounded-xl border p-3.5", CARD_BORDER_CLASSES[color])}>
      {/* Row 1: Status dot + label | Epic title */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{card.epicTitle}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[color])}
              aria-hidden
            />
            <span className={cn("font-medium", LABEL_CLASSES[color])}>{desc.label}</span>
            <span className="text-muted-foreground/50 select-none">&middot;</span>
            <span className="text-muted-foreground truncate">{desc.summary}</span>
          </div>
        </div>
      </div>

      {/* Progress bar (only when there are issues to track) */}
      {card.swarmSummary && card.swarmSummary.totalIssueCount > 0 ? (
        <ProgressRow
          completed={card.swarmSummary.completedIssueCount}
          active={card.swarmSummary.activeIssueCount}
          ready={card.swarmSummary.readyIssueCount}
          blocked={card.swarmSummary.blockedIssueCount}
          total={card.swarmSummary.totalIssueCount}
          workers={card.swarmSummary.activeWorkerCount}
        />
      ) : null}

      {/* Active worker callout */}
      {card.activeExecution ? (
        <ActiveWorkerRow
          execution={card.activeExecution}
          workerTitle={card.activeWorkerThreadTitle}
          timestampFormat={props.timestampFormat}
          onOpenThread={
            card.activeExecution.workerThreadId != null
              ? () => props.onOpenWorkerThread(card.activeExecution!.workerThreadId!)
              : null
          }
        />
      ) : null}

      {/* Project conflict warning */}
      {card.projectConflict ? (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-2.5 py-2 text-xs">
          <AlertTriangleIcon className="size-3 shrink-0 text-warning-foreground mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-foreground">{card.projectConflict.message}</p>
          </div>
        </div>
      ) : null}

      {/* Error detail */}
      {latestRun?.lastError && desc.category === "blocked" ? (
        <div className="mt-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          {latestRun.lastError}
        </div>
      ) : null}

      {/* Actions row: secondary actions left, primary action right */}
      <CardActions card={card} panelProps={props} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar row
// ---------------------------------------------------------------------------

function ProgressRow(props: {
  completed: number;
  active: number;
  ready: number;
  blocked: number;
  total: number;
  workers: number;
}) {
  const pct = props.total > 0 ? (props.completed / props.total) * 100 : 0;

  return (
    <div className="mt-2.5 space-y-1">
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-success transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>
          {props.completed}/{props.total} done
        </span>
        {props.active > 0 && <span>{props.active} active</span>}
        {props.ready > 0 && <span>{props.ready} ready</span>}
        {props.blocked > 0 && <span className="text-destructive">{props.blocked} blocked</span>}
        {props.workers > 0 && (
          <span>
            {props.workers} worker{props.workers !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active worker callout
// ---------------------------------------------------------------------------

function ActiveWorkerRow(props: {
  execution: NonNullable<CoordinatorCardData["activeExecution"]>;
  workerTitle: string | null;
  timestampFormat: string;
  onOpenThread: (() => void) | null;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs">
      <span className="size-1.5 shrink-0 rounded-full bg-info animate-pulse" />
      <span className="min-w-0 truncate text-foreground">
        Working on <span className="font-medium">{props.execution.issueId}</span>
        {props.workerTitle ? ` (${props.workerTitle})` : null}
      </span>
      {props.onOpenThread ? (
        <button
          type="button"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
          onClick={props.onOpenThread}
          aria-label="Open worker thread"
        >
          <ExternalLinkIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card actions
//
// Design rule: primary action goes bottom-right. Secondary / destructive
// actions go bottom-left. This follows standard card action conventions.
// ---------------------------------------------------------------------------

type CardActionsCallbacks = Omit<
  CoordinatorPanelProps,
  | "cards"
  | "cardsPending"
  | "cardsError"
  | "swarmSupport"
  | "swarmSupportPending"
  | "swarmSupportError"
>;

function CardActions(props: { card: CoordinatorCardData; panelProps: CardActionsCallbacks }) {
  const { card } = props;
  const { swarmActionKey } = props.panelProps;
  const p = props.panelProps;
  const latestRun = card.latestRun;

  // Build action key references for busy state
  const refreshKey = `refresh:${card.epicId}`;
  const prepKey = `prep:${card.epicId}`;
  const startKey = `start:${card.epicId}`;
  const continueKey = latestRun ? `continue:${latestRun.runId}` : null;
  const pauseKey = latestRun ? `pause:${latestRun.runId}` : null;
  const resumeKey = latestRun ? `resume:${latestRun.runId}` : null;
  const cancelKey = latestRun ? `cancel:${latestRun.runId}` : null;

  // Determine primary action (the main thing the user should do)
  const primary = resolvePrimaryAction(card, p);
  // Determine secondary actions (open epic, view history, etc.)
  const secondary = resolveSecondaryActions(card, p);
  // Determine destructive action (cancel)
  const destructive = resolveDestructiveAction(card, p);

  const anyAction = primary || secondary.length > 0 || destructive;
  if (!anyAction) return null;

  function isBusy(key: string | null | undefined): boolean {
    return key != null && swarmActionKey === key;
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      {/* Left side: secondary and destructive */}
      <div className="flex flex-wrap items-center gap-1.5">
        {secondary.map((action) => (
          <Button
            key={action.key}
            type="button"
            size="xs"
            variant="outline"
            disabled={isBusy(action.busyKey)}
            onClick={action.onClick}
          >
            {isBusy(action.busyKey) ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : action.icon ? (
              <action.icon className="size-3" />
            ) : null}
            {isBusy(action.busyKey) ? action.busyLabel : action.label}
          </Button>
        ))}
        {destructive ? (
          <Button
            type="button"
            size="xs"
            variant="destructive-outline"
            disabled={isBusy(destructive.busyKey)}
            onClick={destructive.onClick}
          >
            {isBusy(destructive.busyKey) ? "Cancelling..." : "Cancel"}
          </Button>
        ) : null}
      </div>

      {/* Spacer pushes primary to the right */}
      <div className="flex-1" />

      {/* Right side: primary action */}
      {primary ? (
        <Button
          type="button"
          size="xs"
          variant={primary.variant ?? "default"}
          disabled={isBusy(primary.busyKey) || primary.disabled}
          onClick={primary.onClick}
        >
          {isBusy(primary.busyKey) ? (
            <>
              <Loader2Icon className="size-3 animate-spin" />
              {primary.busyLabel}
            </>
          ) : (
            primary.label
          )}
        </Button>
      ) : null}
    </div>
  );

  // --- Action resolution ---

  function resolvePrimaryAction(c: CoordinatorCardData, p: CardActionsCallbacks): ActionDef | null {
    const run = c.latestRun;
    const conflict = c.projectConflict;

    // Fetch-failure states: retry
    if (c.stateKind === "error" || c.stateKind === "timeout" || c.stateKind === "stale") {
      return {
        key: "retry",
        label: c.stateKind === "stale" ? "Refresh" : "Retry",
        busyLabel: c.stateKind === "stale" ? "Refreshing..." : "Retrying...",
        busyKey: refreshKey,
        icon: RefreshCwIcon,
        onClick: () => p.onRefreshSwarmStatus(c.epicId),
      };
    }

    // Setup states
    if (c.stateKind === "needs_preparation") {
      return {
        key: "prep",
        label: "Open prep thread",
        busyLabel: "Opening...",
        busyKey: prepKey,
        onClick: () => p.onOpenCoordinationPrepThread(c.epicId),
      };
    }

    // Ready to start
    if (c.stateKind === "ready" && !conflict) {
      return {
        key: "start",
        label: "Start swarm",
        busyLabel: "Starting...",
        busyKey: startKey,
        onClick: () => p.onOpenStartSwarm(c),
      };
    }

    // Idle semi-automatic: continue
    if (run?.status === "idle" && run.schedulerMode === "semi-automatic") {
      return {
        key: "continue",
        label: "Continue",
        busyLabel: "Continuing...",
        busyKey: continueKey,
        onClick: () => p.onContinueRun(run.runId),
      };
    }

    // Blocked with worker failure: continue (recovery)
    if (run?.status === "blocked" && run.blockedContext?.kind === "worker_failure") {
      return {
        key: "continue",
        label: "Continue swarm",
        busyLabel: "Continuing...",
        busyKey: continueKey,
        onClick: () => p.onContinueRun(run.runId),
      };
    }

    // Paused: resume
    if (run?.status === "paused" && !conflict) {
      return {
        key: "resume",
        label: "Resume",
        busyLabel: "Resuming...",
        busyKey: resumeKey,
        onClick: () => p.onResumeRun(run.runId),
      };
    }

    // Failed: use server-computed recovery action
    if (c.stateKind === "failed" && c.primaryAction) {
      const pa = c.primaryAction;
      if (pa.kind === "open_coordination_prep_thread") {
        return {
          key: "failed-prep",
          label: pa.label,
          busyLabel: pa.busyLabel,
          busyKey: prepKey,
          disabled: pa.disabled,
          onClick: () => p.onOpenCoordinationPrepThread(c.epicId),
        };
      }
      if (pa.kind === "start_swarm") {
        return {
          key: "failed-retry",
          label: pa.label,
          busyLabel: pa.busyLabel,
          busyKey: startKey,
          disabled: pa.disabled,
          onClick: () => p.onOpenStartSwarm(c),
        };
      }
      if (pa.kind === "refresh_swarm_state") {
        return {
          key: "failed-refresh",
          label: pa.label,
          busyLabel: pa.busyLabel,
          busyKey: refreshKey,
          disabled: pa.disabled,
          icon: RefreshCwIcon,
          onClick: () => p.onRefreshSwarmStatus(c.epicId),
        };
      }
    }

    // Running with no active execution: show pause as primary
    if (run?.status === "running" && !c.activeExecution) {
      return {
        key: "pause",
        label: "Pause",
        busyLabel: "Pausing...",
        busyKey: pauseKey,
        variant: "outline" as const,
        onClick: () => p.onPauseRun(run.runId),
      };
    }

    return null;
  }

  function resolveSecondaryActions(c: CoordinatorCardData, p: CardActionsCallbacks): ActionDef[] {
    const actions: ActionDef[] = [];

    // Open epic is always available
    actions.push({
      key: "open-epic",
      label: "Open epic",
      onClick: () => p.onOpenEpic(c.epicId),
    });

    // Open failed worker thread when blocked
    if (
      c.latestRun?.status === "blocked" &&
      c.latestRun.blockedContext?.kind === "worker_failure" &&
      c.latestRun.blockedContext.workerThreadId
    ) {
      const workerThreadId = c.latestRun.blockedContext.workerThreadId;
      actions.push({
        key: "open-failed-worker",
        label: "Open failed worker",
        icon: ExternalLinkIcon,
        onClick: () => p.onOpenWorkerThread(workerThreadId),
      });
    }

    // Project conflict: open conflicting swarm
    if (c.projectConflict) {
      actions.push({
        key: "open-conflict",
        label: "View active swarm",
        onClick: () => p.onOpenEpic(c.projectConflict!.run.epicIssueId),
      });
    }

    return actions;
  }

  function resolveDestructiveAction(
    c: CoordinatorCardData,
    p: CardActionsCallbacks,
  ): ActionDef | null {
    const run = c.latestRun;
    if (
      !run ||
      run.status === "cancelled" ||
      run.status === "completed" ||
      run.status === "failed"
    ) {
      return null;
    }
    return {
      key: "cancel",
      label: "Cancel",
      busyLabel: "Cancelling...",
      busyKey: cancelKey,
      onClick: () => p.onCancelRun(run.runId),
    };
  }
}

interface ActionDef {
  key: string;
  label: string;
  busyLabel?: string;
  busyKey?: string | null;
  disabled?: boolean;
  variant?: "default" | "outline" | "destructive-outline";
  icon?: React.FC<{ className?: string }>;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// Panel message (loading, error, empty states)
// ---------------------------------------------------------------------------

function PanelMessage(props: { variant?: "error"; children: ReactNode }) {
  return (
    <div role="tabpanel" aria-label="Coordinator" className="min-h-0 flex-1 px-4 py-6">
      <p
        className={cn(
          "text-sm",
          props.variant === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {props.children}
      </p>
    </div>
  );
}
