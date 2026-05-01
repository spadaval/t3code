import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueRelationSummary,
  EpicIssueExecutionId,
  OrchestrationEpicIssueExecution,
  ThreadId,
} from "@t3tools/contracts";
import {
  compareEpicReadyIssues,
  isNonTerminalEpicIssueExecutionStatus,
} from "@t3tools/shared/epicRun";

import { isIssueDoneStatus } from "./issueConstants";

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

export type EpicChildExecutionKind =
  | "next"
  | "active"
  | "ready"
  | "blocked"
  | "completed"
  | "failed"
  | "stopped"
  | "waiting"
  | "unknown";

export interface EpicChildExecutionState {
  readonly issueId: string;
  readonly kind: EpicChildExecutionKind;
  readonly label: string;
  readonly sequenceLabel: string | null;
  readonly waveIndex: number | null;
  readonly executionId: EpicIssueExecutionId | null;
  readonly workerThreadId: ThreadId | null;
  readonly failureMessage: string | null;
  readonly isNext: boolean;
}

export interface EpicChildExecutionRow {
  readonly child: BeadsIssueRelationSummary;
  readonly execution: EpicChildExecutionState;
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

function compareExecutionsByLatest(
  left: OrchestrationEpicIssueExecution,
  right: OrchestrationEpicIssueExecution,
): number {
  return (
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.sequenceNumber - right.sequenceNumber ||
    left.executionId.localeCompare(right.executionId)
  );
}

function getLatestExecutionByIssueId(
  executions: readonly OrchestrationEpicIssueExecution[],
): Map<string, OrchestrationEpicIssueExecution> {
  const latest = new Map<string, OrchestrationEpicIssueExecution>();

  for (const execution of executions) {
    const existing = latest.get(execution.issueId);
    if (!existing || compareExecutionsByLatest(existing, execution) < 0) {
      latest.set(execution.issueId, execution);
    }
  }

  return latest;
}

function formatExecutionLabel(status: OrchestrationEpicIssueExecution["status"]): string {
  switch (status) {
    case "launching":
      return "Launching";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

function pushChildIds(
  target: string[],
  seen: Set<string>,
  childById: ReadonlyMap<string, BeadsIssueRelationSummary>,
  issues: readonly BeadsIssueRelationSummary[],
) {
  for (const issue of issues) {
    if (!childById.has(issue.id) || seen.has(issue.id)) {
      continue;
    }
    seen.add(issue.id);
    target.push(issue.id);
  }
}

function collectPredictedChildren(input: {
  readonly epic: BeadsCoordinatorEpicSnapshot;
  readonly childById: ReadonlyMap<string, BeadsIssueRelationSummary>;
}): Map<string, number | null> {
  const predicted = new Map<string, number | null>();
  const canRun = (issue: BeadsIssueRelationSummary) => {
    const child = input.childById.get(issue.id) ?? issue;
    return !isIssueDoneStatus(child.status);
  };

  if (input.epic.validation?.readyFronts.length) {
    input.epic.validation.readyFronts.forEach((front, waveIndex) => {
      for (const issue of sortReadyFront(front)) {
        if (canRun(issue) && !predicted.has(issue.id)) {
          predicted.set(issue.id, waveIndex);
        }
      }
    });
    return predicted;
  }

  for (const issue of sortReadyFront(input.epic.status?.ready ?? [])) {
    if (canRun(issue)) {
      predicted.set(issue.id, null);
    }
  }

  return predicted;
}

function buildSequenceLabel(input: {
  readonly execution: OrchestrationEpicIssueExecution | null;
  readonly waveIndex: number | null;
}): string | null {
  if (input.execution) {
    return `#${input.execution.sequenceNumber.toString()}`;
  }
  if (input.waveIndex === null) {
    return null;
  }
  return `Wave ${(input.waveIndex + 1).toString()}`;
}

function buildChildExecutionState(input: {
  readonly child: BeadsIssueRelationSummary;
  readonly latestExecution: OrchestrationEpicIssueExecution | null;
  readonly activeExecution: OrchestrationEpicIssueExecution | null;
  readonly isNext: boolean;
  readonly waveIndex: number | null;
  readonly statusBucket: EpicChildExecutionKind | null;
}): EpicChildExecutionState {
  const { activeExecution, child, isNext, latestExecution, statusBucket, waveIndex } = input;
  const relevantExecution = activeExecution ?? latestExecution;

  if (activeExecution) {
    return {
      issueId: child.id,
      kind: "active",
      label: formatExecutionLabel(activeExecution.status),
      sequenceLabel: buildSequenceLabel({ execution: activeExecution, waveIndex }),
      waveIndex,
      executionId: activeExecution.executionId,
      workerThreadId: activeExecution.workerThreadId,
      failureMessage: activeExecution.failureContext?.message ?? null,
      isNext: false,
    };
  }

  if (latestExecution && !isNonTerminalEpicIssueExecutionStatus(latestExecution.status)) {
    return {
      issueId: child.id,
      kind: latestExecution.status,
      label: formatExecutionLabel(latestExecution.status),
      sequenceLabel: buildSequenceLabel({ execution: latestExecution, waveIndex }),
      waveIndex,
      executionId: latestExecution.executionId,
      workerThreadId: latestExecution.workerThreadId,
      failureMessage: latestExecution.failureContext?.message ?? null,
      isNext,
    };
  }

  if (isNext) {
    return {
      issueId: child.id,
      kind: "next",
      label: "Next",
      sequenceLabel: buildSequenceLabel({ execution: relevantExecution, waveIndex }),
      waveIndex,
      executionId: relevantExecution?.executionId ?? null,
      workerThreadId: relevantExecution?.workerThreadId ?? null,
      failureMessage: relevantExecution?.failureContext?.message ?? null,
      isNext: true,
    };
  }

  const bucket = statusBucket ?? "unknown";
  const label =
    bucket === "ready"
      ? "Ready"
      : bucket === "blocked"
        ? "Blocked"
        : bucket === "completed"
          ? "Completed"
          : bucket === "active"
            ? "Active"
            : "Not queued";

  return {
    issueId: child.id,
    kind: bucket,
    label,
    sequenceLabel: buildSequenceLabel({ execution: relevantExecution, waveIndex }),
    waveIndex,
    executionId: relevantExecution?.executionId ?? null,
    workerThreadId: relevantExecution?.workerThreadId ?? null,
    failureMessage: relevantExecution?.failureContext?.message ?? null,
    isNext: false,
  };
}

export function buildEpicChildExecutionRows(input: {
  readonly epic: BeadsCoordinatorEpicSnapshot;
  readonly children: readonly BeadsIssueRelationSummary[];
}): readonly EpicChildExecutionRow[] {
  const childById = new Map(input.children.map((child) => [child.id, child]));
  const latestExecutionByIssueId = getLatestExecutionByIssueId(input.epic.executions);
  const activeExecution =
    input.epic.activeExecutionId === null
      ? null
      : (input.epic.executions.find(
          (execution) => execution.executionId === input.epic.activeExecutionId,
        ) ?? null);
  const predictedByIssueId = collectPredictedChildren({ epic: input.epic, childById });
  const nextIssueId =
    [...predictedByIssueId.keys()].find((issueId) => childById.has(issueId)) ?? null;
  const statusBucketByIssueId = new Map<string, EpicChildExecutionKind>();
  const isDoneChild = (issue: BeadsIssueRelationSummary) => {
    const child = childById.get(issue.id) ?? issue;
    return isIssueDoneStatus(child.status);
  };

  for (const issue of input.epic.status?.completed ?? []) {
    statusBucketByIssueId.set(issue.id, "completed");
  }
  for (const issue of input.epic.status?.active ?? []) {
    if (!isDoneChild(issue)) {
      statusBucketByIssueId.set(issue.id, "active");
    }
  }
  for (const issue of input.epic.status?.ready ?? []) {
    if (!isDoneChild(issue)) {
      statusBucketByIssueId.set(issue.id, "ready");
    }
  }
  for (const issue of input.epic.status?.blocked ?? []) {
    if (!isDoneChild(issue)) {
      statusBucketByIssueId.set(issue.id, "blocked");
    }
  }

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  if (activeExecution && childById.has(activeExecution.issueId)) {
    seen.add(activeExecution.issueId);
    orderedIds.push(activeExecution.issueId);
  }

  pushChildIds(
    orderedIds,
    seen,
    childById,
    [...predictedByIssueId.keys()].flatMap((issueId) => {
      const child = childById.get(issueId);
      return child ? [child] : [];
    }),
  );

  pushChildIds(
    orderedIds,
    seen,
    childById,
    [...(input.epic.status?.completed ?? [])].toSorted((left, right) => {
      const leftExecution = latestExecutionByIssueId.get(left.id);
      const rightExecution = latestExecutionByIssueId.get(right.id);
      if (leftExecution && rightExecution) {
        return (
          leftExecution.sequenceNumber - rightExecution.sequenceNumber ||
          compareEpicReadyIssues(left, right)
        );
      }
      if (leftExecution) return -1;
      if (rightExecution) return 1;
      return compareEpicReadyIssues(left, right);
    }),
  );

  const blockedBreakdown = input.epic.status?.blockedBreakdown;
  pushChildIds(orderedIds, seen, childById, sortReadyFront(blockedBreakdown?.internal ?? []));
  pushChildIds(orderedIds, seen, childById, sortReadyFront(blockedBreakdown?.external ?? []));
  pushChildIds(orderedIds, seen, childById, sortReadyFront(blockedBreakdown?.unknown ?? []));
  pushChildIds(orderedIds, seen, childById, sortReadyFront(input.epic.status?.blocked ?? []));
  pushChildIds(orderedIds, seen, childById, sortReadyFront(input.children));

  return orderedIds.map((issueId) => {
    const child = childById.get(issueId)!;
    const activeChildExecution =
      activeExecution?.issueId === issueId &&
      isNonTerminalEpicIssueExecutionStatus(activeExecution.status)
        ? activeExecution
        : null;
    const latestExecution = latestExecutionByIssueId.get(issueId) ?? null;
    const isNext = issueId === nextIssueId && activeChildExecution === null;

    return {
      child,
      execution: buildChildExecutionState({
        child,
        latestExecution,
        activeExecution: activeChildExecution,
        isNext,
        waveIndex: predictedByIssueId.get(issueId) ?? null,
        statusBucket: statusBucketByIssueId.get(issueId) ?? null,
      }),
    };
  });
}
