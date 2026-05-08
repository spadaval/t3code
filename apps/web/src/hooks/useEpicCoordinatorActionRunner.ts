import type {
  BeadsEpicCommand,
  BeadsEpicWorkflowSnapshot,
  EnvironmentId,
  ModelSelection,
  OrchestrationEpicRun,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { invalidateBeadsEpicQueries } from "~/lib/beadsReactQuery";
import { ensureEnvironmentApi } from "~/environmentApi";
import { toastManager } from "~/components/ui/toast";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";

export type EpicWorkflowActionInput =
  | { kind: "open_coordination_prep_thread"; epicIssueId: string }
  | { kind: "start_epic_run"; epicIssueId: string }
  | { kind: "stop_epic_run"; runId: OrchestrationEpicRun["runId"] }
  | { kind: "refresh_epic_status"; epicIssueId: string };

export type CoordinatorActionInput = EpicWorkflowActionInput;

export function getEpicWorkflowActionBusyKey(action: EpicWorkflowActionInput): string {
  switch (action.kind) {
    case "open_coordination_prep_thread":
      return `prep:${action.epicIssueId}`;
    case "start_epic_run":
      return `start:${action.epicIssueId}`;
    case "stop_epic_run":
      return `stop:${action.runId}`;
    case "refresh_epic_status":
      return `refresh:${action.epicIssueId}`;
  }
}

export function getEpicCommandInput(
  epic: Pick<BeadsEpicWorkflowSnapshot, "epicId" | "activeRunId" | "runs">,
  command: BeadsEpicCommand,
): EpicWorkflowActionInput | null {
  const activeRun = epic.activeRunId
    ? (epic.runs.find((run) => run.runId === epic.activeRunId) ?? null)
    : null;

  switch (command.kind) {
    case "open_coordination_prep_thread":
      return {
        kind: "open_coordination_prep_thread",
        epicIssueId: epic.epicId,
      };
    case "start_epic_run":
      return {
        kind: "start_epic_run",
        epicIssueId: epic.epicId,
      };
    case "stop_epic_run":
      return activeRun
        ? {
            kind: "stop_epic_run",
            runId: activeRun.runId,
          }
        : null;
    case "refresh_epic_status":
      return {
        kind: "refresh_epic_status",
        epicIssueId: epic.epicId,
      };
  }
}

export function describeEpicWorkflowActionError(
  actionKind: EpicWorkflowActionInput["kind"],
): string {
  switch (actionKind) {
    case "open_coordination_prep_thread":
      return "Unable to open prep thread";
    case "start_epic_run":
      return "Unable to start run";
    case "stop_epic_run":
      return "Unable to stop run";
    case "refresh_epic_status":
      return "Unable to refresh epic workflow status";
  }
}

export function invalidateBeadsEpicWorkflowQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === "beads" &&
        (key[1] === "epic-issue-summaries" ||
          key[1] === "epic-coordination-validation" ||
          key[1] === "epic-coordination-status" ||
          key[1] === "issue-graph")
      );
    },
  });
}

export function useEpicWorkflowActionRunner(input: {
  readonly cwd: string;
  readonly projectId: ProjectId | null;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const queryClient = useQueryClient();
  const resolveEnvironmentId = useCallback((): EnvironmentId => {
    const project = selectProjectsAcrossEnvironments(useStore.getState()).find(
      (candidate) => candidate.cwd === input.cwd,
    );
    if (!project) {
      throw new Error(`No environment found for beads cwd: ${input.cwd}`);
    }
    return project.environmentId;
  }, [input.cwd]);

  const mutation = useMutation({
    mutationFn: async (
      action: EpicWorkflowActionInput,
    ): Promise<{ threadId: ThreadId; created: boolean } | null> => {
      const api = ensureEnvironmentApi(resolveEnvironmentId());

      switch (action.kind) {
        case "open_coordination_prep_thread":
          if (!input.projectId || !input.modelSelection) {
            throw new Error("Project context is unavailable.");
          }

          return api.beads.startEpicCoordinationPrep({
            cwd: input.cwd,
            projectId: input.projectId,
            epicIssueId: action.epicIssueId,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
          });
        case "start_epic_run":
          if (!input.projectId) {
            throw new Error("Project context is unavailable.");
          }

          await api.orchestration.startEpicRun({
            projectId: input.projectId,
            epicIssueId: action.epicIssueId,
            runtimeMode: input.runtimeMode,
          });
          return null;
        case "stop_epic_run":
          await api.orchestration.stopEpicRun({ runId: action.runId });
          return null;
        case "refresh_epic_status":
          return null;
      }
    },
    onSuccess: async (result, action) => {
      await invalidateBeadsEpicQueries(queryClient, {
        cwd: input.cwd,
        epicIssueId:
          action.kind === "open_coordination_prep_thread" ||
          action.kind === "start_epic_run" ||
          action.kind === "refresh_epic_status"
            ? action.epicIssueId
            : undefined,
      });

      if (result) {
        if (!result.created) {
          toastManager.add({
            type: "info",
            title: "Reused linked thread",
            description: "An existing epic workflow prep thread was reused for this epic.",
          });
        }

        input.onOpenThread(result.threadId);
      }
    },
  });

  const busyActionKey = useMemo(() => {
    if (!mutation.isPending || !mutation.variables) {
      return null;
    }

    return getEpicWorkflowActionBusyKey(mutation.variables);
  }, [mutation.isPending, mutation.variables]);

  const runAction = useCallback(
    async (action: EpicWorkflowActionInput) => {
      try {
        await mutation.mutateAsync(action);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: describeEpicWorkflowActionError(action.kind),
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [mutation],
  );

  return {
    runAction,
    busyActionKey,
    isPending: mutation.isPending,
  };
}

export const getCoordinatorActionBusyKey = getEpicWorkflowActionBusyKey;
export const describeCoordinatorActionError = describeEpicWorkflowActionError;
export const useEpicCoordinatorActionRunner = useEpicWorkflowActionRunner;
