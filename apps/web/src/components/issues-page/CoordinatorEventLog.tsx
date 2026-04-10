import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon, OctagonAlertIcon } from "lucide-react";

import { type CoordinatorLogEntry, type CoordinatorLogEntryTone } from "~/lib/coordinatorEventLog";
import { formatRelativeTimeLabel } from "~/timestampFormat";

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
// Compact event log for use inside WorkGraph sections and row detail
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
