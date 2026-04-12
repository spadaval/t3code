import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueRelationSummary,
  OrchestrationEpicIssueExecution,
} from "@t3tools/contracts";
import { compareEpicReadyIssues } from "@t3tools/shared/epicRun";

export interface EpicExecutionPrediction {
  readonly issueId: string;
  readonly title: string;
  readonly waveIndex: number | null;
}

export interface EpicExecutionAttempt {
  readonly executionId: OrchestrationEpicIssueExecution["executionId"];
  readonly issueId: string;
  readonly title: string;
  readonly sequenceNumber: number;
  readonly status: OrchestrationEpicIssueExecution["status"];
  readonly failureMessage: string | null;
  readonly workerThreadId: OrchestrationEpicIssueExecution["workerThreadId"];
}

export interface EpicExecutionViewData {
  readonly activeExecution: EpicExecutionAttempt | null;
  readonly predicted: readonly EpicExecutionPrediction[];
  readonly history: readonly EpicExecutionAttempt[];
}

function sortReadyFront(front: readonly BeadsIssueRelationSummary[]): BeadsIssueRelationSummary[] {
  return [...front].toSorted(compareEpicReadyIssues);
}

function collectIssueTitles(epic: BeadsCoordinatorEpicSnapshot): Map<string, string> {
  const titles = new Map<string, string>();

  const recordIssue = (issue: Pick<BeadsIssueRelationSummary, "id" | "title">) => {
    if (!titles.has(issue.id)) {
      titles.set(issue.id, issue.title);
    }
  };

  for (const issue of epic.status?.completed ?? []) {
    recordIssue(issue);
  }
  for (const issue of epic.status?.active ?? []) {
    recordIssue(issue);
  }
  for (const issue of epic.status?.ready ?? []) {
    recordIssue(issue);
  }
  for (const issue of epic.status?.blocked ?? []) {
    recordIssue(issue);
  }
  for (const front of epic.validation?.readyFronts ?? []) {
    for (const issue of front) {
      recordIssue(issue);
    }
  }

  return titles;
}

function buildPredictedIssues(
  epic: BeadsCoordinatorEpicSnapshot,
  activeIssueId: string | null,
  issueTitles: ReadonlyMap<string, string>,
): EpicExecutionPrediction[] {
  const predictions: EpicExecutionPrediction[] = [];
  const seenIssueIds = new Set<string>();

  const pushIssue = (issue: BeadsIssueRelationSummary, waveIndex: number | null) => {
    if (issue.id === activeIssueId || seenIssueIds.has(issue.id)) {
      return;
    }

    seenIssueIds.add(issue.id);
    predictions.push({
      issueId: issue.id,
      title: issueTitles.get(issue.id) ?? issue.title,
      waveIndex,
    });
  };

  if (epic.validation?.readyFronts.length) {
    epic.validation.readyFronts.forEach((front, waveIndex) => {
      for (const issue of sortReadyFront(front)) {
        pushIssue(issue, waveIndex);
      }
    });
    return predictions;
  }

  for (const issue of sortReadyFront(epic.status?.ready ?? [])) {
    pushIssue(issue, null);
  }

  return predictions;
}

function toExecutionAttempt(
  execution: OrchestrationEpicIssueExecution,
  issueTitles: ReadonlyMap<string, string>,
): EpicExecutionAttempt {
  return {
    executionId: execution.executionId,
    issueId: execution.issueId,
    title: issueTitles.get(execution.issueId) ?? execution.issueId,
    sequenceNumber: execution.sequenceNumber,
    status: execution.status,
    failureMessage: execution.failureContext?.message ?? null,
    workerThreadId: execution.workerThreadId,
  };
}

export function buildEpicExecutionViewData(
  epic: BeadsCoordinatorEpicSnapshot,
): EpicExecutionViewData {
  const issueTitles = collectIssueTitles(epic);
  const activeExecution =
    epic.activeExecutionId === null
      ? null
      : (epic.executions.find((execution) => execution.executionId === epic.activeExecutionId) ??
        null);
  const activeIssueId = activeExecution?.issueId ?? null;

  const predicted = buildPredictedIssues(epic, activeIssueId, issueTitles);
  const history = [...epic.executions]
    .filter((execution) => execution.executionId !== epic.activeExecutionId)
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.requestedAt.localeCompare(left.requestedAt) ||
        right.sequenceNumber - left.sequenceNumber ||
        right.executionId.localeCompare(left.executionId),
    )
    .map((execution) => toExecutionAttempt(execution, issueTitles));

  return {
    activeExecution:
      activeExecution === null ? null : toExecutionAttempt(activeExecution, issueTitles),
    predicted,
    history,
  };
}
