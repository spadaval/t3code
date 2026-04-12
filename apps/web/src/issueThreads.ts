import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

export interface IssueThreadCandidate {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt?: string | undefined;
  readonly archivedAt: string | null;
  readonly issueLink: {
    readonly issueId: string;
  } | null;
}

export function listIssueLinkedThreads(input: {
  readonly threads: ReadonlyArray<IssueThreadCandidate>;
  readonly projectId: ProjectId | null;
  readonly issueId: string | null;
}): IssueThreadCandidate[] {
  if (input.projectId === null || input.issueId === null) {
    return [];
  }

  return input.threads
    .filter(
      (thread) =>
        thread.projectId === input.projectId && thread.issueLink?.issueId === input.issueId,
    )
    .toSorted((left, right) => {
      const archivedDelta = Number(left.archivedAt !== null) - Number(right.archivedAt !== null);
      if (archivedDelta !== 0) {
        return archivedDelta;
      }

      const leftUpdatedAt = left.updatedAt ?? left.createdAt;
      const rightUpdatedAt = right.updatedAt ?? right.createdAt;
      const updatedAtDelta = rightUpdatedAt.localeCompare(leftUpdatedAt);
      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return left.id.localeCompare(right.id);
    });
}
