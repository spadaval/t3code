import type { OrchestrationSwarmTaskExecution, ThreadId } from "@t3tools/contracts";
import { useMemo, useRef } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldAlertIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";

import {
  deriveWorkerFeedEntries,
  type WorkerFeedEntry,
  type WorkerFeedEntryTone,
} from "~/lib/workerActivityFeed";
import { useWorkerThreadState } from "~/storeSelectors";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type WorkerActivityFeedProps = {
  workerThreadId: ThreadId;
  execution: OrchestrationSwarmTaskExecution;
  onOpenThread: (threadId: ThreadId) => void;
  /** Maximum entries to show. Defaults to 20. */
  maxEntries?: number;
  /** Use compact rendering (for inline use in WorkGraph rows). */
  compact?: boolean;
};

// ---------------------------------------------------------------------------
// Icon helper
// ---------------------------------------------------------------------------

function FeedEntryIcon(props: { tone: WorkerFeedEntryTone; kind: string }) {
  // Pick icon based on kind first, fall back to tone.
  if (
    props.kind === "tool.updated" ||
    props.kind === "tool.completed" ||
    props.kind === "tool.started"
  ) {
    return <WrenchIcon className="size-3 text-muted-foreground" />;
  }
  if (props.kind === "approval.requested" || props.kind === "approval.resolved") {
    return <ShieldAlertIcon className="size-3 text-warning-foreground" />;
  }
  if (props.kind === "runtime.error") {
    return <AlertTriangleIcon className="size-3 text-destructive" />;
  }
  if (props.kind === "task.progress") {
    return <Loader2Icon className="size-3 animate-spin text-info-foreground" />;
  }

  switch (props.tone) {
    case "error":
      return <AlertTriangleIcon className="size-3 text-destructive" />;
    case "approval":
      return <ShieldAlertIcon className="size-3 text-warning-foreground" />;
    case "tool":
      return <TerminalIcon className="size-3 text-muted-foreground" />;
    case "info":
      return <CheckCircle2Icon className="size-3 text-muted-foreground/60" />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkerActivityFeed(props: WorkerActivityFeedProps) {
  const workerState = useWorkerThreadState(props.workerThreadId);
  const maxEntries = props.maxEntries ?? 20;

  const feedEntries = useMemo(
    () => deriveWorkerFeedEntries(workerState?.activities ?? []),
    [workerState?.activities],
  );

  const visibleEntries = useMemo(() => feedEntries.slice(-maxEntries), [feedEntries, maxEntries]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(feedEntries.length);

  // Auto-scroll when new entries appear.
  if (feedEntries.length !== prevCountRef.current) {
    prevCountRef.current = feedEntries.length;
    queueMicrotask(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  const isRunning =
    workerState?.session?.status === "running" || workerState?.session?.status === "connecting";
  const elapsed = props.execution.startedAt
    ? formatRelativeTimeLabel(props.execution.startedAt)
    : null;

  if (props.compact) {
    return (
      <CompactWorkerFeed
        entries={visibleEntries}
        isRunning={isRunning}
        elapsed={elapsed}
        onOpenThread={() => props.onOpenThread(props.workerThreadId)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* Status header */}
      <div className="flex items-center gap-2 text-xs">
        {isRunning ? (
          <span className="flex items-center gap-1.5 text-info-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Worker active
          </span>
        ) : (
          <span className="text-muted-foreground">Worker idle</span>
        )}
        {elapsed ? <span className="text-muted-foreground/60">Started {elapsed}</span> : null}
        <span className="ml-auto text-muted-foreground/50">{feedEntries.length} events</span>
        <button
          type="button"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => props.onOpenThread(props.workerThreadId)}
        >
          <ExternalLinkIcon className="size-3" />
          <span>Open thread</span>
        </button>
      </div>

      {/* Feed */}
      {visibleEntries.length > 0 ? (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto rounded-md border border-border/40"
        >
          <div className="divide-y divide-border/20">
            {visibleEntries.map((entry) => (
              <FeedEntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Waiting for worker activity...</p>
      )}

      {/* File change summary from turn diff summaries */}
      {workerState?.turnDiffSummaries && workerState.turnDiffSummaries.length > 0 ? (
        <WorkerDiffSummary turnDiffSummaries={workerState.turnDiffSummaries} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed entry row
// ---------------------------------------------------------------------------

function FeedEntryRow(props: { entry: WorkerFeedEntry }) {
  const { entry } = props;
  return (
    <div className="flex items-start gap-2 px-2 py-1">
      <span className="mt-0.5 shrink-0">
        <FeedEntryIcon tone={entry.tone} kind={entry.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground/80">{entry.label}</p>
        {entry.detail ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{entry.detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/40">
        {formatRelativeTimeLabel(entry.createdAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact variant (for WorkGraph row detail)
// ---------------------------------------------------------------------------

function CompactWorkerFeed(props: {
  entries: readonly WorkerFeedEntry[];
  isRunning: boolean;
  elapsed: string | null;
  onOpenThread: () => void;
}) {
  if (props.entries.length === 0 && !props.isRunning) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        {props.isRunning ? (
          <span className="flex items-center gap-1 text-info-foreground">
            <Loader2Icon className="size-2.5 animate-spin" />
            Working
          </span>
        ) : null}
        {props.elapsed ? (
          <span className="text-muted-foreground/50">Started {props.elapsed}</span>
        ) : null}
        <button
          type="button"
          className="ml-auto flex items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
          onClick={props.onOpenThread}
        >
          <ExternalLinkIcon className="size-2.5" />
          <span>Thread</span>
        </button>
      </div>
      {props.entries.slice(-5).map((entry) => (
        <div key={entry.id} className="flex items-center gap-1.5 text-[11px]">
          <FeedEntryIcon tone={entry.tone} kind={entry.kind} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              entry.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {entry.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn diff summary (files changed)
// ---------------------------------------------------------------------------

function WorkerDiffSummary(props: {
  turnDiffSummaries: readonly {
    files: readonly {
      path: string;
      additions?: number | undefined;
      deletions?: number | undefined;
    }[];
  }[];
}) {
  const totalFiles = new Set<string>();
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const summary of props.turnDiffSummaries) {
    for (const file of summary.files) {
      totalFiles.add(file.path);
      totalAdditions += file.additions ?? 0;
      totalDeletions += file.deletions ?? 0;
    }
  }

  if (totalFiles.size === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        {totalFiles.size} file{totalFiles.size !== 1 ? "s" : ""} changed
      </span>
      {totalAdditions > 0 ? (
        <span className="text-success-foreground">+{totalAdditions}</span>
      ) : null}
      {totalDeletions > 0 ? <span className="text-destructive">-{totalDeletions}</span> : null}
    </div>
  );
}
