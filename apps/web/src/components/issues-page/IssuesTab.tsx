import type { BeadsIssueSummary, ThreadId } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { formatShortTimestamp } from "~/timestampFormat";

type IssuesTabProps = {
  cwd: string;
  issues: readonly BeadsIssueSummary[];
  issuesPending: boolean;
  issuesError: Error | null;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string | null) => void;
  onOpenThread: (threadId: ThreadId) => void;
};

export function IssuesTab(props: IssuesTabProps) {
  void props.cwd;
  void props.onOpenThread;

  if (props.issuesPending) {
    return <div className="p-4 text-sm text-muted-foreground">Loading issues...</div>;
  }

  if (props.issuesError) {
    return <div className="p-4 text-sm text-destructive">{props.issuesError.message}</div>;
  }

  if (props.issues.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No issues found.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="space-y-2">
        {props.issues.map((issue) => {
          const selected = props.selectedIssueId === issue.id;
          return (
            <button
              key={issue.id}
              type="button"
              onClick={() => props.onSelectIssue(selected ? null : issue.id)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">{issue.id}</div>
                  <div className="truncate text-sm font-medium text-foreground">{issue.title}</div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {formatShortTimestamp(issue.updatedAt, "locale")}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{issue.status}</span>
                <span>{issue.issueType}</span>
                {issue.priority !== null ? <span>P{issue.priority}</span> : null}
              </div>
              {selected ? (
                <div className="mt-2">
                  <Button size="xs" variant="outline" onClick={() => props.onSelectIssue(null)}>
                    Clear selection
                  </Button>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
