import type { OrchestrationEpicIssueExecution, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from "lucide-react";

import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { useWorkerThreadState } from "~/storeSelectors";
import { cn } from "~/lib/utils";
import type { TurnDiffSummary } from "~/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type ExecutionDiffSummaryProps = {
  execution: OrchestrationEpicIssueExecution;
  onOpenThread: (threadId: ThreadId) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Aggregate file changes across all turn diff summaries for a worker thread. */
function aggregateFileChanges(
  summaries: readonly TurnDiffSummary[],
): { path: string; kind: string; additions: number; deletions: number }[] {
  const fileMap = new Map<string, { kind: string; additions: number; deletions: number }>();
  for (const summary of summaries) {
    for (const file of summary.files) {
      const existing = fileMap.get(file.path);
      if (existing) {
        existing.additions += file.additions ?? 0;
        existing.deletions += file.deletions ?? 0;
      } else {
        fileMap.set(file.path, {
          kind: file.kind ?? "modified",
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
        });
      }
    }
  }
  return [...fileMap.entries()]
    .map(([path, data]) => ({ path, ...data }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

function totalStats(files: { additions: number; deletions: number }[]) {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionDiffSummary(props: ExecutionDiffSummaryProps) {
  const { execution } = props;
  const [expanded, setExpanded] = useState(false);
  const workerThreadId = execution.workerThreadId;
  const workerState = useWorkerThreadState(workerThreadId);

  const fileChanges = useMemo(
    () => aggregateFileChanges(workerState?.turnDiffSummaries ?? []),
    [workerState?.turnDiffSummaries],
  );

  // Find the latest checkpoint turn count for the full thread diff.
  const latestCheckpointTurnCount = useMemo(() => {
    const summaries = workerState?.turnDiffSummaries ?? [];
    if (summaries.length === 0) return null;
    let max = 0;
    for (const s of summaries) {
      if (s.checkpointTurnCount !== undefined && s.checkpointTurnCount > max) {
        max = s.checkpointTurnCount;
      }
    }
    return max > 0 ? max : null;
  }, [workerState?.turnDiffSummaries]);

  // Lazy-load full diff only when expanded.
  const diffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: workerThreadId,
      fromTurnCount: 0,
      toTurnCount: latestCheckpointTurnCount,
      cacheScope: `exec-${execution.executionId}`,
      enabled: expanded && latestCheckpointTurnCount !== null,
    }),
  );

  if (fileChanges.length === 0) return null;

  const stats = totalStats(fileChanges);

  return (
    <div className="space-y-1">
      {/* Collapsed summary: clickable header */}
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span>
          {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""} changed
        </span>
        {stats.additions > 0 ? (
          <span className="text-success-foreground">+{stats.additions}</span>
        ) : null}
        {stats.deletions > 0 ? <span className="text-destructive">-{stats.deletions}</span> : null}
      </button>

      {/* Expanded: file list */}
      {expanded ? (
        <div className="space-y-1 pl-5">
          {fileChanges.map((file) => (
            <div key={file.path} className="flex items-center gap-2 text-[11px]">
              <FileIcon className={cn("size-3 shrink-0", fileKindColor(file.kind))} />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">
                {file.path}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                {file.additions > 0 ? (
                  <span className="text-success-foreground">+{file.additions}</span>
                ) : null}
                {file.deletions > 0 ? (
                  <span className="text-destructive">-{file.deletions}</span>
                ) : null}
              </span>
            </div>
          ))}

          {/* Full diff text (lazy loaded) */}
          {diffQuery.isLoading ? (
            <p className="text-[11px] text-muted-foreground/50">Loading diff...</p>
          ) : diffQuery.error ? (
            <p className="text-[11px] text-destructive">{diffQuery.error.message}</p>
          ) : diffQuery.data?.diff ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                Show raw diff
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded border border-border/30 bg-muted/30 p-2 font-mono text-[10px] leading-tight text-foreground/70">
                {diffQuery.data.diff}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fileKindColor(kind: string): string {
  switch (kind) {
    case "added":
      return "text-success-foreground";
    case "deleted":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}
