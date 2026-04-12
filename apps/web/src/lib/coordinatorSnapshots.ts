import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsEpicIssueSummaries,
  BeadsEpicTrackerDetail,
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
  readonly epicTrackerDetail: BeadsEpicTrackerDetail;
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
    trackerLoadState: input.epicTrackerDetail.trackerLoadState,
    trackerLoadDetail: input.epicTrackerDetail.trackerLoadDetail,
    coordinationSupported: input.epicTrackerDetail.support.supported,
    coordinationUnsupportedReason: input.epicTrackerDetail.support.reason,
    validationState: input.epicTrackerDetail.validationState,
    validationErrors: input.epicTrackerDetail.validationErrors,
    trackerState: input.epicTrackerDetail.trackerState,
    progress: input.epicIssueSummaries?.progress ?? emptyProgress(),
    primaryAction: input.epicTrackerDetail.primaryAction,
    activeRunId,
    activeExecutionId,
    projectConflict:
      conflictRun === null
        ? null
        : {
            run: conflictRun,
            message: describeSharedWorkspaceProjectConflict(conflictRun),
          },
    trackerSummary: input.epicTrackerDetail.trackerSummary,
    validation: input.epicTrackerDetail.validation,
    status: input.epicTrackerDetail.status,
    runs,
    executions,
  };
}
