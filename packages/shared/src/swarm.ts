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
  for (const front of input.validation?.readyFronts ?? []) {
    const issue = selectDeterministicReadyIssueFromList(front);
    if (issue) {
      return issue;
    }
  }

  return selectDeterministicReadyIssueFromList(input.status?.ready ?? []);
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
  | "no_swarm"
  | "needs_repair"
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
    | "create_swarm"
    | "repair_swarm"
    | "refresh_swarm_state"
    | "start_swarm"
    | "continue_swarm"
    | "open_coordinator";
  readonly label: string;
  readonly busyLabel: string;
  readonly disabled: boolean;
}

function getFailedSwarmRecoveryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
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

  const swarm = input.validation?.swarm ?? input.status?.swarm ?? null;
  if (swarm === null) {
    return {
      kind: "create_swarm",
      label: "Create swarm",
      busyLabel: "Starting...",
      disabled: false,
    };
  }

  if (input.validation?.valid === false) {
    return {
      kind: "repair_swarm",
      label: "Repair swarm",
      busyLabel: "Starting...",
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
    label: "Refresh swarm status",
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

  const swarm = input.validation?.swarm ?? input.status?.swarm ?? null;
  if (swarm === null) {
    return {
      kind: "no_swarm",
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.validation?.valid === false) {
    return {
      kind: "needs_repair",
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
        label: "Retry swarm status",
        busyLabel: "Retrying...",
        disabled: false,
      };
    case "stale":
      return {
        kind: "refresh_swarm_state",
        label: "Refresh swarm status",
        busyLabel: "Refreshing...",
        disabled: false,
      };
    case "error":
      return {
        kind: "refresh_swarm_state",
        label: "Retry swarm status",
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
    case "no_swarm":
      return {
        kind: "create_swarm",
        label: "Create swarm",
        busyLabel: "Starting...",
        disabled: false,
      };
    case "needs_repair":
      return {
        kind: "repair_swarm",
        label: "Repair swarm",
        busyLabel: "Starting...",
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
    case "idle":
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
        kind: "open_coordinator",
        label: "Open coordinator",
        busyLabel: "Opening...",
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
        status: input.status,
        validation: input.validation,
        hasProjectConflict: input.hasProjectConflict,
      });
    case "cancelled":
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
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.idled":
      return {
        ...run,
        status: "idle",
        idledAt: event.payload.idledAt,
        lastError: null,
        blockedContext: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.paused":
      return {
        ...run,
        status: "paused",
        pausedAt: event.payload.pausedAt,
        lastError: null,
        blockedContext: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.resumed":
      return {
        ...run,
        status: "running",
        lastError: null,
        blockedContext: null,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.blocked":
      return {
        ...run,
        status: "blocked",
        lastError: event.payload.reason,
        blockedAt: event.payload.blockedAt,
        blockedContext: event.payload.blockedContext,
        updatedAt: event.payload.updatedAt,
      };
    case "swarm-run.failed":
      return {
        ...run,
        status: "failed",
        lastError: event.payload.reason,
        blockedContext: null,
        failedAt: event.payload.failedAt,
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
