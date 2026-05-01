import type {
  BeadsEpicCommand,
  EnvironmentId,
  BeadsCoordinatorEpicSnapshot,
  ModelSelection,
  OrchestrationEpicRun,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { ensureEnvironmentApi } from "~/environmentApi";
import { toastManager } from "~/components/ui/toast";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";

export type CoordinatorActionInput =
  | { kind: "open_coordination_prep_thread"; epicIssueId: string }
  | { kind: "start_epic_run"; epicIssueId: string }
  | { kind: "stop_epic_run"; runId: OrchestrationEpicRun["runId"] }
  | { kind: "refresh_epic_status"; epicIssueId: string };

export function getCoordinatorActionBusyKey(action: CoordinatorActionInput): string {
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
  epic: Pick<BeadsCoordinatorEpicSnapshot, "epicId" | "activeRunId" | "runs">,
  command: BeadsEpicCommand,
): CoordinatorActionInput | null {
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

export function describeCoordinatorActionError(actionKind: CoordinatorActionInput["kind"]): string {
  switch (actionKind) {
    case "open_coordination_prep_thread":
      return "Unable to open prep thread";
    case "start_epic_run":
      return "Unable to start run";
    case "stop_epic_run":
      return "Unable to stop run";
    case "refresh_epic_status":
      return "Unable to refresh coordination status";
  }
}

export function invalidateCoordinatorBeadsQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
) {
  void queryClient.invalidateQueries({ queryKey: beadsQueryKeys.all });
}

export function useEpicCoordinatorActionRunner(input: {
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
      action: CoordinatorActionInput,
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
    onSuccess: async (result) => {
      invalidateCoordinatorBeadsQueries(queryClient);

      if (result) {
        if (!result.created) {
          toastManager.add({
            type: "info",
            title: "Reused linked thread",
            description: "An existing coordination prep thread was reused for this epic.",
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

    return getCoordinatorActionBusyKey(mutation.variables);
  }, [mutation.isPending, mutation.variables]);

  const runAction = useCallback(
    async (action: CoordinatorActionInput) => {
      try {
        await mutation.mutateAsync(action);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: describeCoordinatorActionError(action.kind),
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
