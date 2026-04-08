import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorFetchLifecycle,
  BeadsCoordinatorPrimaryAction,
  BeadsCoordinatorProjectConflict,
  BeadsIssueDetail,
  BeadsIssueSummary,
  BeadsProjectCoordinatorSnapshot,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  OrchestrationReadModel,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ProjectId,
} from "@t3tools/contracts";
import { selectDeterministicReadyIssue } from "@t3tools/shared/swarm";

const NON_TERMINAL_SWARM_RUN_STATUSES = new Set<OrchestrationSwarmRun["status"]>([
  "requested",
  "running",
  "idle",
  "paused",
  "blocked",
]);

function compareSwarmRunsByPriority(
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

function isNonTerminalSharedWorkspaceRun(run: OrchestrationSwarmRun): boolean {
  return run.workspaceMode === "shared" && NON_TERMINAL_SWARM_RUN_STATUSES.has(run.status);
}

function formatSwarmRunStatusLabel(status: OrchestrationSwarmRun["status"]): string {
  return status === "requested" ? "requested" : status.replace(/_/g, " ");
}

function isTimeoutErrorMessage(message: string): boolean {
  return /\b(?:timed?\s*out|timeout)\b/i.test(message);
}

function formatFetchSources(sources: ReadonlyArray<"validation" | "status">): string {
  if (sources.length === 1) {
    return `swarm ${sources[0]}`;
  }

  if (sources.length === 2) {
    return `swarm ${sources[0]} and ${sources[1]}`;
  }

  return "swarm state";
}

function describeCoordinatorFetchFailure(input: {
  readonly sources: ReadonlyArray<"validation" | "status">;
  readonly timedOut: boolean;
}): string {
  const sourceLabel = formatFetchSources(input.sources);
  return input.timedOut
    ? `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request timed out. Retry the coordinator state request or inspect the backend error.`
    : `${sourceLabel.charAt(0).toUpperCase()}${sourceLabel.slice(1)} request failed. Retry the coordinator state request or inspect the backend error.`;
}

function selectLatestSwarmRun(
  swarmRuns: ReadonlyArray<OrchestrationSwarmRun>,
): OrchestrationSwarmRun | null {
  return [...swarmRuns].toSorted(compareSwarmRunsByPriority)[0] ?? null;
}

function describeSharedWorkspaceProjectConflict(
  run: OrchestrationSwarmRun,
): BeadsCoordinatorProjectConflict {
  return {
    run,
    message: `Shared workspace is already busy with ${run.epicIssueId} (${formatSwarmRunStatusLabel(run.status)}). Finish, cancel, or resume that run before starting or resuming another shared-workspace swarm in this project.`,
  };
}

function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
}): BeadsCoordinatorProjectConflict | null {
  const epicRunIds = new Set(input.epicSwarmRuns.map((run) => run.runId));
  const run =
    input.projectSwarmRuns
      .filter(
        (candidate) =>
          isNonTerminalSharedWorkspaceRun(candidate) && !epicRunIds.has(candidate.runId),
      )
      .toSorted(compareSwarmRunsByPriority)[0] ?? null;

  return run ? describeSharedWorkspaceProjectConflict(run) : null;
}

function deriveFetchLifecycle(input: {
  readonly validationError: string | null;
  readonly statusError: string | null;
}): BeadsCoordinatorFetchLifecycle {
  const failedSources = [
    input.validationError ? ("validation" as const) : null,
    input.statusError ? ("status" as const) : null,
  ].filter((value): value is "validation" | "status" => value !== null);

  if (failedSources.length === 0) {
    return { kind: "ready", detail: null };
  }

  const timedOut = [input.validationError, input.statusError].some(
    (error): error is string => error !== null && isTimeoutErrorMessage(error),
  );

  return {
    kind: timedOut ? "timeout" : "error",
    detail: describeCoordinatorFetchFailure({
      sources: failedSources,
      timedOut,
    }),
  };
}

