import type {
  BeadsEpicCoordinationSummary,
  BeadsCoordinatorLoadState,
  BeadsCoordinatorState,
  BeadsCoordinatorValidationState,
  BeadsIssueRelationSummary,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsEpicCommand,
  BeadsEpicExecution,
  OrchestrationEvent,
  OrchestrationEpicRunFailureKind,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  EpicIssueExecutionId,
  ThreadId,
} from "@t3tools/contracts";

export function compareEpicReadyIssues(
  left: BeadsIssueRelationSummary,
  right: BeadsIssueRelationSummary,
): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.id.localeCompare(right.id);
}

export function selectDeterministicReadyIssueFromList(
  issues: ReadonlyArray<BeadsIssueRelationSummary>,
): BeadsIssueRelationSummary | null {
  return issues.toSorted(compareEpicReadyIssues).at(0) ?? null;
}

export function selectDeterministicReadyIssue(input: {
  readonly validation: Pick<BeadsEpicCoordinationValidation, "readyFronts"> | null;
  readonly status: Pick<BeadsEpicCoordinationStatus, "ready"> | null;
}): BeadsIssueRelationSummary | null {
  if (input.status) {
    return selectDeterministicReadyIssueFromList(input.status.ready);
  }

  for (const front of input.validation?.readyFronts ?? []) {
    const issue = selectDeterministicReadyIssueFromList(front);
    if (issue) {
      return issue;
    }
  }

  return null;
}

export interface EpicIssueExecutionBlockingState {
  readonly internalBlockedIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly externalBlockedIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly unknownBlockedIssues: ReadonlyArray<BeadsIssueRelationSummary>;
  readonly hasExecutionBlockingIssues: boolean;
}

export function deriveExecutionBlocking(
  status:
    | (Pick<BeadsEpicCoordinationStatus, "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null,
): EpicIssueExecutionBlockingState {
  const fallbackBlocked = status?.blocked ?? [];
  const internalBlockedIssues = status?.blockedBreakdown?.internal ?? [];
  const externalBlockedIssues = status?.blockedBreakdown?.external ?? [];
  const unknownBlockedIssues =
    status?.blockedBreakdown?.unknown ??
    (status !== null &&
    internalBlockedIssues.length === 0 &&
    externalBlockedIssues.length === 0 &&
    fallbackBlocked.length > 0
      ? fallbackBlocked
      : []);

  return {
    internalBlockedIssues,
    externalBlockedIssues,
    unknownBlockedIssues,
    hasExecutionBlockingIssues: externalBlockedIssues.length > 0 || unknownBlockedIssues.length > 0,
  };
}

function formatIssueIds(issues: ReadonlyArray<BeadsIssueRelationSummary>): string {
  const issueIds = issues
    .slice(0, 3)
    .map((issue) => issue.id)
    .join(", ");
  const suffix = issues.length > 3 ? ` and ${issues.length - 3} more` : "";
  return `${issueIds}${suffix}`;
}

export function describeExecutionBlockingReason(
  blocking: Pick<
    EpicIssueExecutionBlockingState,
    "externalBlockedIssues" | "unknownBlockedIssues" | "hasExecutionBlockingIssues"
  >,
): string | null {
  if (!blocking.hasExecutionBlockingIssues) {
    return null;
  }

  if (blocking.unknownBlockedIssues.length > 0) {
    return `Cannot start epic. Dependency metadata errors: ${formatIssueIds(blocking.unknownBlockedIssues)}.`;
  }

  if (blocking.externalBlockedIssues.length > 0) {
    return `Cannot start epic. External blockers: ${formatIssueIds(blocking.externalBlockedIssues)}.`;
  }

  return "Cannot start epic. External or unknown dependencies must be resolved first.";
}

export function isEpicCoordinationSummaryComplete(
  summary:
    | Pick<
        BeadsEpicCoordinationSummary,
        | "totalIssueCount"
        | "completedIssueCount"
        | "readyIssueCount"
        | "activeIssueCount"
        | "blockedIssueCount"
      >
    | null
    | undefined,
): boolean {
  return (
    summary !== null &&
    summary !== undefined &&
    summary.totalIssueCount > 0 &&
    summary.completedIssueCount >= summary.totalIssueCount &&
    summary.readyIssueCount === 0 &&
    summary.activeIssueCount === 0 &&
    summary.blockedIssueCount === 0
  );
}

export function inferEpicRunFailureKind(reason: string): OrchestrationEpicRunFailureKind {
  const normalized = reason.toLowerCase();
  if (
    normalized.includes("invariant") ||
    normalized.includes("multiple non-terminal task executions") ||
    normalized.includes("unexpected non-terminal task execution") ||
    normalized.includes("lost its non-terminal task execution state")
  ) {
    return "invariant_violation";
  }
  if (
    normalized.includes("not closed") ||
    (normalized.includes("completed, but issue") &&
      normalized.includes("must close their assigned beads issue")) ||
    /still\s+['"]?open['"]?/.test(normalized)
  ) {
    return "issue_incomplete";
  }
  if (
    normalized.includes("launch") ||
    normalized.includes("thread.turn.start") ||
    normalized.includes("thread.create") ||
    normalized.includes("epic-issue-execution.request")
  ) {
    return "launch_failure";
  }
  if (
    normalized.includes("stop") ||
    normalized.includes("shutdown") ||
    normalized.includes("interrupt")
  ) {
    return "environment_failure";
  }
  return "worker_failure";
}

export function createEpicRunFailureContext(input: {
  readonly reason: string;
  readonly issueId?: string | null;
  readonly executionId?: EpicIssueExecutionId | null;
  readonly workerThreadId?: ThreadId | null;
}) {
  return {
    kind: inferEpicRunFailureKind(input.reason),
    message: input.reason,
    issueId: input.issueId ?? null,
    executionId: input.executionId ?? null,
    workerThreadId: input.workerThreadId ?? null,
  } as const;
}

export interface EpicRunProjectionState {
  readonly epicRunsById: Readonly<Record<string, OrchestrationEpicRun>>;
  readonly epicIssueExecutionsById: Readonly<Record<string, OrchestrationEpicIssueExecution>>;
}

type EpicRunRequestedEvent = Extract<OrchestrationEvent, { type: "epic-run.requested" }>;
type EpicRunLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type: "epic-run.started" | "epic-run.failed" | "epic-run.stopped" | "epic-run.completed";
  }
>;
type EpicIssueExecutionRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "epic-issue-execution.requested" }
>;
type EpicIssueExecutionStartedEvent = Extract<
  OrchestrationEvent,
  { type: "epic-issue-execution.started" }
