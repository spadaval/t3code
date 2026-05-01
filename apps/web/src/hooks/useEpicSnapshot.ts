import type { BeadsCoordinatorEpicSnapshot, ProjectId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";

import {
  beadsEpicCoordinationDetailOptions,
  beadsEpicIssueSummariesOptions,
  beadsProjectRunSummaryOptions,
} from "~/lib/beadsReactQuery";
import { composeCoordinatorEpicSnapshot } from "~/lib/coordinatorSnapshots";

export function useEpicSnapshot(input: {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly issueId: string;
  readonly enabled?: boolean;
}): {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly epic: BeadsCoordinatorEpicSnapshot | null;
} {
  const enabled = input.enabled ?? true;
  const projectRunSummaryQuery = useQuery(
    enabled
      ? beadsProjectRunSummaryOptions({
          cwd: input.cwd,
          projectId: input.projectId,
        })
      : beadsProjectRunSummaryOptions(null),
  );
  const issueSummariesQuery = useQuery(
    enabled
      ? beadsEpicIssueSummariesOptions({
          cwd: input.cwd,
          epicIssueId: input.issueId,
        })
      : beadsEpicIssueSummariesOptions(null),
  );
  const coordinationDetailQuery = useQuery(
    enabled
      ? beadsEpicCoordinationDetailOptions({
          cwd: input.cwd,
          projectId: input.projectId,
          epicIssueId: input.issueId,
        })
      : beadsEpicCoordinationDetailOptions(null),
  );

  if (!enabled) {
    return {
      isPending: false,
      error: null,
      epic: null,
    };
  }

  const epic =
    coordinationDetailQuery.data && issueSummariesQuery.data
      ? composeCoordinatorEpicSnapshot({
          epicIssueId: input.issueId,
          projectRunSummary: projectRunSummaryQuery.data ?? null,
          epicIssueSummaries: issueSummariesQuery.data,
          epicCoordinationDetail: coordinationDetailQuery.data,
        })
      : null;

  return {
    isPending:
      coordinationDetailQuery.isPending ||
      issueSummariesQuery.isPending ||
      projectRunSummaryQuery.isPending,
    error:
      coordinationDetailQuery.error ?? issueSummariesQuery.error ?? projectRunSummaryQuery.error,
    epic,
  };
}
