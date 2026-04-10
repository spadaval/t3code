import type {
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ThreadId,
} from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoordinatorLogEntryTone = "info" | "error" | "success" | "warning";

export interface CoordinatorLogEntry {
  /** Unique key for React rendering. */
  readonly key: string;
  /** ISO timestamp for ordering and display. */
  readonly timestamp: string;
  /** Machine-readable event kind. */
  readonly kind: string;
  /** Human-readable one-line summary. */
  readonly summary: string;
  /** Optional detail (e.g. error message). */
  readonly detail?: string | undefined;
  /** Visual tone for color / icon selection. */
  readonly tone: CoordinatorLogEntryTone;
  /** Associated run ID (for grouping / filtering). */
  readonly runId?: string | undefined;
  /** Associated execution ID. */
  readonly executionId?: string | undefined;
  /** Issue being worked on. */
  readonly issueId?: string | undefined;
  /** Worker thread the user can navigate to. */
  readonly workerThreadId?: ThreadId | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startIso: string, endIso: string): string {
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

function formatSchedulerMode(mode: OrchestrationSwarmRun["schedulerMode"]): string {
  return mode === "semi-automatic" ? "semi-automatic" : "automatic";
}

// ---------------------------------------------------------------------------
// Run lifecycle entries
// ---------------------------------------------------------------------------

export function runEntries(run: OrchestrationSwarmRun): CoordinatorLogEntry[] {
  const entries: CoordinatorLogEntry[] = [];
  const base = { runId: run.runId };

  entries.push({
    ...base,
    key: `run-requested:${run.runId}`,
    timestamp: run.requestedAt,
    kind: "run.requested",
    summary: `Run requested (${formatSchedulerMode(run.schedulerMode)})`,
    tone: "info",
  });

  if (run.startedAt) {
    entries.push({
      ...base,
      key: `run-started:${run.runId}`,
      timestamp: run.startedAt,
      kind: "run.started",
      summary: "Run started",
      tone: "info",
    });
  }

  if (run.idledAt) {
    entries.push({
      ...base,
      key: `run-idled:${run.runId}`,
      timestamp: run.idledAt,
      kind: "run.idled",
      summary: "Run idle — waiting for manual trigger",
      tone: "info",
    });
  }

  if (run.pausedAt) {
    entries.push({
      ...base,
      key: `run-paused:${run.runId}`,
      timestamp: run.pausedAt,
      kind: "run.paused",
      summary: "Run paused by user",
      tone: "warning",
    });
  }

  if (run.blockedAt) {
    const reason =
      run.blockedContext?.kind === "worker_failure"
        ? "Worker failed"
        : run.blockedContext?.kind === "tracker_waiting"
          ? "Waiting on tracker"
          : "Manual intervention needed";
    entries.push({
      ...base,
      key: `run-blocked:${run.runId}`,
      timestamp: run.blockedAt,
      kind: "run.blocked",
      summary: `Run blocked: ${reason}`,
      detail: run.lastError ?? undefined,
      tone: "error",
      issueId: run.blockedContext?.issueId ?? undefined,
      executionId: run.blockedContext?.executionId ?? undefined,
      workerThreadId: (run.blockedContext?.workerThreadId as ThreadId) ?? undefined,
    });
  }

  if (run.failedAt) {
    entries.push({
      ...base,
      key: `run-failed:${run.runId}`,
      timestamp: run.failedAt,
      kind: "run.failed",
      summary: "Run failed",
      detail: run.lastError ?? undefined,
      tone: "error",
    });
  }

  if (run.cancelledAt) {
    entries.push({
      ...base,
      key: `run-cancelled:${run.runId}`,
      timestamp: run.cancelledAt,
      kind: "run.cancelled",
      summary: "Run cancelled",
      tone: "warning",
    });
  }

  if (run.completedAt) {
    const duration = run.startedAt ? ` (${formatDuration(run.startedAt, run.completedAt)})` : "";
    entries.push({
      ...base,
      key: `run-completed:${run.runId}`,
      timestamp: run.completedAt,
      kind: "run.completed",
      summary: `Run completed${duration}`,
      tone: "success",
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Execution lifecycle entries
// ---------------------------------------------------------------------------

export function executionEntries(exec: OrchestrationSwarmTaskExecution): CoordinatorLogEntry[] {
  const entries: CoordinatorLogEntry[] = [];
  const base = {
    runId: exec.runId,
    executionId: exec.executionId,
    issueId: exec.issueId,
    workerThreadId: (exec.workerThreadId as ThreadId) ?? undefined,
  };
  const seq = `#${exec.sequenceNumber}`;

  entries.push({
    ...base,
    key: `exec-requested:${exec.executionId}`,
    timestamp: exec.requestedAt,
    kind: "execution.requested",
    summary: `Task ${seq} requested: ${exec.issueId}`,
    tone: "info",
  });

  if (exec.startedAt) {
    entries.push({
      ...base,
      key: `exec-started:${exec.executionId}`,
      timestamp: exec.startedAt,
      kind: "execution.started",
      summary: `Task ${seq} started: ${exec.issueId}`,
      tone: "info",
    });
  }

  if (exec.completedAt) {
    const duration = exec.startedAt ? ` (${formatDuration(exec.startedAt, exec.completedAt)})` : "";
    entries.push({
      ...base,
      key: `exec-completed:${exec.executionId}`,
      timestamp: exec.completedAt,
      kind: "execution.completed",
      summary: `Task ${seq} completed: ${exec.issueId}${duration}`,
      tone: "success",
    });
  }

  if (exec.failedAt) {
    const duration = exec.startedAt ? ` (${formatDuration(exec.startedAt, exec.failedAt)})` : "";
    entries.push({
      ...base,
      key: `exec-failed:${exec.executionId}`,
      timestamp: exec.failedAt,
      kind: "execution.failed",
      summary: `Task ${seq} failed: ${exec.issueId}${duration}`,
      detail: exec.lastError ?? undefined,
      tone: "error",
    });
  }

  if (exec.cancelledAt) {
    entries.push({
      ...base,
      key: `exec-cancelled:${exec.executionId}`,
      timestamp: exec.cancelledAt,
      kind: "execution.cancelled",
      summary: `Task ${seq} cancelled: ${exec.issueId}`,
      tone: "warning",
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Derive a chronological event log from run and execution data.
 * Pure function — no side effects, no store access.
 */
export function deriveCoordinatorEventLog(
  runs: readonly OrchestrationSwarmRun[],
  executions: readonly OrchestrationSwarmTaskExecution[],
): CoordinatorLogEntry[] {
  const entries: CoordinatorLogEntry[] = [];

  for (const run of runs) {
    entries.push(...runEntries(run));
  }

  for (const exec of executions) {
    entries.push(...executionEntries(exec));
  }

  // Sort chronologically (ascending). For same timestamp, run events before
  // execution events, and requested before other lifecycle states.
  entries.sort((a, b) => {
    const tsDelta = a.timestamp.localeCompare(b.timestamp);
    if (tsDelta !== 0) return tsDelta;
    // Stable secondary: by key (deterministic).
    return a.key.localeCompare(b.key);
  });

  return entries;
}
