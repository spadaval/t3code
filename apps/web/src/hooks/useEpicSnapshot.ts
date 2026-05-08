import type { BeadsEpicWorkflowSnapshot, ProjectId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";

import { environmentApiForCwd } from "~/lib/environmentApiByCwd";

export function useEpicSnapshot(input: {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly issueId: string;
  readonly enabled?: boolean;
}): {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly epic: BeadsEpicWorkflowSnapshot | null;
} {
  const enabled = input.enabled ?? true;
  const workflowDetailQuery = useQuery({
    queryKey: ["epic-workflow", "detail", input.cwd, input.projectId, input.issueId],
    queryFn: async (): Promise<BeadsEpicWorkflowSnapshot> => {
      return environmentApiForCwd(input.cwd).orchestration.getEpicWorkflowDetail({
        cwd: input.cwd,
        projectId: input.projectId,
        epicIssueId: input.issueId,
      });
    },
    enabled,
    retry: false,
    staleTime: 10_000,
  });

  return {
    isPending: enabled ? workflowDetailQuery.isPending : false,
    error: workflowDetailQuery.error,
    epic: enabled ? (workflowDetailQuery.data ?? null) : null,
  };
}
