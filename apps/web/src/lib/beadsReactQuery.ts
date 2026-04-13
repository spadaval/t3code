import type {
  BeadsContext,
  BeadsCreateIssueInput,
  BeadsEpicCoordinationDetail,
  BeadsEpicCoordinationDetailInput,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueSummariesInput,
  BeadsEpicIssueInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetContextInput,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsGetSessionActivityInput,
  BeadsProjectRunSummary,
  BeadsProjectRunSummaryEpic,
  BeadsProjectRunSummaryInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsUpdateIssueInput,
  BeadsCommentIssueInput,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import type { EnvironmentId } from "@t3tools/contracts";
import { ensureEnvironmentApi } from "~/environmentApi";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";

export const ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS = 15_000;

function resolveEnvironmentIdForCwd(cwd: string): EnvironmentId {
  const project = selectProjectsAcrossEnvironments(useStore.getState()).find(
    (candidate) => candidate.cwd === cwd,
  );
  if (!project) {
    throw new Error(`No environment found for beads cwd: ${cwd}`);
  }
  return project.environmentId;
}

function beadsApiForCwd(cwd: string) {
  return ensureEnvironmentApi(resolveEnvironmentIdForCwd(cwd)).beads;
}

export const beadsQueryKeys = {
  all: ["beads"] as const,
  issues: (input: BeadsQueryIssuesInput) =>
    [
      "beads",
      "issues",
      input.cwd,
      input.search ?? "",
      input.sortBy,
      [...(input.statuses ?? [])].toSorted(),
      [...(input.issueTypes ?? [])].toSorted(),
      [...(input.priorities ?? [])].toSorted((left, right) => left - right),
    ] as const,
  issue: (cwd: string | null, issueId: string | null) => ["beads", "issue", cwd, issueId] as const,
  issuesBatch: (cwd: string | null, issueIds: readonly string[]) =>
    ["beads", "issues-batch", cwd, [...issueIds].toSorted()] as const,
  context: (input: BeadsGetContextInput) => ["beads", "context", input.cwd] as const,
  epicCoordinationValidation: (cwd: string | null, epicIssueId: string | null) =>
    ["beads", "epic-coordination-validation", cwd, epicIssueId] as const,
  epicCoordinationStatus: (cwd: string | null, epicIssueId: string | null) =>
    ["beads", "epic-coordination-status", cwd, epicIssueId] as const,
  projectRunSummary: (input: BeadsProjectRunSummaryInput | null) =>
    ["beads", "project-run-summary", input?.cwd ?? null, input?.projectId ?? null] as const,
  epicIssueSummaries: (input: BeadsEpicIssueSummariesInput | null) =>
    ["beads", "epic-issue-summaries", input?.cwd ?? null, input?.epicIssueId ?? null] as const,
  epicCoordinationDetail: (input: BeadsEpicCoordinationDetailInput | null) =>
    [
      "beads",
      "epic-coordination-detail",
      input?.cwd ?? null,
      input?.projectId ?? null,
      input?.epicIssueId ?? null,
    ] as const,
  sessionActivity: (input: BeadsGetSessionActivityInput) =>
    ["beads", "session-activity", input.cwd] as const,
  issueGraph: (cwd: string | null, issueId: string | null) =>
    ["beads", "issue-graph", cwd, issueId] as const,
};

export function beadsQueryIssuesOptions(
  input: BeadsQueryIssuesInput & {
    enabled?: boolean;
    refetchIntervalMs?: number | false;
    refetchOnWindowFocus?: boolean | "always";
  },
) {
  const { enabled, refetchIntervalMs, refetchOnWindowFocus, ...queryInput } = input;
  return queryOptions<BeadsQueryIssuesResult>({
    queryKey: beadsQueryKeys.issues(queryInput),
    queryFn: async () => beadsApiForCwd(queryInput.cwd).queryIssues(queryInput),
    enabled: (enabled ?? true) && input.cwd.length > 0,
    staleTime: 10_000,
    ...(refetchIntervalMs !== undefined ? { refetchInterval: refetchIntervalMs } : {}),
    ...(refetchOnWindowFocus !== undefined ? { refetchOnWindowFocus } : {}),
  });
}

export function getCachedBeadsIssueSummary(input: {
  queryClient: QueryClient;
  cwd: string;
  issueId: string;
}): BeadsIssueSummary | null {
  const cachedIssueLists = input.queryClient.getQueriesData<BeadsQueryIssuesResult>({
    queryKey: ["beads", "issues", input.cwd],
  });
  for (const [, data] of cachedIssueLists) {
    const matchedIssue = data?.issues.find((issue) => issue.id === input.issueId);
    if (matchedIssue) {
      return matchedIssue;
    }
  }
  return null;
}

export function beadsIssueDetailOptions(input: BeadsGetIssueInput | null) {
  return queryOptions({
    queryKey: beadsQueryKeys.issue(input?.cwd ?? null, input?.issueId ?? null),
    queryFn: async () => {
      if (!input) {
        throw new Error("Issue detail is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getIssue(input);
    },
    enabled: input !== null,
    staleTime: 5_000,
  });
}

export function beadsIssueGraphOptions(
  input:
    | (BeadsEpicIssueInput & {
        refetchIntervalMs?: number | false;
        refetchOnWindowFocus?: boolean | "always";
      })
    | null,
) {
  const queryInput = input ? { cwd: input.cwd, epicIssueId: input.epicIssueId } : null;
  return queryOptions<BeadsIssueGraph>({
    queryKey: beadsQueryKeys.issueGraph(queryInput?.cwd ?? null, queryInput?.epicIssueId ?? null),
    queryFn: async () => {
      if (!queryInput) {
        throw new Error("Issue graph is unavailable.");
      }
      return beadsApiForCwd(queryInput.cwd).getIssueGraph(queryInput);
    },
    enabled: input !== null,
    staleTime: 5_000,
    ...(input?.refetchIntervalMs !== undefined ? { refetchInterval: input.refetchIntervalMs } : {}),
    ...(input?.refetchOnWindowFocus !== undefined
      ? { refetchOnWindowFocus: input.refetchOnWindowFocus }
      : {}),
  });
}

export function beadsIssuesBatchOptions(input: BeadsGetIssuesInput | null) {
  return queryOptions({
    queryKey: beadsQueryKeys.issuesBatch(input?.cwd ?? null, input?.issueIds ?? []),
    queryFn: async () => {
      if (!input) {
        throw new Error("Issues batch is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getIssues(input);
    },
    enabled: input !== null && input.issueIds.length > 0,
    staleTime: 10_000,
  });
}

export function beadsContextOptions(input: (BeadsGetContextInput & { enabled?: boolean }) | null) {
  return queryOptions({
    queryKey: input ? beadsQueryKeys.context(input) : ["beads", "context", null],
    queryFn: async (): Promise<BeadsContext> => {
      if (!input) {
        throw new Error("Beads context is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getContext(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 10_000,
  });
}

export function beadsEpicCoordinationValidationOptions(
  input: (BeadsEpicIssueInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicCoordinationValidation(
      input?.cwd ?? null,
      input?.epicIssueId ?? null,
    ),
    queryFn: async (): Promise<BeadsEpicCoordinationValidation> => {
      if (!input) {
        throw new Error("Epic coordination validation is unavailable.");
      }
      return beadsApiForCwd(input.cwd).validateEpicCoordination(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsEpicCoordinationStatusOptions(
  input: (BeadsEpicIssueInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicCoordinationStatus(input?.cwd ?? null, input?.epicIssueId ?? null),
    queryFn: async (): Promise<BeadsEpicCoordinationStatus> => {
      if (!input) {
        throw new Error("Epic coordination status is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getEpicCoordinationStatus(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsProjectRunSummaryOptions(
  input: (BeadsProjectRunSummaryInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.projectRunSummary(input),
    queryFn: async (): Promise<BeadsProjectRunSummary> => {
      if (!input) {
        throw new Error("Project run summary is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getProjectRunSummary(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function selectProjectRunSummaryEpic(
  summary: BeadsProjectRunSummary | null | undefined,
  epicIssueId: string | null | undefined,
): BeadsProjectRunSummaryEpic | null {
  if (!summary || !epicIssueId) {
    return null;
  }

  return summary.epics.find((epic) => epic.epicIssueId === epicIssueId) ?? null;
}

export function getProjectRunSummaryEpicTitle(
  summary: BeadsProjectRunSummary | null | undefined,
  epicIssueId: string | null | undefined,
): string | null {
  return selectProjectRunSummaryEpic(summary, epicIssueId)?.epicTitle ?? null;
}

export function beadsEpicIssueSummariesOptions(
  input: (BeadsEpicIssueSummariesInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicIssueSummaries(input),
    queryFn: async (): Promise<BeadsEpicIssueSummaries> => {
      if (!input) {
        throw new Error("Epic issue summaries are unavailable.");
      }
      return beadsApiForCwd(input.cwd).getEpicIssueSummaries(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsEpicCoordinationDetailOptions(
  input: (BeadsEpicCoordinationDetailInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicCoordinationDetail(input),
    queryFn: async (): Promise<BeadsEpicCoordinationDetail> => {
      if (!input) {
        throw new Error("Epic coordination detail is unavailable.");
      }
      return beadsApiForCwd(input.cwd).getEpicCoordinationDetail(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsSessionActivityOptions(
  input: BeadsGetSessionActivityInput & { enabled?: boolean },
) {
  return queryOptions({
    queryKey: beadsQueryKeys.sessionActivity(input),
    queryFn: async () => beadsApiForCwd(input.cwd).getSessionActivity(input),
    enabled: input.enabled ?? true,
    staleTime: 2_000,
  });
}

export function beadsUpdateIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsUpdateIssueInput) =>
      beadsApiForCwd(payload.cwd).updateIssue(payload),
    onSuccess: async (issue, variables) => {
      await Promise.all([
        input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all }),
        input.queryClient.setQueryData(
          beadsQueryKeys.issue(variables.cwd, variables.issueId),
          (previous: any) =>
            previous
              ? {
                  ...previous,
                  ...issue,
                }
              : previous,
        ),
      ]);
    },
  });
}

export function beadsCreateIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsCreateIssueInput) =>
      beadsApiForCwd(payload.cwd).createIssue(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsCommentIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsCommentIssueInput) =>
      beadsApiForCwd(payload.cwd).commentIssue(payload),
    onSuccess: async (issue, variables) => {
      await Promise.all([
        input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all }),
        input.queryClient.setQueryData(
          beadsQueryKeys.issue(variables.cwd, variables.issueId),
          issue,
        ),
      ]);
    },
  });
}

export function beadsStartWorkflowMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartWorkflowInput) =>
      beadsApiForCwd(payload.cwd).startWorkflow(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartBacklogGroomingMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartBacklogGroomingInput) =>
      beadsApiForCwd(payload.cwd).startBacklogGrooming(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicQuickRefineMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicQuickRefineInput) =>
      beadsApiForCwd(payload.cwd).startEpicQuickRefine(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicPlannedRefineMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicPlannedRefineInput) =>
      beadsApiForCwd(payload.cwd).startEpicPlannedRefine(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicCoordinationPrepMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicCoordinationPrepInput) =>
      beadsApiForCwd(payload.cwd).startEpicCoordinationPrep(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}
