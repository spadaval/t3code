import type {
  BeadsEpicWorkflowProgress,
  BeadsEpicWorkflowProjectConflict,
  BeadsEpicWorkflowSnapshot,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsEpicIssueSummaries,
  BeadsIssueDetail,
  BeadsIssueSummary,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
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
): BeadsEpicWorkflowProjectConflict {
  return {
    run,
    message: describeSharedWorkspaceProjectConflictMessage(run),
  };
}

function findConflictingSharedWorkspaceRun(input: {
  readonly projectEpicRuns: ReadonlyArray<OrchestrationEpicRun>;
  readonly epicRuns: ReadonlyArray<OrchestrationEpicRun>;
}): BeadsEpicWorkflowProjectConflict | null {
  const run = findConflictingSharedWorkspaceRunCore(input);
  return run ? describeSharedWorkspaceProjectConflict(run) : null;
}

function deriveIntegrityError(input: {
  readonly epicId: string;
  readonly runs: ReadonlyArray<OrchestrationEpicRun>;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}): string | null {
  const activeRuns = findActiveEpicRuns(input.runs);
  if (activeRuns.length > 1) {
    return `Epic workflow integrity error for ${input.epicId}: multiple non-terminal runs exist for the same epic.`;
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
    return `Epic workflow integrity error for ${input.epicId}: run '${activeRun.runId}' has multiple non-terminal executions.`;
  }

  return null;
}

export function buildEpicWorkflowSnapshot(input: {
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
}): BeadsEpicWorkflowSnapshot {
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
): BeadsEpicWorkflowProgress {
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
