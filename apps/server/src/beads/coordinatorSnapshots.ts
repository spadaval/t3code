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
  deriveSwarmRunExecutionState,
  describeSharedWorkspaceProjectConflict as describeSharedWorkspaceProjectConflictMessage,
  deriveEpicSwarmCoordinatorState,
  findConflictingSharedWorkspaceRun as findConflictingSharedWorkspaceRunCore,
  getEpicSwarmCoordinatorPrimaryAction,
} from "@t3tools/shared/swarm";

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
