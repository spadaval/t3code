import type {
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  ThreadId,
} from "@t3tools/contracts";

import { formatDuration } from "./epicRunPresentation";

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
// Run lifecycle entries
// ---------------------------------------------------------------------------

export function runEntries(run: OrchestrationEpicRun): CoordinatorLogEntry[] {
  const entries: CoordinatorLogEntry[] = [];
  const base = { runId: run.runId };

  entries.push({
    ...base,
    key: `run-requested:${run.runId}`,
    timestamp: run.requestedAt,
    kind: "run.requested",
    summary: "Run requested",
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

  if (run.stopRequestedAt && run.status === "stopping") {
    entries.push({
      ...base,
      key: `run-stopping:${run.runId}`,
      timestamp: run.stopRequestedAt,
      kind: "run.stopping",
      summary: "Run stopping",
      tone: "warning",
    });
  }

  if (run.failedAt) {
    entries.push({
      ...base,
      key: `run-failed:${run.runId}`,
      timestamp: run.failedAt,
      kind: "run.failed",
      summary: "Run failed",
      detail: run.failureContext?.message ?? undefined,
      tone: "error",
      issueId: run.failureContext?.issueId ?? undefined,
      executionId: run.failureContext?.executionId ?? undefined,
      workerThreadId: run.failureContext?.workerThreadId ?? undefined,
    });
  }

  if (run.stoppedAt) {
    entries.push({
      ...base,
      key: `run-stopped:${run.runId}`,
      timestamp: run.stoppedAt,
      kind: "run.stopped",
      summary: "Run stopped",
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

export function executionEntries(exec: OrchestrationEpicIssueExecution): CoordinatorLogEntry[] {
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
    summary: `Task ${seq} queued: ${exec.issueId}`,
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
      detail: exec.failureContext?.message ?? undefined,
      tone: "error",
    });
  }

  if (exec.stoppedAt) {
    entries.push({
      ...base,
      key: `exec-stopped:${exec.executionId}`,
      timestamp: exec.stoppedAt,
      kind: "execution.stopped",
      summary: `Task ${seq} stopped: ${exec.issueId}`,
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
  runs: readonly OrchestrationEpicRun[],
  executions: readonly OrchestrationEpicIssueExecution[],
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
