import type {
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmValidation,
} from "@t3tools/contracts";

export function compareSwarmReadyIssues(
  left: BeadsIssueRelationSummary,
  right: BeadsIssueRelationSummary,
): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.id.localeCompare(right.id);
}

export function selectDeterministicReadyIssueFromList(
  issues: ReadonlyArray<BeadsIssueRelationSummary>,
): BeadsIssueRelationSummary | null {
  return issues.toSorted(compareSwarmReadyIssues).at(0) ?? null;
}

export function selectDeterministicReadyIssue(input: {
  readonly validation: Pick<BeadsSwarmValidation, "readyFronts"> | null;
  readonly status: Pick<BeadsSwarmStatus, "ready"> | null;
}): BeadsIssueRelationSummary | null {
  for (const front of input.validation?.readyFronts ?? []) {
    const issue = selectDeterministicReadyIssueFromList(front);
    if (issue) {
      return issue;
    }
  }

  return selectDeterministicReadyIssueFromList(input.status?.ready ?? []);
}
