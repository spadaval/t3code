import type { BeadsGetSessionActivityResult, ThreadId } from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";

type ActivityTabProps = {
  cwd: string;
  entries: BeadsGetSessionActivityResult["entries"];
  entriesPending: boolean;
  entriesError: Error | null;
  onSelectIssue: (issueId: string | null) => void;
  onOpenThread: (threadId: ThreadId) => void;
};

export function ActivityTab(props: ActivityTabProps) {
  void props.cwd;

  if (props.entriesPending) {
    return <div className="p-4 text-sm text-muted-foreground">Loading activity...</div>;
  }

  if (props.entriesError) {
    return <div className="p-4 text-sm text-destructive">{props.entriesError.message}</div>;
  }

  if (props.entries.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No recent activity.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="space-y-2">
        {props.entries.map((entry) => {
          const threadId = entry.threadId ?? null;
          return (
            <div
              key={`${entry.kind}:${entry.issue.id}:${entry.createdAt}`}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => props.onSelectIssue(entry.issue.id)}
                    className="font-mono text-xs text-muted-foreground hover:underline"
                  >
                    {entry.issue.id}
                  </button>
                  <div className="truncate text-sm font-medium text-foreground">
                    {entry.issue.title}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTimeLabel(entry.createdAt)}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{entry.kind}</span>
                {entry.workflowKind ? <span>{entry.workflowKind}</span> : null}
                {threadId ? (
                  <button
                    type="button"
                    onClick={() => props.onOpenThread(threadId)}
                    className="text-info-foreground hover:underline"
                  >
                    Open thread
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
