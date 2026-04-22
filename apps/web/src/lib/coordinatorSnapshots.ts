import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsEpicCoordinationDetail,
  BeadsEpicIssueSummaries,
  BeadsProjectRunSummary,
} from "@t3tools/contracts";
import {
  deriveActiveExecutionId,
  deriveActiveRunId,
  describeSharedWorkspaceProjectConflict,
  findConflictingSharedWorkspaceRun,
} from "@t3tools/shared/epicRun";

function emptyProgress(): BeadsCoordinatorEpicSnapshot["progress"] {
  return {
    totalIssueCount: 0,
    completedIssueCount: 0,
    readyIssueCount: 0,
    activeIssueCount: 0,
    blockedIssueCount: 0,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: 0,
    activeWorkerCount: 0,
    isComplete: false,
  };
}

export function composeCoordinatorEpicSnapshot(input: {
  readonly epicIssueId: string;
  readonly projectRunSummary: BeadsProjectRunSummary | null;
  readonly epicIssueSummaries?: BeadsEpicIssueSummaries | null;
  readonly epicCoordinationDetail: BeadsEpicCoordinationDetail;
}): BeadsCoordinatorEpicSnapshot {
  const runSummary =
    input.projectRunSummary?.epics.find((epic) => epic.epicIssueId === input.epicIssueId) ?? null;
  const runs = runSummary?.runs ?? [];
  const executions = runSummary?.executions ?? [];
  const projectEpicRuns = input.projectRunSummary?.epics.flatMap((epic) => epic.runs) ?? [];
  const activeRunId = deriveActiveRunId(runs);
  const activeExecutionId = deriveActiveExecutionId({ activeRunId, executions });
  const conflictRun = findConflictingSharedWorkspaceRun({ projectEpicRuns, epicRuns: runs });

  return {
    epicId: input.epicIssueId,
    epicTitle: input.epicIssueSummaries?.epicTitle ?? runSummary?.epicTitle ?? input.epicIssueId,
    issue: null,
    coordinationLoadState: input.epicCoordinationDetail.coordinationLoadState,
    coordinationLoadDetail: input.epicCoordinationDetail.coordinationLoadDetail,
    validationState: input.epicCoordinationDetail.validationState,
    validationErrors: input.epicCoordinationDetail.validationErrors,
    coordinationState: input.epicCoordinationDetail.coordinationState,
    progress: input.epicIssueSummaries?.progress ?? emptyProgress(),
    primaryAction: input.epicCoordinationDetail.primaryAction,
    activeRunId,
    activeExecutionId,
    projectConflict:
      conflictRun === null
        ? null
        : {
            run: conflictRun,
            message: describeSharedWorkspaceProjectConflict(conflictRun),
          },
    summary: input.epicCoordinationDetail.summary,
    validation: input.epicCoordinationDetail.validation,
    status: input.epicCoordinationDetail.status,
    runs,
    executions,
  };
}
