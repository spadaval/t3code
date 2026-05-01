import type {
  BeadsCoordinatorProgress,
  BeadsCoordinatorEpicSnapshot,
  BeadsCoordinatorProjectConflict,
  BeadsEpicIssueSummaries,
  BeadsEpicCoordinationDetail,
  BeadsIssueDetail,
  BeadsIssueSummary,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsProjectRunSummary,
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
  deriveEpicExecutionControl,
  deriveEpicCoordinationProgress,
  deriveCoordinationLoadState,
  deriveCoordinationState,
  deriveCoordinationValidationState,
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
  readonly projectEpicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
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
    dependencyRefs: issue.dependencyRefs,
    dependencyCount: issue.dependencyCount,
    dependentCount: issue.dependentCount,
    commentCount: issue.commentCount,
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
  readonly validation: BeadsEpicCoordinationValidation | null;
  readonly status: BeadsEpicCoordinationStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
  readonly projectEpicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicExecutions: ReadonlyArray<OrchestrationEpicIssueExecution>;
  readonly fallbackEpicId: string;
  readonly fallbackEpicTitle: string;
}): BeadsCoordinatorEpicSnapshot {
  const runs = [...input.epicRuns].toSorted(compareEpicRunsByRequestedAtDesc);
  const integrityError = deriveIntegrityError({
    epicId: input.issue?.id ?? input.fallbackEpicId,
    runs,
    executions: input.epicExecutions,
  });

  const loadState = deriveCoordinationLoadState({
    validationError: input.validationError,
    statusError: input.statusError,
  });
  const coordinationLoadState = integrityError === null ? loadState.coordinationLoadState : "error";
  const coordinationLoadDetail =
    integrityError === null ? loadState.coordinationLoadDetail : integrityError;
  const validationState = deriveCoordinationValidationState({
    coordinationLoadState,
    validation: input.validation,
  });
  const progress = deriveEpicCoordinationProgress({
    validation: input.validation,
    status: input.status,
  });
  const coordinationState = deriveCoordinationState({
    coordinationLoadState,
    status: input.status,
    progress,
  });
  const projectConflict = findConflictingSharedWorkspaceRun({
    projectEpicRuns: input.projectEpicRuns,
    epicRuns: runs,
  });
  const activeRunId = integrityError === null ? deriveActiveRunId(runs) : null;
  const activeExecutionId =
    integrityError === null
      ? deriveActiveExecutionId({
          activeRunId,
          executions: input.epicExecutions,
        })
      : null;
  const executionControl = deriveEpicExecutionControl({
    status: input.status,
    validation: input.validation,
    epicRuns: runs,
    hasProjectConflict: projectConflict !== null,
    fetchLifecycle: {
      kind:
        coordinationLoadState === "ready"
          ? "ready"
          : coordinationLoadState === "timeout"
            ? "timeout"
            : "error",
      detail: coordinationLoadDetail,
    },
  });

  return {
    epicId: input.issue?.id ?? input.fallbackEpicId,
    epicTitle: input.issue?.title ?? input.fallbackEpicTitle,
    issue: input.issue,
    coordinationLoadState,
    coordinationLoadDetail,
    validationState,
    validationErrors: validationState === "invalid" ? (input.validation?.errors ?? []) : [],
    coordinationState,
    progress,
    execution: executionControl.execution,
    commands: executionControl.commands,
    activeRunId,
    activeExecutionId,
    projectConflict,
    summary: input.validation?.summary ?? input.status?.summary ?? null,
    validation: input.validation,
    status: input.status,
    runs,
    executions: input.epicExecutions,
  };
}

function deriveIssueSummariesProgress(
  issues: ReadonlyArray<BeadsIssueSummary>,
): BeadsCoordinatorProgress {
  const totalIssueCount = issues.length;
  const completedIssueCount = issues.filter((issue) => issue.status === "closed").length;
  const blockedIssueCount = issues.filter((issue) => issue.status === "blocked").length;
  const activeIssueCount = issues.filter(
    (issue) => issue.status === "in_progress" || issue.status === "hooked",
  ).length;
  const readyIssueCount = Math.max(
    0,
    totalIssueCount - completedIssueCount - blockedIssueCount - activeIssueCount,
  );

  return {
    totalIssueCount,
    completedIssueCount,
    readyIssueCount,
    activeIssueCount,
    blockedIssueCount,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: blockedIssueCount,
    activeWorkerCount: 0,
    isComplete: totalIssueCount > 0 && completedIssueCount >= totalIssueCount,
  };
}

