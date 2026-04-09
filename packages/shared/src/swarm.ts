import type {
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  OrchestrationEvent,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";

export function compareSwarmReadyIssues(
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
  return issues.toSorted(compareSwarmReadyIssues).at(0) ?? null;
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

export interface SwarmProjectionState {
  readonly swarmRunsById: Readonly<Record<string, OrchestrationSwarmRun>>;
  readonly swarmTaskExecutionsById: Readonly<Record<string, OrchestrationSwarmTaskExecution>>;
}

type SwarmRunRequestedEvent = Extract<OrchestrationEvent, { type: "swarm-run.requested" }>;
type SwarmRunLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "swarm-run.started"
      | "swarm-run.idled"
      | "swarm-run.paused"
      | "swarm-run.resumed"
      | "swarm-run.blocked"
      | "swarm-run.failed"
      | "swarm-run.cancelled"
      | "swarm-run.completed";
  }
>;
type SwarmTaskExecutionRequestedEvent = Extract<
  OrchestrationEvent,
  { type: "swarm-task-execution.requested" }
>;
type SwarmTaskExecutionStartedEvent = Extract<
  OrchestrationEvent,
  { type: "swarm-task-execution.started" }
>;
type SwarmTaskExecutionLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "swarm-task-execution.completed"
      | "swarm-task-execution.failed"
      | "swarm-task-execution.cancelled";
  }
>;

const NON_TERMINAL_SWARM_RUN_STATUSES = new Set<OrchestrationSwarmRun["status"]>([
  "requested",
  "running",
  "idle",
  "paused",
  "blocked",
]);

export function createEmptySwarmProjectionState(): SwarmProjectionState {
  return {
    swarmRunsById: {},
    swarmTaskExecutionsById: {},
  };
}

