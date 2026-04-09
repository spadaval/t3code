import type {
  BeadsCoordinatorEpicSnapshot,
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
import {
  compareSwarmRunsByRequestedAtDesc,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  deriveActiveExecutionId,
  deriveActiveRunId,
  deriveSwarmProgress,
  deriveTrackerLoadState,
  deriveTrackerState,
  deriveValidationState,
  findActiveSwarmRuns,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
} from "@t3tools/shared/swarm";

function describeSharedWorkspaceProjectConflict(
  run: OrchestrationSwarmRun,
): BeadsCoordinatorProjectConflict {
  return {
    run,
    message: describeSharedWorkspaceProjectConflictMessage(run),
  };
}

function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationSwarmRun>;
}): BeadsCoordinatorProjectConflict | null {
  const run = findConflictingSharedWorkspaceRunCore(input);
  return run ? describeSharedWorkspaceProjectConflict(run) : null;
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

function deriveEpicPrimaryAction(input: {
  readonly epicId: string;
  readonly coordinationSupported: boolean;
  readonly validationState: BeadsCoordinatorEpicSnapshot["validationState"];
  readonly trackerLoadState: BeadsCoordinatorEpicSnapshot["trackerLoadState"];
  readonly trackerState: BeadsCoordinatorEpicSnapshot["trackerState"];
  readonly projectConflict: BeadsCoordinatorEpicSnapshot["projectConflict"];
  readonly latestRun: OrchestrationSwarmRun | null;
  readonly activeRun: OrchestrationSwarmRun | null;
  readonly status: Pick<BeadsSwarmStatus, "ready" | "active" | "blocked"> | null;
}): BeadsCoordinatorEpicSnapshot["primaryAction"] {
  if (input.trackerLoadState === "timeout" || input.trackerLoadState === "error") {
    return {
      kind: "refresh_swarm_state",
      label: "Retry tracker status",
      busyLabel: "Retrying...",
      disabled: false,
    };
  }

  if (!input.coordinationSupported) {
    return {
      kind: "unsupported",
      label: "Epic coordination unavailable",
      busyLabel: "Epic coordination unavailable",
      disabled: true,
    };
  }

  if (input.validationState === "invalid") {
    return {
      kind: "open_coordination_prep_thread",
      label: "Open prep thread",
      busyLabel: "Opening...",
      disabled: false,
    };
  }

  if (input.projectConflict !== null) {
    return {
      kind: "open_coordinator",
      label: "View active epic",
      busyLabel: "Opening...",
      disabled: false,
    };
  }

  if (input.activeRun !== null) {
    switch (input.activeRun.status) {
      case "paused":
        return {
          kind: "resume_paused_swarm_run",
          label: "Resume run",
          busyLabel: "Resuming...",
          disabled: false,
        };
      case "idle":
        if (input.activeRun.schedulerMode === "semi-automatic") {
          return {
            kind: "run_next_swarm_task",
            label: "Run next task",
            busyLabel: "Running...",
            disabled: false,
          };
        }
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
      case "blocked": {
        const canContinue =
          input.validationState === "valid" &&
          ((input.status?.ready.length ?? 0) > 0 ||
            ((input.status?.active.length ?? 0) === 0 &&
              (input.status?.blocked.length ?? 0) === 0));
        if (input.activeRun.blockedContext?.kind === "worker_failure") {
          return {
            kind: "run_next_swarm_task",
            label: "Run next task",
            busyLabel: "Running...",
            disabled: !canContinue,
          };
        }
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
      }
      default:
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
    }
  }

  if (input.validationState === "valid" && input.trackerState !== "completed") {
    return {
      kind: "start_swarm",
      label: "Start run",
      busyLabel: "Starting...",
      disabled: false,
    };
  }

  return {
    kind: "open_coordinator",
    label: input.latestRun === null ? "Completed" : "Open epic",
    busyLabel: input.latestRun === null ? "Completed" : "Opening...",
    disabled: input.latestRun === null,
  };
}

function deriveIntegrityError(input: {
  readonly epicId: string;
  readonly runs: ReadonlyArray<OrchestrationSwarmRun>;
  readonly executions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): string | null {
  const activeRuns = findActiveSwarmRuns(input.runs);
  if (activeRuns.length > 1) {
    return `Coordinator integrity error for ${input.epicId}: multiple non-terminal runs exist for the same epic.`;
  }

  const activeRun = activeRuns[0] ?? null;
  if (activeRun === null) {
    return null;
  }

  const nonTerminalExecutions = input.executions.filter(
    (execution) =>
      execution.runId === activeRun.runId &&
      (execution.status === "requested" || execution.status === "active"),
  );
  if (nonTerminalExecutions.length > 1) {
    return `Coordinator integrity error for ${input.epicId}: run '${activeRun.runId}' has multiple non-terminal executions.`;
  }

  return null;
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
  const runs = [...input.epicSwarmRuns].toSorted(compareSwarmRunsByRequestedAtDesc);
  const latestRun = runs[0] ?? null;
  const integrityError = deriveIntegrityError({
    epicId: input.issue?.id ?? input.fallbackEpicId,
    runs,
    executions: input.epicExecutions,
  });

  const loadState = deriveTrackerLoadState({
    validationError: input.validationError,
    statusError: input.statusError,
  });
  const trackerLoadState = integrityError === null ? loadState.trackerLoadState : "error";
  const trackerLoadDetail = integrityError === null ? loadState.trackerLoadDetail : integrityError;
  const coordinationSupported = input.support.supported;
  const validationState = deriveValidationState({
    trackerLoadState,
    validation: input.validation,
  });
  const progress = deriveSwarmProgress({
    validation: input.validation,
    status: input.status,
  });
  const trackerState = deriveTrackerState({
    trackerLoadState,
    status: input.status,
    progress,
  });
  const projectConflict = findConflictingSharedWorkspaceRun({
    projectSwarmRuns: input.projectSwarmRuns,
    epicSwarmRuns: runs,
  });
  const activeRunId = integrityError === null ? deriveActiveRunId(runs) : null;
  const activeRun =
    activeRunId === null ? null : (runs.find((run) => run.runId === activeRunId) ?? null);
  const activeExecutionId =
    integrityError === null
      ? deriveActiveExecutionId({
          activeRunId,
          executions: input.epicExecutions,
        })
      : null;

  return {
    epicId: input.issue?.id ?? input.fallbackEpicId,
    epicTitle: input.issue?.title ?? input.fallbackEpicTitle,
    issue: input.issue,
    trackerLoadState,
    trackerLoadDetail,
    coordinationSupported,
    coordinationUnsupportedReason: input.support.reason,
    validationState,
    validationErrors: validationState === "invalid" ? (input.validation?.errors ?? []) : [],
    trackerState,
    progress,
    primaryAction: deriveEpicPrimaryAction({
      epicId: input.issue?.id ?? input.fallbackEpicId,
      coordinationSupported,
      validationState,
      trackerLoadState,
      trackerState,
      projectConflict,
      latestRun,
      activeRun,
      status: input.status,
    }),
    activeRunId,
    activeExecutionId,
    projectConflict,
    swarmSummary: input.validation?.swarm ?? input.status?.swarm ?? null,
    validation: input.validation,
    status: input.status,
    runs,
    executions: input.epicExecutions,
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