>;
type EpicIssueExecutionLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "epic-issue-execution.completed"
      | "epic-issue-execution.failed"
      | "epic-issue-execution.stopped";
  }
>;

const NON_TERMINAL_EPIC_RUN_STATUSES = new Set<OrchestrationEpicRun["status"]>([
  "pending",
  "running",
  "stopping",
]);

export function createEmptyEpicRunProjectionState(): EpicRunProjectionState {
  return {
    epicRunsById: {},
    epicIssueExecutionsById: {},
  };
}

export function createEpicRunProjectionState(input: {
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicIssueExecutions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): EpicRunProjectionState {
  return {
    epicRunsById: Object.fromEntries(input.epicRuns.map((run) => [run.runId, run])),
    epicIssueExecutionsById: Object.fromEntries(
      input.epicIssueExecutions.map((execution) => [execution.executionId, execution]),
    ),
  };
}

export function compareEpicRunsByRequestedAt(
  left: OrchestrationEpicRun,
  right: OrchestrationEpicRun,
): number {
  return left.requestedAt.localeCompare(right.requestedAt) || left.runId.localeCompare(right.runId);
}

export function compareEpicRunsByRequestedAtDesc(
  left: OrchestrationEpicRun,
  right: OrchestrationEpicRun,
): number {
  return right.requestedAt.localeCompare(left.requestedAt) || right.runId.localeCompare(left.runId);
}

export function compareEpicIssueExecutions(
  left: OrchestrationEpicIssueExecution,
  right: OrchestrationEpicIssueExecution,
): number {
  return (
    left.runId.localeCompare(right.runId) ||
    left.sequenceNumber - right.sequenceNumber ||
    left.executionId.localeCompare(right.executionId)
  );
}

export function isNonTerminalEpicIssueExecutionStatus(
  status: OrchestrationEpicIssueExecution["status"],
): status is "launching" | "running" | "stopping" {
  return status === "launching" || status === "running" || status === "stopping";
}

export function isNonTerminalEpicRunStatus(
  status: OrchestrationEpicRun["status"],
): status is "pending" | "running" | "stopping" {
  return NON_TERMINAL_EPIC_RUN_STATUSES.has(status);
}

export function compareEpicRunsByAttentionPriority(
  left: OrchestrationEpicRun,
  right: OrchestrationEpicRun,
): number {
  const nonTerminalDelta =
    Number(isNonTerminalEpicRunStatus(right.status)) -
    Number(isNonTerminalEpicRunStatus(left.status));
  if (nonTerminalDelta !== 0) {
    return nonTerminalDelta;
  }

  const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  const requestedAtDelta = right.requestedAt.localeCompare(left.requestedAt);
  if (requestedAtDelta !== 0) {
    return requestedAtDelta;
  }

  return right.runId.localeCompare(left.runId);
}

export function isNonTerminalSharedWorkspaceRun(run: OrchestrationEpicRun): boolean {
  return isNonTerminalEpicRunStatus(run.status);
}

export function formatEpicRunStatusLabel(status: OrchestrationEpicRun["status"]): string {
  return status.replace(/_/g, " ");
}

export type EpicRunCoordinatorFetchSource = "validation" | "status";

export interface EpicRunCoordinatorFetchFailure {
  readonly source: EpicRunCoordinatorFetchSource;
  readonly message: string;
}

export function isEpicRunCoordinatorFetchTimeoutMessage(message: string): boolean {
  return /\b(?:timed?\s*out|timeout)\b/i.test(message);
}

function formatEpicRunCoordinatorFetchSource(source: EpicRunCoordinatorFetchSource): string {
  switch (source) {
    case "validation":
      return "epic validation";
    case "status":
      return "coordination status";
  }
}

function formatEpicRunCoordinatorFetchSources(
  sources: ReadonlyArray<EpicRunCoordinatorFetchSource>,
): string {
  const [first, second] = sources;

  if (sources.length === 0) {
    return "epic-run state";
  }

  if (sources.length === 1) {
    return formatEpicRunCoordinatorFetchSource(first!);
  }

  if (sources.length === 2) {
    return `${formatEpicRunCoordinatorFetchSource(first!)} and ${formatEpicRunCoordinatorFetchSource(second!)}`;
  }

  return "epic validation and coordination status";
}

function describeSingleEpicRunCoordinatorFetchFailure(input: {
  readonly failure: EpicRunCoordinatorFetchFailure;
  readonly stale: boolean;
}): string {
  const timedOut = isEpicRunCoordinatorFetchTimeoutMessage(input.failure.message);
  const sourceLabel = formatEpicRunCoordinatorFetchSource(input.failure.source);
  return input.stale
    ? `Showing the last known ${sourceLabel} because the latest refresh ${timedOut ? "timed out" : "failed"}: ${input.failure.message}`
    : `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request ${timedOut ? "timed out" : "failed"}: ${input.failure.message}`;
}

export function describeEpicRunCoordinatorFetchFailure(input: {
  readonly failures: ReadonlyArray<EpicRunCoordinatorFetchFailure>;
  readonly stale: boolean;
}): string {
  const failures = input.failures.filter((failure) => failure.message.trim().length > 0);
  const [firstFailure] = failures;

  if (failures.length === 0) {
    return input.stale
      ? "Showing the last known epic-run state because the latest refresh failed."
      : "Epic-run state request failed.";
  }

  if (failures.length === 1) {
    return describeSingleEpicRunCoordinatorFetchFailure({
      failure: firstFailure!,
      stale: input.stale,
    });
  }

  const uniqueMessages = new Set(failures.map((failure) => failure.message));
  if (uniqueMessages.size === 1) {
    const message = firstFailure!.message;
    const sourceLabel = formatEpicRunCoordinatorFetchSources(
      failures.map((failure) => failure.source),
    );
    const timedOut = failures.every((failure) =>
      isEpicRunCoordinatorFetchTimeoutMessage(failure.message),
    );
    return input.stale
      ? `Showing the last known ${sourceLabel} because the latest refresh ${timedOut ? "timed out" : "failed"}: ${message}`
      : `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request ${timedOut ? "timed out" : "failed"}: ${message}`;
  }

  const detail = failures
    .map((failure) =>
      describeSingleEpicRunCoordinatorFetchFailure({
        failure,
        stale: false,
      }),
    )
    .join(" ");
  return input.stale
    ? `Showing the last known epic-run state because the latest refresh failed. ${detail}`
    : detail;
}

/**
 * Visual category for coordinator state - groups the 15 state kinds into
 * display-level categories to simplify the UI.
 */
export type CoordinatorStateCategory =
  | "active"
  | "ready"
  | "blocked"
  | "setup"
  | "done"
  | "loading";

export interface CoordinatorStateDescription {
  /** Short label for display (e.g. "Running", "Blocked") */
  readonly label: string;
  /** One-line human-readable explanation of the current situation */
  readonly summary: string;
  /** Visual category for color/icon decisions */
  readonly category: CoordinatorStateCategory;
}

/**
 * Maps every coordinator state kind + context into a clean, human-readable
 * description suitable for direct display. No more vague coordination fallbacks.
 */
export function describeCoordinatorEpicState(input: {
  readonly stateKind: EpicCoordinatorStateKind;
  readonly lastError: string | null;
  readonly fetchDetail: string | null;
  readonly activeWorkerCount: number;
  readonly completedIssueCount: number;
  readonly totalIssueCount: number;
}): CoordinatorStateDescription {
  switch (input.stateKind) {
    case "running":
      return {
        label: "Running",
        summary:
          input.activeWorkerCount > 0
            ? `${input.activeWorkerCount} worker${input.activeWorkerCount !== 1 ? "s" : ""} active, ${input.completedIssueCount}/${input.totalIssueCount} issues done`
            : `${input.completedIssueCount}/${input.totalIssueCount} issues done`,
        category: "active",
      };
    case "stopping":
      return {
        label: "Stopping",
        summary: "Stopping the current run.",
        category: "active",
      };
    case "stopped":
      return {
        label: "Stopped",
        summary: "Run stopped. Fix the issue and start a new run when ready.",
        category: "done",
      };
    case "failed":
      return {
        label: "Failed",
        summary: input.lastError ?? "The run failed. Fix the issue and start a new run.",
        category: "blocked",
      };
    case "ready":
      return {
        label: "Ready",
        summary: "Epic is ready to start.",
        category: "ready",
      };
    case "needs_preparation":
      return {
        label: "Needs prep",
        summary: "Epic needs prep before it can start.",
        category: "setup",
      };
    case "completed":
      return {
        label: "Completed",
        summary:
          input.totalIssueCount > 0
            ? `All ${input.totalIssueCount} issues completed.`
            : "Run completed.",
        category: "done",
      };
    case "checking":
      return {
        label: "Loading",
        summary: input.fetchDetail ?? "Checking epic status...",
        category: "loading",
      };
    case "timeout":
      return {
        label: "Timed out",
        summary: input.fetchDetail ?? "Epic status request timed out. Retry to refresh.",
        category: "blocked",
      };
    case "stale":
      return {
        label: "Stale",
        summary: input.fetchDetail ?? "Showing last known epic status. Refresh to update.",
        category: "blocked",
      };
    case "error":
      return {
        label: "Error",
        summary: input.fetchDetail ?? "Could not load epic status. Retry to refresh.",
        category: "blocked",
      };
  }
}

export function describeSharedWorkspaceProjectConflict(run: OrchestrationEpicRun): string {
  return `This project already has an active epic run for ${run.epicIssueId} (${formatEpicRunStatusLabel(run.status)}). Finish or stop that run before starting another epic in this project.`;
}

export type EpicRunCoordinatorFetchLifecycleKind =
  | "ready"
  | "loading"
  | "timeout"
  | "stale"
  | "error";

export interface EpicRunCoordinatorFetchLifecycle {
  readonly kind: EpicRunCoordinatorFetchLifecycleKind;
  readonly detail: string | null;
}

export type EpicCoordinatorStateKind =
  | "checking"
  | "timeout"
  | "stale"
  | "error"
  | "needs_preparation"
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "completed";

export interface EpicCoordinatorState {
  readonly kind: EpicCoordinatorStateKind;
  readonly latestRun: OrchestrationEpicRun | null;
  readonly fetchLifecycle: EpicRunCoordinatorFetchLifecycle;
}

export interface EpicCoordinationLoadStateResult {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly coordinationLoadDetail: string | null;
}

export interface EpicCoordinationProgressState {
  readonly totalIssueCount: number;
  readonly completedIssueCount: number;
  readonly readyIssueCount: number;
  readonly activeIssueCount: number;
  readonly blockedIssueCount: number;
  readonly internalBlockedIssueCount: number;
  readonly externalBlockedIssueCount: number;
  readonly unknownBlockedIssueCount: number;
  readonly activeWorkerCount: number;
  readonly isComplete: boolean;
}

export function deriveCoordinationLoadState(input: {
  readonly validationError: string | null;
  readonly statusError: string | null;
}): EpicCoordinationLoadStateResult {
  const failures = [
    input.validationError === null
      ? null
      : {
          source: "validation" as const,
          message: input.validationError,
        },
    input.statusError === null
      ? null
      : {
          source: "status" as const,
          message: input.statusError,
        },
  ].filter(
    (value): value is { readonly source: "validation" | "status"; readonly message: string } =>
      value !== null,
  );

  if (failures.length === 0) {
    return {
      coordinationLoadState: "ready",
      coordinationLoadDetail: null,
    };
  }

  return {
    coordinationLoadState: failures.some((failure) =>
      isEpicRunCoordinatorFetchTimeoutMessage(failure.message),
    )
      ? "timeout"
      : "error",
    coordinationLoadDetail: describeEpicRunCoordinatorFetchFailure({
      failures,
      stale: false,
    }),
  };
}

export function deriveCoordinationValidationState(input: {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly validation: Pick<BeadsEpicCoordinationValidation, "valid"> | null;
}): BeadsCoordinatorValidationState {
  if (input.coordinationLoadState !== "ready" || input.validation === null) {
    return "unknown";
  }

  return input.validation.valid ? "valid" : "invalid";
}

export function deriveEpicCoordinationProgress(input: {
  readonly validation: Pick<BeadsEpicCoordinationValidation, "summary"> | null;
  readonly status:
    | (Pick<BeadsEpicCoordinationStatus, "summary" | "completed" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null;
}): EpicCoordinationProgressState {
  const summary = input.status?.summary ?? input.validation?.summary ?? null;
  const executionBlocking = deriveExecutionBlocking(input.status);
  const totalIssueCount = summary?.totalIssueCount ?? 0;
  const completedIssueCount = summary?.completedIssueCount ?? input.status?.completed.length ?? 0;
  const readyIssueCount = summary?.readyIssueCount ?? input.status?.ready.length ?? 0;
  const activeIssueCount = summary?.activeIssueCount ?? input.status?.active.length ?? 0;
  const blockedIssueCount = summary?.blockedIssueCount ?? input.status?.blocked.length ?? 0;
  const activeWorkerCount = summary?.activeWorkerCount ?? 0;

  return {
    totalIssueCount,
    completedIssueCount,
    readyIssueCount,
    activeIssueCount,
    blockedIssueCount,
    internalBlockedIssueCount: executionBlocking.internalBlockedIssues.length,
    externalBlockedIssueCount: executionBlocking.externalBlockedIssues.length,
    unknownBlockedIssueCount: executionBlocking.unknownBlockedIssues.length,
    activeWorkerCount,
    isComplete: isEpicCoordinationSummaryComplete(summary),
  };
}

export function deriveCoordinationState(input: {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly status:
    | (Pick<BeadsEpicCoordinationStatus, "active" | "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null;
  readonly progress: Pick<EpicCoordinationProgressState, "isComplete">;
}): BeadsCoordinatorState {
  if (input.coordinationLoadState !== "ready" || input.status === null) {
    return "unknown";
  }

  if (input.progress.isComplete) {
    return "completed";
  }

  const executionBlocking = deriveExecutionBlocking(input.status);

  if (executionBlocking.hasExecutionBlockingIssues) {
    return "blocked";
  }

  if (input.status.active.length > 0) {
    return "in_progress";
  }

  return "not_started";
}

export function findActiveEpicRuns(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun[] {
  return epicRuns
    .filter((run) => isNonTerminalEpicRunStatus(run.status))
    .toSorted(compareEpicRunsByRequestedAtDesc);
}

export function findActiveEpicRun(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun | null {
  return findActiveEpicRuns(epicRuns)[0] ?? null;
}

export function deriveActiveRunId(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun["runId"] | null {
  return findActiveEpicRun(epicRuns)?.runId ?? null;
}

export function deriveActiveExecutionId(input: {
  readonly activeRunId: OrchestrationEpicRun["runId"] | null;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): OrchestrationEpicIssueExecution["executionId"] | null {
  if (input.activeRunId === null) {
    return null;
  }

  return (
    deriveEpicRunExecutionState({
      runId: input.activeRunId,
      executions: input.executions,
    }).activeExecution?.executionId ?? null
  );
}

export function deriveEpicCoordinatorState(input: {
  readonly status: Pick<BeadsEpicCoordinationStatus, "summary"> | null;
  readonly validation: Pick<BeadsEpicCoordinationValidation, "valid" | "summary"> | null;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly fetchLifecycle: EpicRunCoordinatorFetchLifecycle;
}): EpicCoordinatorState {
  const latestRun = selectLatestEpicRun(input.epicRuns);

  if (input.fetchLifecycle.kind === "loading") {
    return {
      kind: "checking",
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "timeout") {
    return {
      kind: "timeout",
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "stale") {
    return {
      kind: "stale",
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "error") {
    return {
      kind: "error",
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (latestRun !== null) {
    return {
      kind: latestRun.status === "pending" ? "running" : latestRun.status,
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.validation?.valid === false) {
    return {
      kind: "needs_preparation",
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.validation?.valid === true) {
    return {
      kind: "ready",
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  return {
    kind: "checking",
    latestRun: null,
    fetchLifecycle: input.fetchLifecycle,
  };
}

function command(input: {
  readonly kind: BeadsEpicCommand["kind"];
  readonly label: string;
  readonly busyLabel: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
}): BeadsEpicCommand {
  return {
    kind: input.kind,
    label: input.label,
    busyLabel: input.busyLabel,
    disabled: input.disabled ?? false,
    disabledReason: input.disabledReason ?? null,
  };
}

export function deriveEpicExecutionControl(input: {
  readonly status:
    | (Pick<BeadsEpicCoordinationStatus, "summary" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null;
  readonly validation: Pick<
    BeadsEpicCoordinationValidation,
    "valid" | "summary" | "readyFronts" | "errors"
  > | null;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly hasProjectConflict: boolean;
  readonly fetchLifecycle: EpicRunCoordinatorFetchLifecycle;
}): {
  readonly execution: BeadsEpicExecution;
  readonly commands: ReadonlyArray<BeadsEpicCommand>;
} {
  const latestRun = selectLatestEpicRun(input.epicRuns);
  const activeRun = findActiveEpicRun(input.epicRuns);
  const summary = input.status?.summary ?? input.validation?.summary ?? null;
  const coordinationIsComplete = isEpicCoordinationSummaryComplete(summary);
  const executionBlocking = deriveExecutionBlocking(input.status);
  const hasReadyIssues =
    (input.status?.ready.length ?? 0) > 0 ||
    (input.validation?.readyFronts.some((front) => front.length > 0) ?? false);

  switch (input.fetchLifecycle.kind) {
    case "loading":
      return {
        execution: {
          state: "checking",
          summary: "Checking epic status.",
          blockingReason: null,
          nextIssue: null,
        },
        commands: [],
      };
    case "timeout":
      return {
        execution: {
          state: "error",
          summary: input.fetchLifecycle.detail ?? "Timed out while checking epic status.",
          blockingReason: input.fetchLifecycle.detail,
          nextIssue: null,
        },
        commands: [
          command({
            kind: "refresh_epic_status",
            label: "Retry epic status",
            busyLabel: "Retrying...",
          }),
        ],
      };
    case "stale":
      return {
        execution: {
          state: "checking",
          summary: input.fetchLifecycle.detail ?? "Epic status may be stale.",
          blockingReason: null,
          nextIssue: null,
        },
        commands: [
          command({
            kind: "refresh_epic_status",
            label: "Refresh epic status",
            busyLabel: "Refreshing...",
          }),
        ],
      };
    case "error":
      return {
        execution: {
          state: "error",
          summary: input.fetchLifecycle.detail ?? "Unable to check epic status.",
          blockingReason: input.fetchLifecycle.detail,
          nextIssue: null,
        },
        commands: [
          command({
            kind: "refresh_epic_status",
            label: "Retry epic status",
            busyLabel: "Retrying...",
          }),
        ],
      };
    case "ready":
      break;
  }

  if (input.validation?.valid === false) {
    const dependencyError = input.validation.errors.find((error) =>
      error.includes("open dependency that could not be identified"),
    );
    const summary = dependencyError ?? "Epic needs coordination prep before it can run.";
    return {
      execution: {
        state: "needs_preparation",
        summary,
        blockingReason: dependencyError ?? "Epic validation failed.",
        nextIssue: null,
      },
      commands: [
        command({
          kind: "open_coordination_prep_thread",
          label: "Open prep thread",
          busyLabel: "Opening...",
        }),
      ],
    };
  }

  if (input.hasProjectConflict) {
    return {
      execution: {
        state: "blocked",
        summary: "Another epic run is active in this project.",
        blockingReason: "Finish or stop the active epic run before starting another epic.",
        nextIssue: null,
      },
      commands: [],
    };
  }

  if (activeRun !== null) {
    switch (activeRun.status) {
      case "running":
        return {
          execution: {
            state: "running",
            summary: "Epic run is active.",
            blockingReason: null,
            nextIssue: null,
          },
          commands: [
            command({
              kind: "stop_epic_run",
              label: "Stop run",
              busyLabel: "Stopping...",
            }),
          ],
        };
      case "pending":
      case "stopping":
        return {
          execution: {
            state: activeRun.status === "pending" ? "running" : "waiting",
            summary:
              activeRun.status === "pending" ? "Epic run is starting." : "Epic run is stopping.",
            blockingReason: null,
            nextIssue: null,
          },
          commands: [],
        };
      case "stopped":
      case "failed":
      case "completed":
        break;
    }
  }

  const nextIssue =
    selectDeterministicReadyIssueFromList(input.status?.ready ?? []) ??
    selectDeterministicReadyIssue({
      status: null,
      validation: input.validation,
    });

  const executionBlockingReason = describeExecutionBlockingReason(executionBlocking);

  if (executionBlockingReason !== null) {
    return {
      execution: {
        state: "blocked",
        summary: executionBlockingReason,
        blockingReason: executionBlockingReason,
        nextIssue: null,
      },
      commands: [],
    };
  }

  if (
    input.validation?.valid === true &&
    !coordinationIsComplete &&
    (hasReadyIssues || !executionBlocking.hasExecutionBlockingIssues)
  ) {
    const state =
      latestRun?.status === "failed" || latestRun?.status === "stopped" ? "failed" : "ready";
    return {
      execution: {
        state,
        summary:
          state === "failed"
            ? (latestRun?.failureContext?.message ?? "Last run failed. Ready work can be retried.")
            : hasReadyIssues
              ? `${input.status?.ready.length ?? 0} issue${
                  (input.status?.ready.length ?? 0) === 1 ? "" : "s"
                } ready to launch.`
              : "Epic is ready to launch.",
        blockingReason: null,
        nextIssue,
      },
      commands: [
        command({
          kind: "start_epic_run",
          label: state === "failed" ? "Retry run" : "Start epic",
          busyLabel: state === "failed" ? "Retrying..." : "Starting...",
        }),
      ],
    };
  }

  if (latestRun !== null) {
    const failed = latestRun.status === "failed";
    return {
      execution: {
        state: failed ? "failed" : latestRun.status === "completed" ? "completed" : "waiting",
        summary:
          latestRun.failureContext?.message ??
          (latestRun.status === "completed"
            ? "Epic run completed."
            : "No launchable ready work is available."),
        blockingReason: latestRun.failureContext?.message ?? null,
        nextIssue: null,
      },
      commands: [],
    };
  }

  return {
    execution: {
      state: coordinationIsComplete ? "completed" : "waiting",
      summary: coordinationIsComplete
        ? "Epic is complete."
        : "No launchable ready work is available.",
      blockingReason: null,
      nextIssue: null,
    },
    commands: [],
  };
}

export function selectLatestEpicRun(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun | null {
  return [...epicRuns].toSorted(compareEpicRunsByRequestedAtDesc)[0] ?? null;
}

export function findConflictingSharedWorkspaceRun(input: {
  readonly projectEpicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
}): OrchestrationEpicRun | null {
  const epicRunIds = new Set(input.epicRuns.map((run) => run.runId));
  return (
    input.projectEpicRuns
      .filter(
        (candidate) =>
          isNonTerminalSharedWorkspaceRun(candidate) && !epicRunIds.has(candidate.runId),
      )
      .toSorted(compareEpicRunsByAttentionPriority)[0] ?? null
  );
}

export function listEpicRuns(state: EpicRunProjectionState): OrchestrationEpicRun[] {
  return Object.values(state.epicRunsById).toSorted(compareEpicRunsByRequestedAtDesc);
}

export function listEpicIssueExecutions(
  state: EpicRunProjectionState,
): OrchestrationEpicIssueExecution[] {
  return Object.values(state.epicIssueExecutionsById).toSorted(compareEpicIssueExecutions);
}

export function createRequestedEpicRun(
  payload: EpicRunRequestedEvent["payload"],
): OrchestrationEpicRun {
  return {
    runId: payload.runId,
    projectId: payload.projectId,
    epicIssueId: payload.epicIssueId,
    status: "pending",
    provider: payload.provider,
    model: payload.model,
    modelOptions: payload.modelOptions,
    providerOptions: payload.providerOptions,
    assistantDeliveryMode: payload.assistantDeliveryMode,
    runtimeMode: payload.runtimeMode,
    failureContext: null,
    requestedAt: payload.requestedAt,
    startedAt: null,
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: payload.updatedAt,
  };
}

export function applyEpicRunLifecycleEvent(
  run: OrchestrationEpicRun,
  event: EpicRunLifecycleEvent,
): OrchestrationEpicRun {
  switch (event.type) {
    case "epic-run.started":
      return {
        ...run,
        status: "running",
        startedAt: event.payload.startedAt,
        failureContext: null,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-run.failed":
      return {
        ...run,
        status: "failed",
        failureContext: createEpicRunFailureContext({
          reason: event.payload.reason,
          issueId: event.payload.issueId,
          executionId: event.payload.executionId,
          workerThreadId: event.payload.workerThreadId,
        }),
        failedAt: event.payload.failedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-run.stopped":
      return {
        ...run,
        status: "stopped",
        failureContext: null,
        stopRequestedAt: run.stopRequestedAt ?? event.payload.stoppedAt,
        stoppedAt: event.payload.stoppedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-run.completed":
      return {
        ...run,
        status: "completed",
        failureContext: null,
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: event.payload.completedAt,
        updatedAt: event.payload.updatedAt,
      };
  }
}

export function createRequestedEpicIssueExecution(
  payload: EpicIssueExecutionRequestedEvent["payload"],
): OrchestrationEpicIssueExecution {
  return {
    executionId: payload.executionId,
    runId: payload.runId,
    issueId: payload.issueId,
    workerThreadId: payload.workerThreadId,
    sequenceNumber: payload.sequenceNumber,
    status: "launching",
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: payload.requestedAt,
    startedAt: null,
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: null,
    failedAt: null,
    updatedAt: payload.updatedAt,
  };
}

export function materializeStartedEpicIssueExecution(input: {
  readonly event: EpicIssueExecutionStartedEvent;
  readonly existingExecution: OrchestrationEpicIssueExecution | null;
}): OrchestrationEpicIssueExecution {
  const existingExecution = input.existingExecution;
  return {
    executionId: input.event.payload.executionId,
    runId: input.event.payload.runId,
    issueId: existingExecution?.issueId ?? "unknown-task",
    workerThreadId: existingExecution?.workerThreadId ?? null,
    sequenceNumber: existingExecution?.sequenceNumber ?? 0,
    status: "running",
    workspaceKey: existingExecution?.workspaceKey ?? "shared",
    workspacePath: existingExecution?.workspacePath ?? null,
    failureContext: null,
    requestedAt: existingExecution?.requestedAt ?? input.event.payload.startedAt,
    startedAt: input.event.payload.startedAt,
    stopRequestedAt: existingExecution?.stopRequestedAt ?? null,
    stoppedAt: existingExecution?.stoppedAt ?? null,
    completedAt: existingExecution?.completedAt ?? null,
    failedAt: existingExecution?.failedAt ?? null,
    updatedAt: input.event.payload.updatedAt,
  };
}

export function applyEpicIssueExecutionLifecycleEvent(
  execution: OrchestrationEpicIssueExecution,
  event: EpicIssueExecutionLifecycleEvent,
): OrchestrationEpicIssueExecution {
  switch (event.type) {
    case "epic-issue-execution.completed":
      return {
        ...execution,
        status: "completed",
        failureContext: null,
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: event.payload.completedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-issue-execution.failed":
      return {
        ...execution,
        status: "failed",
        failureContext: createEpicRunFailureContext({
          reason: event.payload.reason,
          issueId: execution.issueId,
          executionId: execution.executionId,
          workerThreadId: execution.workerThreadId,
        }),
        failedAt: event.payload.failedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-issue-execution.stopped":
      return {
        ...execution,
        status: "stopped",
        failureContext: null,
        stopRequestedAt: execution.stopRequestedAt ?? event.payload.stoppedAt,
        stoppedAt: event.payload.stoppedAt,
        updatedAt: event.payload.updatedAt,
      };
  }
}

export function projectEpicRunEvent(
  state: EpicRunProjectionState,
  event: OrchestrationEvent,
): EpicRunProjectionState {
  switch (event.type) {
    case "epic-run.requested": {
      const run = createRequestedEpicRun(event.payload);
      return {
        ...state,
        epicRunsById: {
          ...state.epicRunsById,
          [run.runId]: run,
        },
      };
    }
    case "epic-run.started":
    case "epic-run.failed":
    case "epic-run.stopped":
    case "epic-run.completed": {
      const currentRun = state.epicRunsById[event.payload.runId];
      if (!currentRun) {
        return state;
      }
      return {
        ...state,
        epicRunsById: {
          ...state.epicRunsById,
          [currentRun.runId]: applyEpicRunLifecycleEvent(currentRun, event),
        },
      };
    }
    case "epic-issue-execution.requested": {
      const execution = createRequestedEpicIssueExecution(event.payload);
      const run = state.epicRunsById[event.payload.runId];
      return {
        epicRunsById:
          run === undefined
            ? state.epicRunsById
            : {
                ...state.epicRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        epicIssueExecutionsById: {
          ...state.epicIssueExecutionsById,
          [execution.executionId]: execution,
        },
      };
    }
    case "epic-issue-execution.started": {
      const existingExecution = state.epicIssueExecutionsById[event.payload.executionId] ?? null;
      const execution = materializeStartedEpicIssueExecution({
        event,
        existingExecution,
      });
      const run = state.epicRunsById[event.payload.runId];
      return {
        epicRunsById:
          run === undefined
            ? state.epicRunsById
            : {
                ...state.epicRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        epicIssueExecutionsById: {
          ...state.epicIssueExecutionsById,
          [execution.executionId]: execution,
        },
      };
    }
    case "epic-issue-execution.completed":
    case "epic-issue-execution.failed":
    case "epic-issue-execution.stopped": {
      const execution = state.epicIssueExecutionsById[event.payload.executionId];
      const run = state.epicRunsById[event.payload.runId];
      return {
        epicRunsById:
          run === undefined
            ? state.epicRunsById
            : {
                ...state.epicRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        epicIssueExecutionsById:
          execution === undefined
            ? state.epicIssueExecutionsById
            : {
                ...state.epicIssueExecutionsById,
                [execution.executionId]: applyEpicIssueExecutionLifecycleEvent(execution, event),
              },
      };
    }
    default:
      return state;
  }
}

export function deriveEpicRunExecutionState(input: {
  readonly runId: OrchestrationEpicRun["runId"];
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): {
  readonly activeExecution: OrchestrationEpicIssueExecution | null;
  readonly currentExecution: OrchestrationEpicIssueExecution | null;
  readonly latestExecution: OrchestrationEpicIssueExecution | null;
  readonly nonTerminalExecutions: ReadonlyArray<OrchestrationEpicIssueExecution>;
} {
  let latestExecution: OrchestrationEpicIssueExecution | null = null;
  let activeExecution: OrchestrationEpicIssueExecution | null = null;
  const nonTerminalExecutions: OrchestrationEpicIssueExecution[] = [];

  for (const execution of input.executions) {
    if (execution.runId !== input.runId) {
      continue;
    }

    if (latestExecution === null || compareEpicIssueExecutions(latestExecution, execution) < 0) {
      latestExecution = execution;
    }

    if (isNonTerminalEpicIssueExecutionStatus(execution.status)) {
      nonTerminalExecutions.push(execution);
    }

    if (
      execution.status === "running" &&
      (activeExecution === null || compareEpicIssueExecutions(activeExecution, execution) < 0)
    ) {
      activeExecution = execution;
    }
  }

  const orderedNonTerminalExecutions = nonTerminalExecutions.toSorted(compareEpicIssueExecutions);

  return {
    activeExecution,
    currentExecution: orderedNonTerminalExecutions.at(-1) ?? null,
    latestExecution,
    nonTerminalExecutions: orderedNonTerminalExecutions,
  };
}
