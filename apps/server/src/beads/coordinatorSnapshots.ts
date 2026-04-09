import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorFetchLifecycle,
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
  describeSwarmCoordinatorFetchFailure,
  deriveSwarmRunExecutionState,
  deriveEpicSwarmCoordinatorState,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
  getEpicSwarmCoordinatorPrimaryAction,
  isSwarmCoordinatorFetchTimeoutMessage,
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

function deriveFetchLifecycle(input: {
  readonly validationError: string | null;
  readonly statusError: string | null;
}): BeadsCoordinatorFetchLifecycle {
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
    return { kind: "ready", detail: null };
  }

  return {
    kind: failures.some((failure) => isSwarmCoordinatorFetchTimeoutMessage(failure.message))
      ? "timeout"
      : "error",
    detail: describeSwarmCoordinatorFetchFailure({
      failures,
      stale: false,
    }),
  };
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
  const coordinatorState = deriveEpicSwarmCoordinatorState({
    swarmSupport: { supported: input.support.supported },
    status: input.status,
    validation: input.validation,
    swarmRuns: input.epicSwarmRuns,
    fetchLifecycle,
  });
  const activeExecution =
    coordinatorState.latestRun === null
      ? null
      : deriveSwarmRunExecutionState({
          runId: coordinatorState.latestRun.runId,
          executions: input.epicExecutions,
        }).activeExecution;

  return {
    epicId: input.issue?.id ?? input.fallbackEpicId,
    epicTitle: input.issue?.title ?? input.fallbackEpicTitle,
    issue: input.issue,
    fetchLifecycle: coordinatorState.fetchLifecycle,
    stateKind: coordinatorState.kind,
    primaryAction: getEpicSwarmCoordinatorPrimaryAction({
      swarmSupport: { supported: input.support.supported },
      status: input.status,
      validation: input.validation,
      swarmRuns: input.epicSwarmRuns,
      hasProjectConflict: projectConflict !== null,
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