export function createSwarmProjectionState(input: {
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly swarmTaskExecutions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): SwarmProjectionState {
  return {
    swarmRunsById: Object.fromEntries(input.swarmRuns.map((run) => [run.runId, run])),
    swarmTaskExecutionsById: Object.fromEntries(
      input.swarmTaskExecutions.map((execution) => [execution.executionId, execution]),
    ),
  };
}

export function compareSwarmRunsByRequestedAt(
  left: OrchestrationSwarmRun,
  right: OrchestrationSwarmRun,
): number {
  return left.requestedAt.localeCompare(right.requestedAt) || left.runId.localeCompare(right.runId);
}

export function compareSwarmTaskExecutions(
  left: OrchestrationSwarmTaskExecution,
  right: OrchestrationSwarmTaskExecution,
): number {
  return (
    left.runId.localeCompare(right.runId) ||
    left.sequenceNumber - right.sequenceNumber ||
    left.executionId.localeCompare(right.executionId)
  );
}

export function isNonTerminalSwarmTaskExecutionStatus(
  status: OrchestrationSwarmTaskExecution["status"],
): status is "requested" | "active" {
  return status === "requested" || status === "active";
}

export function compareSwarmRunsByPriority(
  left: OrchestrationSwarmRun,
  right: OrchestrationSwarmRun,
): number {
  const nonTerminalDelta =
    Number(NON_TERMINAL_SWARM_RUN_STATUSES.has(right.status)) -
    Number(NON_TERMINAL_SWARM_RUN_STATUSES.has(left.status));
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

export function isNonTerminalSharedWorkspaceRun(run: OrchestrationSwarmRun): boolean {
  return run.workspaceMode === "shared" && NON_TERMINAL_SWARM_RUN_STATUSES.has(run.status);
}

export function formatSwarmRunStatusLabel(status: OrchestrationSwarmRun["status"]): string {
  return status === "requested" ? "requested" : status.replace(/_/g, " ");
}

export type SwarmCoordinatorFetchSource = "support" | "validation" | "status";

export interface SwarmCoordinatorFetchFailure {
  readonly source: SwarmCoordinatorFetchSource;
  readonly message: string;
}

export function isSwarmCoordinatorFetchTimeoutMessage(message: string): boolean {
  return /\b(?:timed?\s*out|timeout)\b/i.test(message);
}

function formatSwarmCoordinatorFetchSource(source: SwarmCoordinatorFetchSource): string {
  return `swarm ${source}`;
}

function formatSwarmCoordinatorFetchSources(
  sources: ReadonlyArray<SwarmCoordinatorFetchSource>,
): string {
  const [first, second] = sources;

  if (sources.length === 0) {
    return "swarm state";
  }

  if (sources.length === 1) {
    return formatSwarmCoordinatorFetchSource(first!);
  }

  if (sources.length === 2) {
    return `${formatSwarmCoordinatorFetchSource(first!)} and ${second!}`;
  }

  return "swarm support, validation, and status";
}

function describeSingleSwarmCoordinatorFetchFailure(input: {
  readonly failure: SwarmCoordinatorFetchFailure;
  readonly stale: boolean;
}): string {
  const timedOut = isSwarmCoordinatorFetchTimeoutMessage(input.failure.message);
  const sourceLabel = formatSwarmCoordinatorFetchSource(input.failure.source);
  return input.stale
    ? `Showing the last known ${sourceLabel} because the latest refresh ${timedOut ? "timed out" : "failed"}: ${input.failure.message}`
    : `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request ${timedOut ? "timed out" : "failed"}: ${input.failure.message}`;
}

export function describeSwarmCoordinatorFetchFailure(input: {
  readonly failures: ReadonlyArray<SwarmCoordinatorFetchFailure>;
  readonly stale: boolean;
}): string {
  const failures = input.failures.filter((failure) => failure.message.trim().length > 0);
  const [firstFailure] = failures;

  if (failures.length === 0) {
    return input.stale
      ? "Showing the last known swarm state because the latest refresh failed."
      : "Swarm state request failed.";
  }

  if (failures.length === 1) {
    return describeSingleSwarmCoordinatorFetchFailure({
      failure: firstFailure!,
      stale: input.stale,
    });
  }

  const uniqueMessages = new Set(failures.map((failure) => failure.message));
  if (uniqueMessages.size === 1) {
    const message = firstFailure!.message;
    const sourceLabel = formatSwarmCoordinatorFetchSources(
      failures.map((failure) => failure.source),
    );
    const timedOut = failures.every((failure) =>
      isSwarmCoordinatorFetchTimeoutMessage(failure.message),
    );
    return input.stale
      ? `Showing the last known ${sourceLabel} because the latest refresh ${timedOut ? "timed out" : "failed"}: ${message}`
      : `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request ${timedOut ? "timed out" : "failed"}: ${message}`;
  }

  const detail = failures
    .map((failure) =>
      describeSingleSwarmCoordinatorFetchFailure({
        failure,
        stale: false,
      }),
    )
    .join(" ");
  return input.stale
    ? `Showing the last known swarm state because the latest refresh failed. ${detail}`
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
 * description suitable for direct display. No more "Swarm unknown" fallbacks.
 */
export function describeCoordinatorEpicState(input: {
  readonly stateKind: EpicSwarmCoordinatorStateKind;
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
    case "idle":
      return {
        label: "Idle",
        summary: "Waiting for the next issue to be dispatched.",
        category: "active",
      };
    case "paused":
      return {
        label: "Paused",
        summary: "Run paused. Resume to continue processing issues.",
        category: "active",
      };
    case "blocked":
      return {
        label: "Blocked",
        summary: input.lastError ?? "Needs manual intervention before it can continue.",
        category: "blocked",
      };
    case "failed":
      return {
        label: "Failed",
        summary: input.lastError ?? "The run failed. Retry or inspect the error.",
        category: "blocked",
      };
    case "ready":
      return {
        label: "Ready",
        summary: "Epic structure is ready for coordinated execution.",
        category: "ready",
      };
    case "needs_preparation":
      return {
        label: "Needs prep",
        summary: "Epic structure is invalid. Open a prep thread before starting.",
        category: "setup",
      };
    case "unsupported":
      return {
        label: "Unavailable",
        summary: "This backend does not support swarm coordination.",
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
    case "cancelled":
      return {
        label: "Cancelled",
        summary: "The run was cancelled.",
        category: "done",
      };
    case "checking":
      return {
        label: "Loading",
        summary: input.fetchDetail ?? "Checking swarm state...",
        category: "loading",
      };
    case "timeout":
      return {
        label: "Timed out",
        summary: input.fetchDetail ?? "State request timed out. Retry to refresh.",
        category: "blocked",
      };
    case "stale":
      return {
        label: "Stale",
        summary: input.fetchDetail ?? "Showing last known state. Refresh to update.",
        category: "blocked",
      };
    case "error":
      return {
        label: "Error",
        summary: input.fetchDetail ?? "Could not load swarm state. Retry to refresh.",
        category: "blocked",
      };
  }
}

export function describeSharedWorkspaceProjectConflict(run: OrchestrationSwarmRun): string {
  return `Shared workspace is already busy with ${run.epicIssueId} (${formatSwarmRunStatusLabel(run.status)}). Finish, cancel, or resume that run before starting or resuming another shared-workspace swarm in this project.`;
}

export type SwarmCoordinatorFetchLifecycleKind =
  | "ready"
  | "loading"
  | "timeout"
  | "stale"
  | "error";

export interface SwarmCoordinatorFetchLifecycle {
  readonly kind: SwarmCoordinatorFetchLifecycleKind;
  readonly detail: string | null;
}

export type EpicSwarmCoordinatorStateKind =
  | "checking"
  | "timeout"
  | "stale"
  | "error"
  | "unsupported"
  | "needs_preparation"
  | "ready"
  | "running"
  | "idle"
  | "paused"
  | "blocked"
  | "failed"
  | "cancelled"
  | "completed";

export interface EpicSwarmCoordinatorState {
  readonly kind: EpicSwarmCoordinatorStateKind;
  readonly latestRun: OrchestrationSwarmRun | null;
  readonly fetchLifecycle: SwarmCoordinatorFetchLifecycle;
}

export interface EpicSwarmCoordinatorPrimaryAction {
  readonly kind:
    | "checking"
    | "unsupported"
    | "open_coordination_prep_thread"
    | "refresh_swarm_state"
    | "start_swarm"
    | "continue_swarm"
    | "resume_swarm"
    | "open_coordinator";
  readonly label: string;
  readonly busyLabel: string;
  readonly disabled: boolean;
}

function getFailedSwarmRecoveryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid"> | null;
  readonly hasProjectConflict: boolean;
}): EpicSwarmCoordinatorPrimaryAction {
  if (input.swarmSupport?.supported !== true) {
    return {
      kind: "unsupported",
      label: "Swarm unavailable",
      busyLabel: "Swarm unavailable",
      disabled: true,
    };
  }

  if (input.hasProjectConflict) {
    return {
      kind: "open_coordinator",
      label: "View active swarm",
      busyLabel: "Opening...",
      disabled: false,
    };
  }

  if (input.validation?.valid === false) {
    return {
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    };
  }

  if (input.validation?.valid === true) {
    return {
      kind: "start_swarm",
      label: "Retry swarm",
      busyLabel: "Retrying...",
      disabled: false,
    };
  }

  return {
    kind: "refresh_swarm_state",
    label: "Refresh swarm state",
    busyLabel: "Refreshing...",
    disabled: false,
  };
}

export function deriveEpicSwarmCoordinatorState(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly fetchLifecycle: SwarmCoordinatorFetchLifecycle;
}): EpicSwarmCoordinatorState {
  const latestRun = selectLatestSwarmRun(input.swarmRuns);

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
      kind: latestRun.status === "requested" ? "running" : latestRun.status,
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

export function getEpicSwarmCoordinatorPrimaryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly hasProjectConflict: boolean;
  readonly fetchLifecycle: SwarmCoordinatorFetchLifecycle;
}): EpicSwarmCoordinatorPrimaryAction {
  const state = deriveEpicSwarmCoordinatorState(input);
  const latestRun = state.latestRun;
  const recoverableWorkerFailureRun =
    latestRun?.status === "blocked" && latestRun.blockedContext?.kind === "worker_failure";
  const canContinueRecoverableRun =
    recoverableWorkerFailureRun &&
    input.swarmSupport?.supported === true &&
    input.validation?.valid === true &&
    (() => {
      const nextReadyIssue = selectDeterministicReadyIssue({
        validation: input.validation,
        status: input.status,
      });
      if (nextReadyIssue !== null) {
        return true;
      }

      return (input.status?.active.length ?? 0) === 0 && (input.status?.blocked.length ?? 0) === 0;
    })();

  switch (state.kind) {
    case "checking":
      return {
        kind: "checking",
        label: "Checking swarm...",
        busyLabel: "Checking...",
        disabled: true,
      };
    case "timeout":
      return {
        kind: "refresh_swarm_state",
        label: "Retry swarm state",
        busyLabel: "Retrying...",
        disabled: false,
      };
    case "stale":
      return {
        kind: "refresh_swarm_state",
        label: "Refresh swarm state",
        busyLabel: "Refreshing...",
        disabled: false,
      };
    case "error":
      return {
        kind: "refresh_swarm_state",
        label: "Retry swarm state",
        busyLabel: "Retrying...",
        disabled: false,
      };
    case "unsupported":
      return {
        kind: "unsupported",
        label: "Swarm unavailable",
        busyLabel: "Swarm unavailable",
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
          label: "View active swarm",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      return {
        kind: "start_swarm",
        label: "Start swarm",
        busyLabel: "Starting...",
        disabled: false,
      };
    case "running":
      if (input.hasProjectConflict) {
        return {
          kind: "open_coordinator",
          label: "View active swarm",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      return {
        kind: "open_coordinator",
        label: "Open coordinator",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "idle":
      if (input.hasProjectConflict) {
        return {
          kind: "open_coordinator",
          label: "View active swarm",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      if (latestRun?.schedulerMode === "semi-automatic") {
        return {
          kind: "continue_swarm",
          label: "Continue swarm",
          busyLabel: "Continuing...",
          disabled: false,
        };
      }
      return {
        kind: "open_coordinator",
        label: "Open coordinator",
        busyLabel: "Opening...",
        disabled: false,
      };
    case "paused":
      if (input.hasProjectConflict) {
        return {
          kind: "open_coordinator",
          label: "View active swarm",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      return {
        kind: "resume_swarm",
        label: "Resume swarm",
        busyLabel: "Resuming...",
        disabled: false,
      };
    case "blocked":
      return recoverableWorkerFailureRun
        ? {
            kind: "continue_swarm",
            label: "Continue swarm",
            busyLabel: "Continuing...",
            disabled: !canContinueRecoverableRun,
          }
        : {
            kind: "open_coordinator",
            label: "Open coordinator",
            busyLabel: "Opening...",
            disabled: false,
          };
    case "failed":
      return getFailedSwarmRecoveryAction({
        swarmSupport: input.swarmSupport,
        validation: input.validation,
        hasProjectConflict: input.hasProjectConflict,
      });
    case "cancelled":
      if (input.hasProjectConflict) {
        return {
          kind: "open_coordinator",
          label: "View active swarm",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      return {
        kind: "resume_swarm",
        label: "Resume swarm",
        busyLabel: "Resuming...",
        disabled: false,
      };
    case "completed":
      return {
        kind: "open_coordinator",
        label: "Open coordinator",
        busyLabel: "Opening...",
        disabled: false,
      };
  }
}

export function selectLatestSwarmRun(
  swarmRuns: ReadonlyArray<OrchestrationSwarmRun>,
): OrchestrationSwarmRun | null {
  return [...swarmRuns].toSorted(compareSwarmRunsByPriority)[0] ?? null;
}

export function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
}): OrchestrationSwarmRun | null {
  const epicRunIds = new Set(input.epicSwarmRuns.map((run) => run.runId));
  return (
    input.projectSwarmRuns
      .filter(
        (candidate) =>
          isNonTerminalSharedWorkspaceRun(candidate) && !epicRunIds.has(candidate.runId),
      )
      .toSorted(compareSwarmRunsByPriority)[0] ?? null
  );
}

export function listSwarmRuns(state: SwarmProjectionState): OrchestrationSwarmRun[] {
  return Object.values(state.swarmRunsById).toSorted(compareSwarmRunsByRequestedAt);
}

export function listSwarmTaskExecutions(
  state: SwarmProjectionState,
): OrchestrationSwarmTaskExecution[] {
  return Object.values(state.swarmTaskExecutionsById).toSorted(compareSwarmTaskExecutions);
}

export function createRequestedSwarmRun(
  payload: SwarmRunRequestedEvent["payload"],
): OrchestrationSwarmRun {
  return {
    runId: payload.runId,
    projectId: payload.projectId,
    epicIssueId: payload.epicIssueId,
    status: "requested",
    schedulerMode: payload.schedulerMode,
    workspaceMode: payload.workspaceMode,
    provider: payload.provider,
    model: payload.model,
    modelOptions: payload.modelOptions,
    providerOptions: payload.providerOptions,
    assistantDeliveryMode: payload.assistantDeliveryMode,
    runtimeMode: payload.runtimeMode,
    lastError: null,
    requestedAt: payload.requestedAt,
    startedAt: null,
    idledAt: null,
    pausedAt: null,
    blockedAt: null,
    blockedContext: null,
    failedAt: null,
    cancelledAt: null,
    completedAt: null,
    updatedAt: payload.updatedAt,
  };
}

export function applySwarmRunLifecycleEvent(
  run: OrchestrationSwarmRun,
  event: SwarmRunLifecycleEvent,
): OrchestrationSwarmRun {
  switch (event.type) {
    case "swarm-run.started":
      return {
        ...run,
        status: "running",
        startedAt: event.payload.startedAt,
        lastError: null,
        blockedContext: null,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.idled":
      return {
        ...run,
        status: "idle",
        idledAt: event.payload.idledAt,
        lastError: null,
        blockedContext: null,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.paused":
      return {
        ...run,
        status: "paused",
        pausedAt: event.payload.pausedAt,
        lastError: null,
        blockedContext: null,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.resumed":
      return {
        ...run,
        status: "running",
        lastError: null,
        blockedContext: null,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.blocked":
      return {
        ...run,
        status: "blocked",
        lastError: event.payload.reason,
        blockedAt: event.payload.blockedAt,
        blockedContext: event.payload.blockedContext,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.failed":
      return {
        ...run,
        status: "failed",
        lastError: event.payload.reason,
        blockedContext: null,
        failedAt: event.payload.failedAt,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.cancelled":
      return {
        ...run,
        status: "cancelled",
        lastError: null,
        blockedContext: null,
        cancelledAt: event.payload.cancelledAt,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.completed":
      return {
        ...run,
        status: "completed",
        lastError: null,
        blockedContext: null,
        completedAt: event.payload.completedAt,
        cancelledAt: null,
        updatedAt: event.payload.updatedAt,
      };
  }
}

export function createRequestedSwarmTaskExecution(
  payload: SwarmTaskExecutionRequestedEvent["payload"],
): OrchestrationSwarmTaskExecution {
  return {
    executionId: payload.executionId,
    runId: payload.runId,
    issueId: payload.issueId,
    workerThreadId: payload.workerThreadId,
    sequenceNumber: payload.sequenceNumber,
    status: "requested",
    originalStatus: payload.originalStatus,
    originalAssignee: payload.originalAssignee,
    lastError: null,
    requestedAt: payload.requestedAt,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    updatedAt: payload.updatedAt,
  };
}

export function materializeStartedSwarmTaskExecution(input: {
  readonly event: SwarmTaskExecutionStartedEvent;
  readonly existingExecution: OrchestrationSwarmTaskExecution | null;
}): OrchestrationSwarmTaskExecution {
  const existingExecution = input.existingExecution;
  return {
    executionId: input.event.payload.executionId,
    runId: input.event.payload.runId,
    issueId: existingExecution?.issueId ?? "unknown-task",
    workerThreadId: existingExecution?.workerThreadId ?? null,
    sequenceNumber: existingExecution?.sequenceNumber ?? 0,
    status: "active",
    originalStatus: existingExecution?.originalStatus ?? "open",
    originalAssignee: existingExecution?.originalAssignee ?? null,
    lastError: null,
    requestedAt: existingExecution?.requestedAt ?? input.event.payload.startedAt,
    startedAt: input.event.payload.startedAt,
    completedAt: existingExecution?.completedAt ?? null,
    failedAt: existingExecution?.failedAt ?? null,
    cancelledAt: existingExecution?.cancelledAt ?? null,
    updatedAt: input.event.payload.updatedAt,
  };
}

export function applySwarmTaskExecutionLifecycleEvent(
  execution: OrchestrationSwarmTaskExecution,
  event: SwarmTaskExecutionLifecycleEvent,
): OrchestrationSwarmTaskExecution {
  switch (event.type) {
    case "swarm-task-execution.completed":
      return {
        ...execution,
        status: "completed",
        lastError: null,
        completedAt: event.payload.completedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-task-execution.failed":
      return {
        ...execution,
        status: "failed",
        lastError: event.payload.reason,
        failedAt: event.payload.failedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-task-execution.cancelled":
      return {
        ...execution,
        status: "cancelled",
        lastError: null,
        cancelledAt: event.payload.cancelledAt,
        updatedAt: event.payload.updatedAt,
      };
  }
}

export function projectSwarmEvent(
  state: SwarmProjectionState,
  event: OrchestrationEvent,
): SwarmProjectionState {
  switch (event.type) {
    case "swarm-run.requested": {
      const run = createRequestedSwarmRun(event.payload);
      return {
        ...state,
        swarmRunsById: {
          ...state.swarmRunsById,
          [run.runId]: run,
        },
      };
    }
    case "swarm-run.started":
    case "swarm-run.idled":
    case "swarm-run.paused":
    case "swarm-run.resumed":
    case "swarm-run.blocked":
    case "swarm-run.failed":
    case "swarm-run.cancelled":
    case "swarm-run.completed": {
      const currentRun = state.swarmRunsById[event.payload.runId];
      if (!currentRun) {
        return state;
      }
      return {
        ...state,
        swarmRunsById: {
          ...state.swarmRunsById,
          [currentRun.runId]: applySwarmRunLifecycleEvent(currentRun, event),
        },
      };
    }
    case "swarm-task-execution.requested": {
      const execution = createRequestedSwarmTaskExecution(event.payload);
      const run = state.swarmRunsById[event.payload.runId];
      return {
        swarmRunsById:
          run === undefined
            ? state.swarmRunsById
            : {
                ...state.swarmRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        swarmTaskExecutionsById: {
          ...state.swarmTaskExecutionsById,
          [execution.executionId]: execution,
        },
      };
    }
    case "swarm-task-execution.started": {
      const existingExecution = state.swarmTaskExecutionsById[event.payload.executionId] ?? null;
      const execution = materializeStartedSwarmTaskExecution({
        event,
        existingExecution,
      });
      const run = state.swarmRunsById[event.payload.runId];
      return {
        swarmRunsById:
          run === undefined
            ? state.swarmRunsById
            : {
                ...state.swarmRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        swarmTaskExecutionsById: {
          ...state.swarmTaskExecutionsById,
          [execution.executionId]: execution,
        },
      };
    }
    case "swarm-task-execution.completed":
    case "swarm-task-execution.failed":
    case "swarm-task-execution.cancelled": {
      const execution = state.swarmTaskExecutionsById[event.payload.executionId];
      const run = state.swarmRunsById[event.payload.runId];
      return {
        swarmRunsById:
          run === undefined
            ? state.swarmRunsById
            : {
                ...state.swarmRunsById,
                [run.runId]: {
                  ...run,
                  updatedAt: event.payload.updatedAt,
                },
              },
        swarmTaskExecutionsById:
          execution === undefined
            ? state.swarmTaskExecutionsById
            : {
                ...state.swarmTaskExecutionsById,
                [execution.executionId]: applySwarmTaskExecutionLifecycleEvent(execution, event),
              },
      };
    }
    default:
      return state;
  }
}

export function deriveSwarmRunExecutionState(input: {
  readonly runId: OrchestrationSwarmRun["runId"];
  readonly executions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): {
  readonly activeExecution: OrchestrationSwarmTaskExecution | null;
  readonly currentExecution: OrchestrationSwarmTaskExecution | null;
  readonly latestExecution: OrchestrationSwarmTaskExecution | null;
  readonly nonTerminalExecutions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
} {
  let latestExecution: OrchestrationSwarmTaskExecution | null = null;
  let activeExecution: OrchestrationSwarmTaskExecution | null = null;
  const nonTerminalExecutions: OrchestrationSwarmTaskExecution[] = [];

  for (const execution of input.executions) {
    if (execution.runId !== input.runId) {
      continue;
    }

    if (latestExecution === null || compareSwarmTaskExecutions(latestExecution, execution) < 0) {
      latestExecution = execution;
    }

    if (isNonTerminalSwarmTaskExecutionStatus(execution.status)) {
      nonTerminalExecutions.push(execution);
    }

    if (
      execution.status === "active" &&
      (activeExecution === null || compareSwarmTaskExecutions(activeExecution, execution) < 0)
    ) {
      activeExecution = execution;
    }
  }

  const orderedNonTerminalExecutions = nonTerminalExecutions.toSorted(compareSwarmTaskExecutions);

  return {
    activeExecution,
    currentExecution: orderedNonTerminalExecutions.at(-1) ?? null,
    latestExecution,
    nonTerminalExecutions: orderedNonTerminalExecutions,
  };
}
