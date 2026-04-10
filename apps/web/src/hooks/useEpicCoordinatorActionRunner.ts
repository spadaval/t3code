import type {
  BeadsCoordinatorEpicSnapshot,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { OrchestrationSwarmRun, OrchestrationSwarmTaskExecution } from "@t3tools/contracts";
import {
  DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
  DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
} from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { beadsQueryKeys } from "~/lib/beadsReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { toastManager } from "~/components/ui/toast";

export type CoordinatorActionInput =
  | { kind: "open_coordination_prep_thread"; epicIssueId: string }
  | { kind: "start_swarm"; epicIssueId: string }
  | { kind: "run_next_swarm_task"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "resume_paused_swarm_run"; runId: OrchestrationSwarmRun["runId"] }
  | {
      kind: "retry_swarm_task_execution";
      runId: OrchestrationSwarmRun["runId"];
      executionId: OrchestrationSwarmTaskExecution["executionId"];
    }
  | { kind: "pause_swarm"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "cancel_swarm"; runId: OrchestrationSwarmRun["runId"] }
  | { kind: "refresh_swarm_state"; epicIssueId: string }
  | { kind: "open_coordinator"; epicIssueId: string };

export function getCoordinatorActionBusyKey(action: CoordinatorActionInput): string {
  switch (action.kind) {
    case "open_coordination_prep_thread":
      return `prep:${action.epicIssueId}`;
    case "start_swarm":
      return `start:${action.epicIssueId}`;
    case "run_next_swarm_task":
      return `run-next:${action.runId}`;
    case "resume_paused_swarm_run":
      return `resume:${action.runId}`;
    case "retry_swarm_task_execution":
      return `retry:${action.executionId}`;
    case "pause_swarm":
      return `pause:${action.runId}`;
    case "cancel_swarm":
      return `cancel:${action.runId}`;
    case "refresh_swarm_state":
      return `refresh:${action.epicIssueId}`;
    case "open_coordinator":
      return `open:${action.epicIssueId}`;
  }
}

export function getCoordinatorPrimaryActionInput(
  epic: BeadsCoordinatorEpicSnapshot,
): CoordinatorActionInput | null {
  const activeRun = epic.activeRunId
    ? (epic.runs.find((run) => run.runId === epic.activeRunId) ?? null)
    : null;
  const latestRun = epic.runs[0] ?? null;
  const actionableRun = activeRun ?? latestRun;

  switch (epic.primaryAction.kind) {
    case "open_coordination_prep_thread":
      return {
        kind: "open_coordination_prep_thread",
        epicIssueId: epic.epicId,
      };
    case "start_swarm":
      return {
        kind: "start_swarm",
        epicIssueId: epic.epicId,
      };
    case "run_next_swarm_task":
      return actionableRun
        ? {
            kind: "run_next_swarm_task",
            runId: actionableRun.runId,
          }
        : null;
    case "resume_paused_swarm_run":
      return actionableRun
        ? {
            kind: "resume_paused_swarm_run",
            runId: actionableRun.runId,
          }
        : null;
    case "refresh_swarm_state":
      return {
        kind: "refresh_swarm_state",
        epicIssueId: epic.epicId,
      };
    case "open_coordinator":
      return {
        kind: "open_coordinator",
        epicIssueId: epic.projectConflict?.run.epicIssueId ?? epic.epicId,
      };
    case "unsupported":
      return null;
  }
}

export function describeCoordinatorActionError(actionKind: CoordinatorActionInput["kind"]): string {
  switch (actionKind) {
    case "open_coordination_prep_thread":
      return "Unable to open prep thread";
    case "start_swarm":
      return "Unable to start run";
    case "run_next_swarm_task":
      return "Unable to run the next task";
    case "resume_paused_swarm_run":
      return "Unable to resume the paused run";
    case "retry_swarm_task_execution":
      return "Unable to retry the task";
    case "pause_swarm":
      return "Unable to pause run";
    case "cancel_swarm":
      return "Unable to cancel run";
    case "refresh_swarm_state":
      return "Unable to refresh tracker status";
    case "open_coordinator":
      return "Unable to open coordinator";
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
  readonly onOpenCoordinator: (epicId: string) => void;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (
      action: CoordinatorActionInput,
    ): Promise<{ threadId: ThreadId; created: boolean } | null> => {
      const api = ensureNativeApi();

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
        case "start_swarm":
          if (!input.projectId) {
            throw new Error("Project context is unavailable.");
          }

          await api.orchestration.startSwarmRun({
            projectId: input.projectId,
            epicIssueId: action.epicIssueId,
            schedulerMode: DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
            workspaceMode: DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
            runtimeMode: input.runtimeMode,
          });
          return null;
        case "run_next_swarm_task":
          await api.orchestration.runNextSwarmTask({ runId: action.runId });
          return null;
        case "resume_paused_swarm_run":
          await api.orchestration.resumePausedSwarmRun({ runId: action.runId });
          return null;
        case "retry_swarm_task_execution":
          await api.orchestration.retrySwarmTaskExecution({
            runId: action.runId,
            executionId: action.executionId,
          });
          return null;
        case "pause_swarm":
          await api.orchestration.pauseSwarmRun({ runId: action.runId });
          return null;
        case "cancel_swarm":
          await api.orchestration.cancelSwarmRun({ runId: action.runId });
          return null;
        case "refresh_swarm_state":
          return null;
        case "open_coordinator":
          return null;
      }
    },
    onSuccess: async (result, action) => {
      if (action.kind === "open_coordinator") {
        input.onOpenCoordinator(action.epicIssueId);
        return;
      }

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
