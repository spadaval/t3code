import type {
  BeadsCoordinatorTrackerLoadState,
  BeadsCoordinatorTrackerState,
  BeadsCoordinatorValidationState,
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
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
  readonly validation: Pick<BeadsSwarmValidation, "readyFronts"> | null;
  readonly status: Pick<BeadsSwarmStatus, "ready"> | null;
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
    | (Pick<BeadsSwarmStatus, "blocked"> & Partial<Pick<BeadsSwarmStatus, "blockedBreakdown">>)
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

export function inferEpicRunFailureKind(reason: string): OrchestrationEpicRunFailureKind {
  const normalized = reason.toLowerCase();
  if (normalized.includes("launch")) {
    return "launch_failure";
  }
  if (normalized.includes("invariant")) {
    return "invariant_violation";
  }
  if (normalized.includes("still open") || normalized.includes("not closed")) {
    return "issue_incomplete";
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

type SwarmRunRequestedEvent = Extract<OrchestrationEvent, { type: "epic-run.requested" }>;
type SwarmRunLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "epic-run.started"
      | "epic-run.idled"
      | "epic-run.blocked"
      | "epic-run.failed"
      | "epic-run.stopped"
      | "epic-run.completed";
  }
>;
type SwarmTaskExecutionRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "epic-issue-execution.requested" }
>;
type SwarmTaskExecutionStartedEvent = Extract<
  OrchestrationEvent,
  { type: "epic-issue-execution.started" }
>;
type SwarmTaskExecutionLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "epic-issue-execution.completed"
      | "epic-issue-execution.failed"
      | "epic-issue-execution.stopped";
  }
>;

