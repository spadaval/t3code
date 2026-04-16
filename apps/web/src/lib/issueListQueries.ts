import type { BeadsIssueSortBy } from "@t3tools/contracts";

export interface IssueListQueryInput {
  readonly cwd: string;
  readonly sortBy: BeadsIssueSortBy;
  readonly enabled: boolean;
  readonly refetchIntervalMs?: number | false;
  readonly refetchOnWindowFocus?: boolean | "always";
}

export function buildIssueListQueryInput(input: IssueListQueryInput) {
  // Fetch the full issue set and let the UI hide closed rows locally so epic progress
  // still counts completed descendants when "Show closed" is off.
  return {
    cwd: input.cwd,
    sortBy: input.sortBy,
    enabled: input.enabled,
    ...(input.refetchIntervalMs !== undefined
      ? { refetchIntervalMs: input.refetchIntervalMs }
      : {}),
    ...(input.refetchOnWindowFocus !== undefined
      ? { refetchOnWindowFocus: input.refetchOnWindowFocus }
      : {}),
  };
}
