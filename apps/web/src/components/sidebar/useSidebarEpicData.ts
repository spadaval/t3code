import type {
  BeadsIssueDetail,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { beadsIssuesBatchOptions } from "~/lib/beadsReactQuery";

export function useSidebarEpicData(input: {
  cwd: string;
  projectExpanded: boolean;
  projectEpicRuns: ReadonlyArray<Pick<OrchestrationEpicRun, "epicIssueId">>;
  projectEpicIssueExecutions: ReadonlyArray<Pick<OrchestrationEpicIssueExecution, "issueId">>;
}) {
  const epicIssueIds = useMemo(
    () => [...new Set(input.projectEpicRuns.map((run) => run.epicIssueId))],
    [input.projectEpicRuns],
  );

  const visibleIssueIds = useMemo(
    () => [
      ...new Set([
        ...epicIssueIds,
        ...input.projectEpicIssueExecutions.map((execution) => execution.issueId),
      ]),
    ],
    [epicIssueIds, input.projectEpicIssueExecutions],
  );

  const issueMetadataQuery = useQuery(
    beadsIssuesBatchOptions(
      input.projectExpanded && visibleIssueIds.length > 0
        ? { cwd: input.cwd, issueIds: visibleIssueIds }
        : null,
    ),
  );

  const issueById = useMemo(
    () =>
      new Map(
        (issueMetadataQuery.data?.issues ?? []).map((issue) => [issue.id, issue] as const),
      ) as ReadonlyMap<string, BeadsIssueDetail>,
    [issueMetadataQuery.data?.issues],
  );

  const issueTitleByIssueId = useMemo(
    () =>
      new Map([...issueById.entries()].map(([issueId, issue]) => [issueId, issue.title] as const)),
    [issueById],
  );

  const epicTitleByIssueId = useMemo(
    () =>
      new Map(
        epicIssueIds.map(
          (epicIssueId) => [epicIssueId, issueById.get(epicIssueId)?.title ?? epicIssueId] as const,
        ),
      ) as ReadonlyMap<string, string>,
    [epicIssueIds, issueById],
  );

  const epicIssueStatusById = useMemo(
    () =>
      new Map(
        epicIssueIds.flatMap((epicIssueId) => {
          const status = issueById.get(epicIssueId)?.status;
          return status ? ([[epicIssueId, status]] as const) : [];
        }),
      ) as ReadonlyMap<string, string>,
    [epicIssueIds, issueById],
  );

  return {
    epicIssueIds,
    issueMetadataQuery,
    issueTitleByIssueId,
    epicTitleByIssueId,
    epicIssueStatusById,
  };
}