const NON_TERMINAL_SWARM_RUN_STATUSES = new Set<OrchestrationEpicRun["status"]>([
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
  return NON_TERMINAL_SWARM_RUN_STATUSES.has(status);
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

export type EpicRunCoordinatorFetchSource = "support" | "validation" | "status";

export interface EpicRunCoordinatorFetchFailure {
  readonly source: EpicRunCoordinatorFetchSource;
  readonly message: string;
}

export function isEpicRunCoordinatorFetchTimeoutMessage(message: string): boolean {
  return /\b(?:timed?\s*out|timeout)\b/i.test(message);
}

function formatEpicRunCoordinatorFetchSource(source: EpicRunCoordinatorFetchSource): string {
  switch (source) {
    case "support":
      return "epic-run support";
    case "validation":
      return "epic validation";
    case "status":
      return "tracker status";
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
    return `${formatEpicRunCoordinatorFetchSource(first!)} and ${second!}`;
  }

  return "epic-run support, validation, and tracker status";
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
    case "unsupported":
      return {
        label: "Unavailable",
        summary: "This backend does not support epic coordination.",
        category: "done",
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
  | "unsupported"
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

export interface EpicCoordinatorPrimaryAction {
  readonly kind:
    | "checking"
    | "unsupported"
    | "open_coordination_prep_thread"
    | "refresh_epic_status"
    | "start_epic_run"
    | "stop_epic_run"
    | "open_coordinator";
  readonly label: string;
  readonly busyLabel: string;
  readonly disabled: boolean;
}

export interface EpicTrackerLoadStateResult {
  readonly trackerLoadState: BeadsCoordinatorTrackerLoadState;
  readonly trackerLoadDetail: string | null;
}

export interface EpicTrackerProgressState {
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

export function deriveTrackerLoadState(input: {
  readonly validationError: string | null;
  readonly statusError: string | null;
}): EpicTrackerLoadStateResult {
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
      trackerLoadState: "ready",
      trackerLoadDetail: null,
    };
  }

  return {
    trackerLoadState: failures.some((failure) =>
      isEpicRunCoordinatorFetchTimeoutMessage(failure.message),
    )
      ? "timeout"
      : "error",
    trackerLoadDetail: describeEpicRunCoordinatorFetchFailure({
      failures,
      stale: false,
    }),
  };
}

export function deriveValidationState(input: {
  readonly trackerLoadState: BeadsCoordinatorTrackerLoadState;
  readonly validation: Pick<BeadsSwarmValidation, "valid"> | null;
}): BeadsCoordinatorValidationState {
  if (input.trackerLoadState !== "ready" || input.validation === null) {
    return "unknown";
  }

  return input.validation.valid ? "valid" : "invalid";
}

export function deriveEpicTrackerProgress(input: {
  readonly validation: Pick<BeadsSwarmValidation, "swarm"> | null;
  readonly status:
    | (Pick<BeadsSwarmStatus, "swarm" | "completed" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsSwarmStatus, "blockedBreakdown">>)
    | null;
}): EpicTrackerProgressState {
  const swarm = input.status?.swarm ?? input.validation?.swarm ?? null;
  const executionBlocking = deriveExecutionBlocking(input.status);
  const totalIssueCount = swarm?.totalIssueCount ?? 0;
  const completedIssueCount = swarm?.completedIssueCount ?? input.status?.completed.length ?? 0;
  const readyIssueCount = swarm?.readyIssueCount ?? input.status?.ready.length ?? 0;
  const activeIssueCount = swarm?.activeIssueCount ?? input.status?.active.length ?? 0;
  const blockedIssueCount = swarm?.blockedIssueCount ?? input.status?.blocked.length ?? 0;
  const activeWorkerCount = swarm?.activeWorkerCount ?? 0;

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
    isComplete: totalIssueCount > 0 && completedIssueCount === totalIssueCount,
  };
}

export function deriveTrackerState(input: {
  readonly trackerLoadState: BeadsCoordinatorTrackerLoadState;
  readonly status:
    | (Pick<BeadsSwarmStatus, "active" | "blocked"> &
        Partial<Pick<BeadsSwarmStatus, "blockedBreakdown">>)
    | null;
  readonly progress: Pick<EpicTrackerProgressState, "isComplete">;
}): BeadsCoordinatorTrackerState {
  if (input.trackerLoadState !== "ready" || input.status === null) {
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
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
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

  if (input.swarmSupport?.supported !== true) {
    return {
      kind: "unsupported",
      latestRun: null,
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

export function getEpicCoordinatorPrimaryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status:
    | (Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsSwarmStatus, "blockedBreakdown">>)
    | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> | null;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly hasProjectConflict: boolean;
  readonly fetchLifecycle: EpicRunCoordinatorFetchLifecycle;
}): EpicCoordinatorPrimaryAction {
  const state = deriveEpicCoordinatorState(input);
  const executionBlocking = deriveExecutionBlocking(input.status);

  switch (state.kind) {
    case "checking":
      return {
        kind: "checking",
        label: "Checking epic...",
        busyLabel: "Checking...",
        disabled: true,
      };
    case "timeout":
      return {
        kind: "refresh_epic_status",
        label: "Retry epic status",
        busyLabel: "Retrying...",
        disabled: false,
      };
    case "stale":
      return {
        kind: "refresh_epic_status",
        label: "Refresh epic status",
        busyLabel: "Refreshing...",
        disabled: false,
      };
    case "error":
      return {
        kind: "refresh_epic_status",
        label: "Retry epic status",
        busyLabel: "Retrying...",
        disabled: false,
      };
    case "unsupported":
      return {
        kind: "unsupported",
        label: "Epic coordination unavailable",
        busyLabel: "Epic coordination unavailable",
        disabled: true,
      };
    case "needs_preparation":
      return {
        kind: "open_coordination_prep_thread",
        label: "Open prep thread",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "ready":
      if (input.hasProjectConflict) {
        return {
          kind: "open_coordinator",
          label: "View active epic",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      if (executionBlocking.hasExecutionBlockingIssues) {
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      return {
        kind: "start_epic_run",
        label: "Start epic",
        busyLabel: "Starting...",
        disabled: false,
      };
    case "running":
      return {
        kind: "stop_epic_run",
        label: "Stop run",
        busyLabel: "Stopping...",
        disabled: false,
      };
    case "stopping":
      return {
        kind: "open_coordinator",
        label: "Open epic",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "stopped":
      return {
        kind: "open_coordinator",
        label: input.hasProjectConflict ? "View active epic" : "Open epic",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "failed":
      return {
        kind: "open_coordinator",
        label: "Open epic",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "completed":
      return {
        kind: "open_coordinator",
        label: "Open epic",
        busyLabel: "Opening...",
        disabled: false,
      };
  }
}

export function selectLatestEpicRun(
  epicRuns: ReadonlyArray<OrchestrationEpicRun>,
): OrchestrationEpicRun | null {
  return [...epicRuns].toSorted(compareEpicRunsByRequestedAtDesc)[0] ?? null;
}

export function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
}): OrchestrationEpicRun | null {
  const epicRunIds = new Set(input.epicSwarmRuns.map((run) => run.runId));
  return (
    input.projectSwarmRuns
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
  payload: SwarmRunRequestedEvent["payload"],
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
  event: SwarmRunLifecycleEvent,
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
    case "epic-run.idled":
      return {
        ...run,
        status: "running",
        updatedAt: event.payload.updatedAt,
      };
    case "epic-run.blocked":
      if (event.payload.blockedContext?.kind === "tracker_waiting") {
        return {
          ...run,
          status: "running",
          updatedAt: event.payload.updatedAt,
        };
      }
      return {
        ...run,
        status: "failed",
        failureContext: createEpicRunFailureContext({
          reason: event.payload.reason,
          issueId: event.payload.blockedContext?.issueId ?? null,
          executionId: event.payload.blockedContext?.executionId ?? null,
          workerThreadId: event.payload.blockedContext?.workerThreadId ?? null,
        }),
        failedAt: event.payload.blockedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "epic-run.failed":
      return {
        ...run,
        status: "failed",
        failureContext: createEpicRunFailureContext({
          reason: event.payload.reason,
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
  payload: SwarmTaskExecutionRequestedEvent["payload"],
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
  readonly event: SwarmTaskExecutionStartedEvent;
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
  event: SwarmTaskExecutionLifecycleEvent,
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
    case "epic-run.idled":
    case "epic-run.blocked":
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
