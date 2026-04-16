import type { OrchestrationEpicIssueExecution, OrchestrationEpicRun } from "@t3tools/contracts";

import {
  formatRunStatus,
  isActiveRunStatus,
  summarizeExecution,
  summarizeRun,
} from "~/lib/epicRunPresentation";

export interface EpicRunsSectionProps {
  readonly runs: readonly OrchestrationEpicRun[];
  readonly executions: readonly OrchestrationEpicIssueExecution[];
  readonly issueTitlesById?: Readonly<Record<string, string>> | undefined;
  readonly historyLimit?: number | undefined;
  readonly showAllHistory?: boolean | undefined;
}

function titleFor(
  issueTitlesById: Readonly<Record<string, string>> | undefined,
  issueId: string,
): string {
  return issueTitlesById?.[issueId] ?? issueId;
}

export function EpicRunsSection({
  runs,
  executions,
  issueTitlesById,
  historyLimit = 3,
  showAllHistory = false,
}: EpicRunsSectionProps) {
  if (runs.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Runs</h2>
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      </section>
    );
  }

  const activeOrFailedRuns = runs.filter(
    (run) => isActiveRunStatus(run.status) || run.status === "failed",
  );
  const historyRuns = runs.filter((run) => !activeOrFailedRuns.includes(run));
  const visibleHistoryRuns = showAllHistory ? historyRuns : historyRuns.slice(0, historyLimit);
  const hiddenHistoryCount = Math.max(historyRuns.length - visibleHistoryRuns.length, 0);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-foreground">Runs</h2>

      {activeOrFailedRuns.length > 0 ? (
        <div className="space-y-3">
          {activeOrFailedRuns.map((run) => {
            const runExecutions = executions.filter((execution) => execution.runId === run.runId);
            return (
              <article key={run.runId} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {run.runId} · {formatRunStatus(run.status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summarizeRun({
                      run,
                      progress: {
                        activeWorkerCount: runExecutions.filter(
                          (execution) =>
                            execution.status === "running" || execution.status === "launching",
                        ).length,
                        activeIssueCount: runExecutions.filter(
                          (execution) =>
                            execution.status === "running" || execution.status === "launching",
                        ).length,
                        completedIssueCount: runExecutions.filter(
                          (execution) => execution.status === "completed",
                        ).length,
                        totalIssueCount: runExecutions.length,
                      },
                    }) ?? "No summary"}
                  </p>
                </div>
                <ul className="space-y-1">
                  {runExecutions.map((execution) => (
                    <li key={execution.executionId} className="text-sm text-muted-foreground">
                      {titleFor(issueTitlesById, execution.issueId)}:{" "}
                      {summarizeExecution(execution) ?? execution.status}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      ) : null}

      {visibleHistoryRuns.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">History</p>
          <ul className="space-y-1">
            {visibleHistoryRuns.map((run) => (
              <li key={run.runId} className="text-sm text-muted-foreground">
                {run.runId} · {formatRunStatus(run.status)}
              </li>
            ))}
          </ul>
          {hiddenHistoryCount > 0 ? (
            <p className="text-xs text-muted-foreground">Show {hiddenHistoryCount} older runs</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
