import type {
  BeadsContext,
  BeadsCreateIssueInput,
  BeadsEpicCoordinatorSnapshot,
  BeadsEpicCoordinatorSnapshotInput,
  BeadsEpicIssueInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetContextInput,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsGetSessionActivityInput,
  BeadsProjectCoordinatorSnapshot,
  BeadsProjectCoordinatorSnapshotInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsUpdateIssueInput,
  BeadsCommentIssueInput,
  BeadsListEpicTrackerSummariesInput,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsEpicTrackerStatus,
  BeadsEpicTrackerSummary,
  BeadsEpicRunSupport,
  BeadsEpicRunValidation,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS = 15_000;

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
  epicRunSupport: (cwd: string | null) => ["beads", "epic-run-support", cwd] as const,
  epicTrackerSummary: (cwd: string | null, epicIssueId: string | null) =>
    ["beads", "epic-tracker-summary", cwd, epicIssueId] as const,
  epicRunValidation: (cwd: string | null, epicIssueId: string | null) =>
    ["beads", "epic-run-validation", cwd, epicIssueId] as const,
  epicTrackerStatus: (cwd: string | null, epicIssueId: string | null) =>
    ["beads", "epic-tracker-status", cwd, epicIssueId] as const,
  epicTrackerSummaries: (input: BeadsListEpicTrackerSummariesInput) =>
    ["beads", "epic-tracker-summaries", input.cwd] as const,
  projectCoordinatorSnapshot: (input: BeadsProjectCoordinatorSnapshotInput | null) =>
    [
      "beads",
      "project-coordinator-snapshot",
      input?.cwd ?? null,
      input?.projectId ?? null,
    ] as const,
  epicCoordinatorSnapshot: (input: BeadsEpicCoordinatorSnapshotInput | null) =>
    [
      "beads",
      "epic-coordinator-snapshot",
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
    queryFn: async () => ensureNativeApi().beads.queryIssues(queryInput),
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
      return ensureNativeApi().beads.getIssue(input);
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
      return ensureNativeApi().beads.getIssueGraph(queryInput);
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
      return ensureNativeApi().beads.getIssues(input);
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
      return ensureNativeApi().beads.getContext(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 10_000,
  });
}

export function beadsEpicRunSupportOptions(input: { cwd: string | null; enabled?: boolean }) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicRunSupport(input.cwd),
    queryFn: async (): Promise<BeadsEpicRunSupport> => {
      if (!input.cwd) {
        throw new Error("Epic-run support is unavailable.");
      }
      return ensureNativeApi().beads.getEpicRunSupport({ cwd: input.cwd });
    },
    enabled: Boolean(input.cwd) && (input.enabled ?? true),
    staleTime: 10_000,
  });
}

export function beadsEpicTrackerSummaryOptions(
  input: (BeadsEpicIssueInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicTrackerSummary(input?.cwd ?? null, input?.epicIssueId ?? null),
    queryFn: async (): Promise<BeadsEpicTrackerSummary | null> => {
      if (!input) {
        throw new Error("Epic tracker summary is unavailable.");
      }
      return ensureNativeApi().beads.getEpicTrackerSummary(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsEpicRunValidationOptions(
  input: (BeadsEpicIssueInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicRunValidation(input?.cwd ?? null, input?.epicIssueId ?? null),
    queryFn: async (): Promise<BeadsEpicRunValidation> => {
      if (!input) {
        throw new Error("Epic-run validation is unavailable.");
      }
      return ensureNativeApi().beads.validateEpicRun(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsEpicTrackerStatusOptions(
  input: (BeadsEpicIssueInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicTrackerStatus(input?.cwd ?? null, input?.epicIssueId ?? null),
    queryFn: async (): Promise<BeadsEpicTrackerStatus> => {
      if (!input) {
        throw new Error("Epic tracker status is unavailable.");
      }
      return ensureNativeApi().beads.getEpicTrackerStatus(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsListEpicTrackerSummariesOptions(
  input: BeadsListEpicTrackerSummariesInput & { enabled?: boolean },
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicTrackerSummaries(input),
    queryFn: async () => ensureNativeApi().beads.listEpicTrackerSummaries(input),
    enabled: (input.enabled ?? true) && input.cwd.length > 0,
    staleTime: 5_000,
  });
}

export function beadsProjectCoordinatorSnapshotOptions(
  input: (BeadsProjectCoordinatorSnapshotInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.projectCoordinatorSnapshot(input),
    queryFn: async (): Promise<BeadsProjectCoordinatorSnapshot> => {
      if (!input) {
        throw new Error("Project coordinator snapshot is unavailable.");
      }
      return ensureNativeApi().beads.getProjectCoordinatorSnapshot(input);
    },
    enabled: input !== null && (input.enabled ?? true),
    staleTime: 5_000,
  });
}

export function beadsEpicCoordinatorSnapshotOptions(
  input: (BeadsEpicCoordinatorSnapshotInput & { enabled?: boolean }) | null,
) {
  return queryOptions({
    queryKey: beadsQueryKeys.epicCoordinatorSnapshot(input),
    queryFn: async (): Promise<BeadsEpicCoordinatorSnapshot> => {
      if (!input) {
        throw new Error("Epic coordinator snapshot is unavailable.");
      }
      return ensureNativeApi().beads.getEpicCoordinatorSnapshot(input);
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
    queryFn: async () => ensureNativeApi().beads.getSessionActivity(input),
    enabled: input.enabled ?? true,
    staleTime: 2_000,
  });
}

export function beadsUpdateIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsUpdateIssueInput) =>
      ensureNativeApi().beads.updateIssue(payload),
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
      ensureNativeApi().beads.createIssue(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsCommentIssueMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsCommentIssueInput) =>
      ensureNativeApi().beads.commentIssue(payload),
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
      ensureNativeApi().beads.startWorkflow(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartBacklogGroomingMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartBacklogGroomingInput) =>
      ensureNativeApi().beads.startBacklogGrooming(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicQuickRefineMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicQuickRefineInput) =>
      ensureNativeApi().beads.startEpicQuickRefine(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicPlannedRefineMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicPlannedRefineInput) =>
      ensureNativeApi().beads.startEpicPlannedRefine(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}

export function beadsStartEpicCoordinationPrepMutationOptions(input: { queryClient: QueryClient }) {
  return mutationOptions({
    mutationFn: async (payload: BeadsStartEpicCoordinationPrepInput) =>
      ensureNativeApi().beads.startEpicCoordinationPrep(payload),
    onSuccess: async () => {
      await input.queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
    },
  });
}