export function buildProjectRunSummary(input: {
  readonly projectId: ProjectId;
  readonly epicIssues: ReadonlyArray<BeadsIssueSummary>;
  readonly readModel: OrchestrationReadModel;
}): BeadsProjectRunSummary {
  const projectEpicRuns = input.readModel.epicRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const projectRunIds = new Set(projectEpicRuns.map((run) => run.runId));
  const executionsByRunId = new Map<
    OrchestrationEpicRun["runId"],
    OrchestrationEpicIssueExecution[]
  >();
  const epicTitleById = new Map(input.epicIssues.map((issue) => [issue.id, issue.title] as const));

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

  const epicIds = new Set(projectEpicRuns.map((run) => run.epicIssueId));
  const epics = [...epicIds]
    .map((epicIssueId) => {
      const runs = projectEpicRuns
        .filter((run) => run.epicIssueId === epicIssueId)
        .toSorted(compareEpicRunsByRequestedAtDesc);
      const executions = runs.flatMap((run) => executionsByRunId.get(run.runId) ?? []);

      return {
        epicIssueId,
        epicTitle: epicTitleById.get(epicIssueId) ?? epicIssueId,
        runs,
        executions,
      };
    })
    .toSorted(
      (left, right) =>
        (right.runs[0]?.updatedAt ?? "").localeCompare(left.runs[0]?.updatedAt ?? "") ||
        left.epicIssueId.localeCompare(right.epicIssueId),
    );

  return {
    projectId: input.projectId,
    epics,
  };
}

export function buildEpicIssueSummaries(input: {
  readonly epic: BeadsIssueDetail | BeadsIssueSummary;
  readonly issues: ReadonlyArray<BeadsIssueSummary>;
}): BeadsEpicIssueSummaries {
  return {
    epicId: input.epic.id,
    epicTitle: input.epic.title,
    progress: deriveIssueSummariesProgress(input.issues),
    issues: [...input.issues],
  };
}

export function buildEpicCoordinationDetail(input: {
  readonly projectId: ProjectId;
  readonly issue: BeadsIssueDetail | BeadsIssueSummary;
  readonly validation: BeadsEpicCoordinationValidation | null;
  readonly status: BeadsEpicCoordinationStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
  readonly readModel: OrchestrationReadModel;
}): BeadsEpicCoordinationDetail {
  const epic = buildSingleEpicCoordinatorSnapshot(input);

  return {
    epicId: epic.epicId,
    coordinationLoadState: epic.coordinationLoadState,
    coordinationLoadDetail: epic.coordinationLoadDetail,
    validationState: epic.validationState,
    validationErrors: epic.validationErrors,
    coordinationState: epic.coordinationState,
    summary: epic.summary,
    validation: epic.validation,
    status: epic.status,
    execution: epic.execution,
    commands: epic.commands,
  };
}

export function buildSingleEpicCoordinatorSnapshot(input: {
  readonly projectId: ProjectId;
  readonly issue: BeadsIssueDetail | BeadsIssueSummary;
  readonly validation: BeadsEpicCoordinationValidation | null;
  readonly status: BeadsEpicCoordinationStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
  readonly readModel: OrchestrationReadModel;
}): BeadsCoordinatorEpicSnapshot {
  const issueSummary = toIssueSummary(input.issue);
  const projectEpicRuns = input.readModel.epicRuns.filter(
    (run) => run.projectId === input.projectId,
  );
  const epicRuns = projectEpicRuns.filter((run) => run.epicIssueId === issueSummary.id);
  const epicRunIds = new Set(epicRuns.map((run) => run.runId));
  const epicExecutions = input.readModel.epicIssueExecutions.filter((execution) =>
    epicRunIds.has(execution.runId),
  );

  return buildCoordinatorEpicSnapshot({
    issue: issueSummary,
    validation: input.validation,
    status: input.status,
    validationError: input.validationError,
    statusError: input.statusError,
    projectEpicRuns,
    epicRuns,
    epicExecutions,
    fallbackEpicId: issueSummary.id,
    fallbackEpicTitle: issueSummary.title,
  });
}
