import type {
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ThreadId,
} from "@t3tools/contracts";

import {
  deriveProgressFromExecutions,
  formatRunStatus,
  isActiveExecutionStatus,
  runStatusBadgeVariant,
  summarizeExecution,
  summarizeRun,
} from "~/lib/epicRunPresentation";
import { StatusIndicator } from "./shared/StatusIndicator";

export interface RunViewMessage {
  readonly id: string;
  readonly text: string;
}

export interface RunViewProps {
  readonly run: OrchestrationEpicRun | null;
  readonly executions: readonly OrchestrationEpicIssueExecution[];
  readonly issueTitlesById?: Readonly<Record<string, string>> | undefined;
  readonly activeMessages?: readonly RunViewMessage[] | undefined;
  readonly activeThreadId?: ThreadId | null | undefined;
}

function issueTitleFor(
  issueTitlesById: Readonly<Record<string, string>> | undefined,
  issueId: string,
): string {
  return issueTitlesById?.[issueId] ?? issueId;
}

export function RunView({
  run,
  executions,
  issueTitlesById,
  activeMessages = [],
  activeThreadId = null,
}: RunViewProps) {
  if (run === null) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Run not found.</p>
      </section>
    );
  }

  const progress = deriveProgressFromExecutions({ executions });
  const activeExecution =
    executions.find((execution) => isActiveExecutionStatus(execution.status)) ?? null;
  const latestFinishedExecution =
    [...executions]
      .filter((execution) => !isActiveExecutionStatus(execution.status))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const summary = summarizeRun({ run, progress });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5 p-5">
      <header className="space-y-2 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Run {run.runId}</h1>
          <StatusIndicator variant={runStatusBadgeVariant(run.status)} size="sm">
            {formatRunStatus(run.status)}
          </StatusIndicator>
        </div>
        <p className="text-sm text-muted-foreground">
          {summary ?? `${progress.completedIssueCount}/${progress.totalIssueCount} issues done`}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Issue executions</h2>
        {executions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No executions have been recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {executions.map((execution) => (
              <li
                key={execution.executionId}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm text-foreground">
                  {issueTitleFor(issueTitlesById, execution.issueId)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {summarizeExecution(execution) ?? execution.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Live feed</h2>
        {activeExecution ? (
          <div className="space-y-3 rounded-md border border-border px-3 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {issueTitleFor(issueTitlesById, activeExecution.issueId)}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeThreadId
                  ? `Open in thread view: ${activeThreadId}`
                  : "Waiting for worker thread output."}
              </p>
            </div>
            {activeMessages.length > 0 ? (
              <ul className="space-y-1">
                {activeMessages.map((message) => (
                  <li key={message.id} className="text-sm text-muted-foreground">
                    {message.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No live output yet.</p>
            )}
          </div>
        ) : latestFinishedExecution ? (
          <p className="text-sm text-muted-foreground">
            Latest update: {summarizeExecution(latestFinishedExecution)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No active execution.</p>
        )}
      </section>
    </section>
  );
}
