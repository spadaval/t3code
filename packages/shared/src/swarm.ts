import type {
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
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
    swarmId: payload.swarmId,
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
