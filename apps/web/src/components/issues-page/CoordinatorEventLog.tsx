import type {
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo, useRef } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  InfoIcon,
  OctagonAlertIcon,
} from "lucide-react";

import {
  deriveCoordinatorEventLog,
  type CoordinatorLogEntry,
  type CoordinatorLogEntryTone,
} from "~/lib/coordinatorEventLog";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type CoordinatorEventLogProps = {
  runs: readonly OrchestrationSwarmRun[];
  executions: readonly OrchestrationSwarmTaskExecution[];
  onOpenThread: (threadId: ThreadId) => void;
};

// ---------------------------------------------------------------------------
// Icon helper
// ---------------------------------------------------------------------------

function LogEntryIcon(props: { tone: CoordinatorLogEntryTone }) {
  switch (props.tone) {
    case "success":
      return <CheckCircle2Icon className="size-3 text-success-foreground" />;
    case "error":
      return <OctagonAlertIcon className="size-3 text-destructive" />;
    case "warning":
      return <AlertTriangleIcon className="size-3 text-warning-foreground" />;
    case "info":
      return <InfoIcon className="size-3 text-muted-foreground" />;
  }
}

function toneTextClass(tone: CoordinatorLogEntryTone): string {
  switch (tone) {
    case "success":
      return "text-success-foreground";
    case "error":
      return "text-destructive";
    case "warning":
      return "text-warning-foreground";
    case "info":
      return "text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoordinatorEventLog(props: CoordinatorEventLogProps) {
  const entries = useMemo(
    () => deriveCoordinatorEventLog(props.runs, props.executions),
    [props.runs, props.executions],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(entries.length);

  // Auto-scroll to bottom when new entries arrive.
  if (entries.length !== prevCountRef.current) {
    prevCountRef.current = entries.length;
    // Schedule scroll after render.
    queueMicrotask(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  }

  return (
    <div ref={scrollRef} className="max-h-64 overflow-y-auto rounded-md border border-border/40">
      <div className="divide-y divide-border/20">
        {entries.map((entry) => (
          <LogEntryRow key={entry.key} entry={entry} onOpenThread={props.onOpenThread} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function LogEntryRow(props: {
  entry: CoordinatorLogEntry;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { entry } = props;

  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5">
      <span className="mt-0.5 shrink-0">
        <LogEntryIcon tone={entry.tone} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs", toneTextClass(entry.tone))}>{entry.summary}</span>
          {entry.workerThreadId ? (
            <button
              type="button"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => props.onOpenThread(entry.workerThreadId!)}
              aria-label="Open worker thread"
            >
              <ExternalLinkIcon className="size-3" />
            </button>
          ) : null}
        </div>
        {entry.detail ? (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{entry.detail}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">
        {formatRelativeTimeLabel(entry.timestamp)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact variant for use inside WorkGraph row detail
// ---------------------------------------------------------------------------

export function CoordinatorEventLogCompact(props: {
  entries: readonly CoordinatorLogEntry[];
  maxEntries?: number;
}) {
  const entries = props.maxEntries ? props.entries.slice(-props.maxEntries) : props.entries;
  if (entries.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {entries.map((entry) => (
        <div key={entry.key} className="flex items-center gap-1.5 text-[11px]">
          <LogEntryIcon tone={entry.tone} />
          <span className={toneTextClass(entry.tone)}>{entry.summary}</span>
          <span className="ml-auto tabular-nums text-muted-foreground/50">
            {formatRelativeTimeLabel(entry.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
}
