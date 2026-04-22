import type {
  BeadsCoordinatorProgress,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
} from "@t3tools/contracts";

export type StatusBadgeVariant = "success" | "error" | "warning" | "info" | "secondary";

export function isActiveRunStatus(status: OrchestrationEpicRun["status"]): boolean {
  return status === "pending" || status === "running" || status === "stopping";
}

export function isTerminalRunStatus(status: OrchestrationEpicRun["status"]): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function isActiveExecutionStatus(
  status: OrchestrationEpicIssueExecution["status"],
): boolean {
  return status === "launching" || status === "running" || status === "stopping";
}

export function isTerminalExecutionStatus(
  status: OrchestrationEpicIssueExecution["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

export function formatRunStatus(status: OrchestrationEpicRun["status"]): string {
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

export function formatExecutionStatus(status: OrchestrationEpicIssueExecution["status"]): string {
  switch (status) {
    case "launching":
      return "Launching";
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

export function runStatusBadgeVariant(status: OrchestrationEpicRun["status"]): StatusBadgeVariant {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "warning";
    case "running":
    case "stopping":
      return "info";
    case "pending":
      return "secondary";
  }
}

export function executionStatusBadgeVariant(
  status: OrchestrationEpicIssueExecution["status"],
): StatusBadgeVariant {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "warning";
    case "running":
      return "info";
    case "launching":
    case "stopping":
      return "secondary";
  }
}

export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "";
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function compareRunsByRecency(
  left: OrchestrationEpicRun,
  right: OrchestrationEpicRun,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.requestedAt.localeCompare(left.requestedAt) ||
    right.runId.localeCompare(left.runId)
  );
}

export function sortRunsByRecency(runs: readonly OrchestrationEpicRun[]): OrchestrationEpicRun[] {
  return [...runs].toSorted(compareRunsByRecency);
}

export function getLatestRun(runs: readonly OrchestrationEpicRun[]): OrchestrationEpicRun | null {
  return sortRunsByRecency(runs)[0] ?? null;
}

export function getActiveRun(input: {
  readonly runs: readonly OrchestrationEpicRun[];
  readonly activeRunId?: OrchestrationEpicRun["runId"] | null;
}): OrchestrationEpicRun | null {
  if (input.activeRunId) {
    return input.runs.find((run) => run.runId === input.activeRunId) ?? null;
  }

  return input.runs.find((run) => isActiveRunStatus(run.status)) ?? null;
}

export function shouldCollapseRunByDefault(run: Pick<OrchestrationEpicRun, "status">): boolean {
  return isTerminalRunStatus(run.status);
}

export function shouldCollapseRunHistoryByDefault(input: {
  readonly runs: readonly Pick<OrchestrationEpicRun, "status">[];
}): boolean {
  return input.runs.length > 0 && input.runs.every((run) => shouldCollapseRunByDefault(run));
}

export function summarizeRun(input: {
  readonly run: Pick<OrchestrationEpicRun, "status" | "failureContext">;
  readonly progress: Pick<
    BeadsCoordinatorProgress,
    "activeWorkerCount" | "activeIssueCount" | "completedIssueCount" | "totalIssueCount"
  >;
}): string | null {
  const { progress, run } = input;

  if (run.status === "failed") {
    return run.failureContext?.message ?? null;
  }

  if (isActiveRunStatus(run.status)) {
    if (progress.activeWorkerCount > 0) {
      return `${progress.activeWorkerCount} worker${progress.activeWorkerCount === 1 ? "" : "s"} active`;
    }
    if (progress.activeIssueCount > 0) {
      return `${progress.activeIssueCount} active issue${progress.activeIssueCount === 1 ? "" : "s"}`;
    }
  }

  if (progress.totalIssueCount > 0) {
    return `${progress.completedIssueCount}/${progress.totalIssueCount} issues done`;
  }

  return null;
}

export function summarizeExecution(
  execution: Pick<
    OrchestrationEpicIssueExecution,
    "status" | "failureContext" | "startedAt" | "completedAt" | "failedAt" | "stoppedAt"
  >,
): string | null {
  if (execution.status === "failed") {
    return execution.failureContext?.message ?? null;
  }

  const endAt = execution.completedAt ?? execution.failedAt ?? execution.stoppedAt;
  if (
    execution.startedAt !== null &&
    endAt !== null &&
    isTerminalExecutionStatus(execution.status)
  ) {
    const duration = formatDuration(execution.startedAt, endAt);
    if (duration.length > 0) {
      return `${formatExecutionStatus(execution.status)} in ${duration}`;
    }
  }

  return formatExecutionStatus(execution.status);
}

export function deriveProgressFromExecutions(input: {
  readonly executions: readonly OrchestrationEpicIssueExecution[];
}): BeadsCoordinatorProgress {
  const latestByIssueId = new Map<string, OrchestrationEpicIssueExecution>();

  for (const execution of input.executions) {
    const existing = latestByIssueId.get(execution.issueId);
    if (
      !existing ||
      execution.updatedAt > existing.updatedAt ||
      execution.sequenceNumber > existing.sequenceNumber
    ) {
      latestByIssueId.set(execution.issueId, execution);
    }
  }

  let completedIssueCount = 0;
  let activeIssueCount = 0;
  let blockedIssueCount = 0;
  for (const execution of latestByIssueId.values()) {
    if (execution.status === "completed") {
      completedIssueCount += 1;
    } else if (isActiveExecutionStatus(execution.status)) {
      activeIssueCount += 1;
    } else if (execution.status === "failed" || execution.status === "stopped") {
      blockedIssueCount += 1;
    }
  }

  return {
    totalIssueCount: latestByIssueId.size,
    completedIssueCount,
    readyIssueCount: 0,
    activeIssueCount,
    blockedIssueCount,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: blockedIssueCount,
    activeWorkerCount: activeIssueCount,
    isComplete: latestByIssueId.size > 0 && completedIssueCount >= latestByIssueId.size,
  };
}