function deriveEpicCoordinatorState(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly fetchLifecycle: BeadsCoordinatorFetchLifecycle;
}) {
  const latestRun = selectLatestSwarmRun(input.swarmRuns);

  if (input.fetchLifecycle.kind === "loading") {
    return {
      kind: "checking" as const,
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "timeout") {
    return {
      kind: "timeout" as const,
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "stale") {
    return {
      kind: "stale" as const,
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.fetchLifecycle.kind === "error") {
    return {
      kind: "error" as const,
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.swarmSupport?.supported !== true) {
    return {
      kind: "unsupported" as const,
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (latestRun !== null) {
    return {
      kind: (latestRun.status === "requested" ? "running" : latestRun.status) as
        | "running"
        | "idle"
        | "paused"
        | "blocked"
        | "failed"
        | "cancelled"
        | "completed",
      latestRun,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  const swarm = input.validation?.swarm ?? input.status?.swarm ?? null;
  if (swarm === null) {
    return {
      kind: "no_swarm" as const,
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.validation?.valid === false) {
    return {
      kind: "needs_repair" as const,
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  if (input.validation?.valid === true) {
    return {
      kind: "ready" as const,
      latestRun: null,
      fetchLifecycle: input.fetchLifecycle,
    };
  }

  return {
    kind: "checking" as const,
    latestRun: null,
    fetchLifecycle: input.fetchLifecycle,
  };
}

function getEpicCoordinatorPrimaryAction(input: {
  readonly swarmSupport: Pick<BeadsSwarmSupport, "supported"> | null;
  readonly status: Pick<BeadsSwarmStatus, "swarm" | "ready" | "active" | "blocked"> | null;
  readonly validation: Pick<BeadsSwarmValidation, "valid" | "swarm" | "readyFronts"> | null;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly projectConflict: BeadsCoordinatorProjectConflict | null;
  readonly fetchLifecycle: BeadsCoordinatorFetchLifecycle;
}): BeadsCoordinatorPrimaryAction {
  const state = deriveEpicCoordinatorState(input);
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
      if (input.projectConflict) {
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
      if (input.projectConflict) {
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

function toIssueSummary(issue: BeadsIssueDetail | BeadsIssueSummary): BeadsIssueSummary {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    notes: issue.notes,
    status: issue.status,
    priority: issue.priority,
    issueType: issue.issueType,
    assignee: issue.assignee,
    owner: issue.owner,
    createdAt: issue.createdAt,
    createdBy: issue.createdBy,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    parent: issue.parent,
    dependencyCount: issue.dependencyCount,
    dependentCount: issue.dependentCount,
    commentCount: issue.commentCount,
  };
}

function buildCoordinatorEpicEntries(input: {
  readonly epicIssues: ReadonlyArray<BeadsIssueSummary>;
  readonly swarms: ReadonlyArray<BeadsSwarmSummary>;
  readonly swarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
}) {
  const entries = new Map<
    string,
    {
      epicId: string;
      epicTitle: string;
      issue: BeadsIssueSummary | null;
    }
  >();

  for (const issue of input.epicIssues) {
    entries.set(issue.id, {
      epicId: issue.id,
      epicTitle: issue.title,
      issue,
    });
  }

  for (const swarm of input.swarms) {
    if (!entries.has(swarm.epicId)) {
      entries.set(swarm.epicId, {
        epicId: swarm.epicId,
        epicTitle: swarm.epicTitle,
        issue: null,
      });
    }
  }

  for (const run of input.swarmRuns) {
    if (!entries.has(run.epicIssueId)) {
      entries.set(run.epicIssueId, {
        epicId: run.epicIssueId,
        epicTitle: run.epicIssueId,
        issue: null,
      });
    }
  }

  return [...entries.values()];
}

export function buildCoordinatorEpicSnapshot(input: {
  readonly issue: BeadsIssueSummary | null;
  readonly support: BeadsSwarmSupport;
  readonly validation: BeadsSwarmValidation | null;
  readonly status: BeadsSwarmStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicExecutions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
  readonly fallbackEpicId: string;
  readonly fallbackEpicTitle: string;
}): BeadsCoordinatorEpicSnapshot {
  const fetchLifecycle = deriveFetchLifecycle({
    validationError: input.validationError,
    statusError: input.statusError,
  });
  const projectConflict = findConflictingSharedWorkspaceRun({
    projectSwarmRuns: input.projectSwarmRuns,
    epicSwarmRuns: input.epicSwarmRuns,
  });
  const coordinatorState = deriveEpicCoordinatorState({
    swarmSupport: { supported: input.support.supported },
    status: input.status,
    validation: input.validation,
    swarmRuns: input.epicSwarmRuns,
    fetchLifecycle,
  });
  const activeExecutionId =
    coordinatorState.latestRun?.activeTaskExecutionId ??
    coordinatorState.latestRun?.latestTaskExecutionId ??
    null;
  const activeExecution =
    activeExecutionId === null
      ? null
      : (input.epicExecutions.find((execution) => execution.executionId === activeExecutionId) ??
        null);

  return {
    epicId: input.issue?.id ?? input.fallbackEpicId,
    epicTitle: input.issue?.title ?? input.fallbackEpicTitle,
    issue: input.issue,
    fetchLifecycle: coordinatorState.fetchLifecycle,
    stateKind: coordinatorState.kind,
    primaryAction: getEpicCoordinatorPrimaryAction({
      swarmSupport: { supported: input.support.supported },
      status: input.status,
      validation: input.validation,
      swarmRuns: input.epicSwarmRuns,
      projectConflict,
      fetchLifecycle,
    }),
    latestRun: coordinatorState.latestRun,
    projectConflict,
    swarmSummary: input.validation?.swarm ?? input.status?.swarm ?? null,
    validation: input.validation,
    status: input.status,
    runs: input.epicSwarmRuns,
    executions: input.epicExecutions,
    activeExecution,
  };
}

export function buildProjectCoordinatorSnapshot(input: {
  readonly projectId: ProjectId;
  readonly support: BeadsSwarmSupport;
  readonly epicIssues: ReadonlyArray<BeadsIssueSummary>;
  readonly swarms: ReadonlyArray<BeadsSwarmSummary>;
  readonly readModel: OrchestrationReadModel;
  readonly perEpicState: ReadonlyMap<
    string,
    {
      readonly validation: BeadsSwarmValidation | null;
      readonly status: BeadsSwarmStatus | null;
      readonly validationError: string | null;
      readonly statusError: string | null;
    }
  >;
}): BeadsProjectCoordinatorSnapshot {
  const projectSwarmRuns = input.readModel.swarmRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const projectRunIds = new Set(projectSwarmRuns.map((run) => run.runId));
  const executionsByRunId = new Map<
    OrchestrationSwarmRun["runId"],
    OrchestrationSwarmTaskExecution[]
  >();

  for (const execution of input.readModel.swarmTaskExecutions) {
    if (!projectRunIds.has(execution.runId)) {
      continue;
    }

    const existing = executionsByRunId.get(execution.runId);
    if (existing) {
      existing.push(execution);
    } else {
      executionsByRunId.set(execution.runId, [execution]);
    }
  }

  const epics = buildCoordinatorEpicEntries({
    epicIssues: input.epicIssues,
    swarms: input.swarms,
    swarmRuns: projectSwarmRuns,
  }).map((epic) => {
    const epicSwarmRuns = projectSwarmRuns.filter((run) => run.epicIssueId === epic.epicId);
    const epicExecutions = epicSwarmRuns.flatMap((run) => executionsByRunId.get(run.runId) ?? []);
    const state = input.perEpicState.get(epic.epicId);

    return buildCoordinatorEpicSnapshot({
      issue: epic.issue,
      support: input.support,
      validation: state?.validation ?? null,
      status: state?.status ?? null,
      validationError: state?.validationError ?? null,
      statusError: state?.statusError ?? null,
      projectSwarmRuns,
      epicSwarmRuns,
      epicExecutions,
      fallbackEpicId: epic.epicId,
      fallbackEpicTitle: epic.epicTitle,
    });
  });

  return {
    projectId: input.projectId,
    support: input.support,
    epics,
  };
}

export function buildSingleEpicCoordinatorSnapshot(input: {
  readonly projectId: ProjectId;
  readonly support: BeadsSwarmSupport;
  readonly issue: BeadsIssueDetail | BeadsIssueSummary;
  readonly validation: BeadsSwarmValidation | null;
  readonly status: BeadsSwarmStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
  readonly readModel: OrchestrationReadModel;
}): BeadsCoordinatorEpicSnapshot {
  const issueSummary = toIssueSummary(input.issue);
  const projectSwarmRuns = input.readModel.swarmRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const epicSwarmRuns = projectSwarmRuns.filter((run) => run.epicIssueId === issueSummary.id);
  const epicRunIds = new Set(epicSwarmRuns.map((run) => run.runId));
  const epicExecutions = input.readModel.swarmTaskExecutions.filter((execution) =>
    epicRunIds.has(execution.runId),
  );

  return buildCoordinatorEpicSnapshot({
    issue: issueSummary,
    support: input.support,
    validation: input.validation,
    status: input.status,
    validationError: input.validationError,
    statusError: input.statusError,
    projectSwarmRuns,
    epicSwarmRuns,
    epicExecutions,
    fallbackEpicId: issueSummary.id,
    fallbackEpicTitle: issueSummary.title,
  });
}
