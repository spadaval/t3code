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
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  ProjectId,
} from "@t3tools/contracts";
import {
  compareEpicRunsByRequestedAtDesc,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  deriveActiveExecutionId,
  deriveActiveRunId,
  deriveExecutionBlocking,
  deriveEpicTrackerProgress,
  deriveTrackerLoadState,
  deriveTrackerState,
  deriveValidationState,
  findActiveEpicRuns,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
} from "@t3tools/shared/epicRun";

function describeSharedWorkspaceProjectConflict(
  run: OrchestrationEpicRun,
): BeadsCoordinatorProjectConflict {
  return {
    run,
    message: describeSharedWorkspaceProjectConflictMessage(run),
  };
}

function findConflictingSharedWorkspaceRun(input: {
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
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
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
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

  for (const run of input.epicRuns) {
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
  readonly latestRun: OrchestrationEpicRun | null;
  readonly activeRun: OrchestrationEpicRun | null;
  readonly status: Pick<
    BeadsSwarmStatus,
    "ready" | "active" | "blocked" | "blockedBreakdown"
  > | null;
}): BeadsCoordinatorEpicSnapshot["primaryAction"] {
  const executionBlocking = deriveExecutionBlocking(input.status);

  if (input.trackerLoadState === "timeout" || input.trackerLoadState === "error") {
    return {
      kind: "refresh_epic_status",
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
      case "running":
        return {
          kind: "stop_epic_run",
          label: "Stop run",
          busyLabel: "Stopping...",
          disabled: false,
        };
      case "pending":
      case "stopping":
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
      case "stopped":
      case "failed":
      case "completed":
        return {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
          disabled: false,
        };
    }
  }

  if (
    input.validationState === "valid" &&
    input.trackerState !== "completed" &&
    !executionBlocking.hasExecutionBlockingIssues
  ) {
    return {
      kind: "start_epic_run",
      label: "Start run",
      busyLabel: "Starting...",
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
    kind: "open_coordinator",
    label: input.latestRun === null ? "Completed" : "Open epic",
    busyLabel: input.latestRun === null ? "Completed" : "Opening...",
    disabled: input.latestRun === null,
  };
}

function deriveIntegrityError(input: {
  readonly epicId: string;
  readonly runs: ReadonlyArray<OrchestrationEpicRun>;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): string | null {
  const activeRuns = findActiveEpicRuns(input.runs);
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
      (execution.status === "launching" ||
        execution.status === "running" ||
        execution.status === "stopping"),
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
  readonly projectSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicSwarmRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicExecutions: ReadonlyArray<OrchestrationEpicIssueExecution>;
  readonly fallbackEpicId: string;
  readonly fallbackEpicTitle: string;
}): BeadsCoordinatorEpicSnapshot {
  const runs = [...input.epicSwarmRuns].toSorted(compareEpicRunsByRequestedAtDesc);
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
  const progress = deriveEpicTrackerProgress({
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
  const projectSwarmRuns = input.readModel.epicRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const projectRunIds = new Set(projectSwarmRuns.map((run) => run.runId));
  const executionsByRunId = new Map<
    OrchestrationEpicRun["runId"],
    OrchestrationEpicIssueExecution[]
  >();

  for (const execution of input.readModel.epicIssueExecutions) {
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
    epicRuns: projectSwarmRuns,
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
  const projectSwarmRuns = input.readModel.epicRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const epicSwarmRuns = projectSwarmRuns.filter((run) => run.epicIssueId === issueSummary.id);
  const epicRunIds = new Set(epicSwarmRuns.map((run) => run.runId));
  const epicExecutions = input.readModel.epicIssueExecutions.filter((execution) =>
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
