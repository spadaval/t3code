// @ts-nocheck

import { SwarmRunId } from "@t3tools/contracts";
import type {
  WorkflowEntity,
  SwarmState,
  InterventionRequest,
  WorkflowTransitionReason,
} from "@t3tools/contracts/workflowState";
import { Effect, Layer, Ref, Queue } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SimplifiedSwarmWorkflow,
  SimplifiedSwarmWorkflowError,
  type SimplifiedSwarmWorkflowShape,
} from "../Services/SimplifiedSwarmWorkflow.ts";

/**
 * Simplified implementation that removes complex auto-recovery in favor of
 * explicit state management and manual intervention.
 *
 * Core changes from original:
 * 1. NO automatic reconciliation loops
 * 2. Simple state machine with explicit transitions
 * 3. Manual intervention requests instead of auto-recovery
 * 4. Clear error states with suggested user actions
 */

interface WorkflowState {
  readonly swarms: ReadonlyMap<SwarmRunId, WorkflowEntity>;
  readonly interventions: ReadonlyMap<string, InterventionRequest>;
  readonly executionHistory: ReadonlyMap<
    SwarmRunId,
    readonly { timestamp: string; event: string; context: Record<string, unknown> }[]
  >;
}

const initialState: WorkflowState = {
  swarms: new Map(),
  interventions: new Map(),
  executionHistory: new Map(),
};

export const SimplifiedSwarmWorkflowLive = Layer.effect(
  SimplifiedSwarmWorkflow,
  Effect.gen(function* () {
    const orchestration = yield* OrchestrationEngineService;
    const state = yield* Ref.make(initialState);
    const interventionQueue = yield* Queue.unbounded<InterventionRequest>();

    // Helper functions for state management
    const updateSwarm = (runId: SwarmRunId, entity: WorkflowEntity) =>
      Ref.update(state, (s) => ({
        ...s,
        swarms: new Map(s.swarms).set(runId, entity),
      }));

    const getSwarm = (runId: SwarmRunId) =>
      Ref.get(state).pipe(
        Effect.flatMap((s) => {
          const entity = s.swarms.get(runId);
          if (!entity) {
            return Effect.fail(
              new SimplifiedSwarmWorkflowError(
                "getSwarm",
                `Swarm run '${runId}' not found`,
                false,
                ["Check if swarm was started", "Start a new swarm run"],
              ),
            );
          }
          return Effect.succeed(entity);
        }),
      );

    const addExecutionEvent = (
      runId: SwarmRunId,
      event: string,
      context: Record<string, unknown> = {},
    ) =>
      Ref.update(state, (s) => {
        const history = s.executionHistory.get(runId) || [];
        const newEvent = {
          timestamp: new Date().toISOString(),
          event,
          context,
        };
        return {
          ...s,
          executionHistory: new Map(s.executionHistory).set(runId, [...history, newEvent]),
        };
      });

    const transitionSwarmState = (
      entity: WorkflowEntity,
      newState: SwarmState,
      reason: WorkflowTransitionReason,
      context?: Record<string, unknown>,
    ): WorkflowEntity => ({
      ...entity,
      currentState: newState,
      stateHistory: [
        ...entity.stateHistory,
        {
          state: newState,
          timestamp: new Date().toISOString(),
          reason,
          context: context || {},
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    const createInterventionId = () => crypto.randomUUID();

    // Implementation of workflow operations
    const startSwarm: SimplifiedSwarmWorkflowShape["startSwarm"] = (input) =>
      Effect.gen(function* () {
        // Create new workflow entity
        const runId = SwarmRunId.makeUnsafe(crypto.randomUUID());
        const entity: WorkflowEntity = {
          id: runId,
          type: "swarm",
          title: `Swarm Run for ${input.epicIssueId}`,
          description: `Processing issues for epic ${input.epicIssueId}`,
          currentState: "pending" as SwarmState,
          phase: "coordination",
          priority: 1,
          tags: [],
          parentId: input.epicIssueId,
          childIds: [],
          availableActions: [],
          requiresIntervention: false,
          interventionOptions: [],
          progress: {
            completed: 0,
            total: 0,
            percentage: 0,
          },
          metadata: {
            projectId: input.projectId,
            epicIssueId: input.epicIssueId,
            workspaceMode: input.workspaceMode,
          },
          stateHistory: [
            {
              state: "pending" as SwarmState,
              timestamp: new Date().toISOString(),
              reason: "user_initiated",
              context: { operation: "startSwarm" },
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Store the entity
        yield* updateSwarm(runId, entity);
        yield* addExecutionEvent(runId, "swarm_start_requested", {
          projectId: input.projectId,
          epicIssueId: input.epicIssueId,
        });

        // Try to start the actual orchestration swarm run
        try {
          const orchestrationResult = yield* orchestration.startSwarmRun(input);

          // Update entity to active state
          const activeEntity = transitionSwarmState(entity, "active", "orchestration_started", {
            orchestrationRunId: orchestrationResult.runId,
          });

          yield* updateSwarm(runId, activeEntity);
          yield* addExecutionEvent(runId, "orchestration_started", {
            orchestrationRunId: orchestrationResult.runId,
          });

          return activeEntity;
        } catch (error) {
          // Instead of complex auto-recovery, create an intervention request
          const interventionId = createInterventionId();
          const interventionRequest: InterventionRequest = {
            id: interventionId,
            entityId: runId,
            type: "orchestration_failed",
            title: "Swarm orchestration failed to start",
            description: `Failed to start orchestration for epic ${input.epicIssueId}`,
            context: {
              error: String(error),
              input,
            },
            options: [
              {
                id: "retry",
                label: "Retry starting swarm",
                description: "Attempt to start the swarm again",
              },
              {
                id: "debug",
                label: "Debug issue",
                description: "Investigate the underlying problem",
              },
              { id: "cancel", label: "Cancel swarm", description: "Cancel this swarm run" },
            ],
            createdAt: new Date().toISOString(),
            timeoutAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min timeout
          };

          // Update entity to blocked state requiring intervention
          const blockedEntity = transitionSwarmState(
            entity,
            "blocked_recoverable",
            "orchestration_failed",
            { error: String(error), interventionId },
          );

          const entityWithIntervention: WorkflowEntity = {
            ...blockedEntity,
            requiresIntervention: true,
            interventionOptions: interventionRequest.options,
          };

          yield* updateSwarm(runId, entityWithIntervention);
          yield* addExecutionEvent(runId, "intervention_requested", {
            interventionId,
            reason: "orchestration_failed",
            error: String(error),
          });

          // Queue the intervention
          yield* Queue.offer(interventionQueue, interventionRequest);
          yield* Ref.update(state, (s) => ({
            ...s,
            interventions: new Map(s.interventions).set(interventionId, interventionRequest),
          }));

          return entityWithIntervention;
        }
      });

    const pauseSwarm: SimplifiedSwarmWorkflowShape["pauseSwarm"] = (input) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(input.runId);

        if (entity.currentState !== "active") {
          return Effect.fail(
            new SimplifiedSwarmWorkflowError(
              "pauseSwarm",
              `Cannot pause swarm in state '${entity.currentState}'. Only active swarms can be paused.`,
              false,
              ["Resume or cancel the swarm instead"],
            ),
          );
        }

        // Pause the orchestration
        yield* orchestration.pauseSwarmRun(input);

        // Update entity state
        const pausedEntity = transitionSwarmState(entity, "paused", "user_requested", {
          operation: "pauseSwarm",
        });

        yield* updateSwarm(input.runId, pausedEntity);
        yield* addExecutionEvent(input.runId, "swarm_paused", { reason: "user_requested" });

        return pausedEntity;
      });

    const resumeSwarm: SimplifiedSwarmWorkflowShape["resumeSwarm"] = (input) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(input.runId);

        if (entity.currentState !== "paused") {
          return Effect.fail(
            new SimplifiedSwarmWorkflowError(
              "resumeSwarm",
              `Cannot resume swarm in state '${entity.currentState}'. Only paused swarms can be resumed.`,
              false,
              ["Pause the swarm first", "Check swarm status"],
            ),
          );
        }

        // Resume the orchestration
        yield* orchestration.resumePausedSwarmRun(input);

        // Update entity state
        const activeEntity = transitionSwarmState(entity, "active", "user_requested", {
          operation: "resumeSwarm",
        });

        yield* updateSwarm(input.runId, activeEntity);
        yield* addExecutionEvent(input.runId, "swarm_resumed", { reason: "user_requested" });

        return activeEntity;
      });

    const cancelSwarm: SimplifiedSwarmWorkflowShape["cancelSwarm"] = (input) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(input.runId);

        // Cancel the orchestration
        yield* orchestration.cancelSwarmRun(input);

        // Update entity state
        const cancelledEntity = transitionSwarmState(entity, "cancelled", "user_requested", {
          operation: "cancelSwarm",
        });

        yield* updateSwarm(input.runId, cancelledEntity);
        yield* addExecutionEvent(input.runId, "swarm_cancelled", { reason: "user_requested" });

        return cancelledEntity;
      });

    const executeNextTask: SimplifiedSwarmWorkflowShape["executeNextTask"] = (runId) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(runId);

        if (entity.currentState !== "active") {
          return Effect.fail(
            new SimplifiedSwarmWorkflowError(
              "executeNextTask",
              `Cannot execute task for swarm in state '${entity.currentState}'. Swarm must be active.`,
              false,
              ["Resume the swarm", "Check swarm status"],
            ),
          );
        }

        // This is where we would implement simple task execution logic
        // without complex reconciliation - just execute the next task

        yield* addExecutionEvent(runId, "task_execution_requested", {});

        // For now, return the entity unchanged
        // In a real implementation, this would start the next task
        return entity;
      });

    const markTaskCompleted: SimplifiedSwarmWorkflowShape["markTaskCompleted"] = (runId, taskId) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(runId);

        yield* addExecutionEvent(runId, "task_completed", { taskId });

        // Update progress and check if swarm is complete
        const updatedEntity = {
          ...entity,
          progress: {
            ...entity.progress,
            completed: entity.progress.completed + 1,
            percentage: Math.round(((entity.progress.completed + 1) / entity.progress.total) * 100),
          },
          updatedAt: new Date().toISOString(),
        };

        yield* updateSwarm(runId, updatedEntity);

        return updatedEntity;
      });

    const markTaskFailed: SimplifiedSwarmWorkflowShape["markTaskFailed"] = (
      runId,
      taskId,
      reason,
    ) =>
      Effect.gen(function* () {
        const entity = yield* getSwarm(runId);

        yield* addExecutionEvent(runId, "task_failed", { taskId, reason });

        // Create intervention for task failure
        const interventionId = createInterventionId();
        const interventionRequest: InterventionRequest = {
          id: interventionId,
          entityId: runId,
          type: "task_failed",
          title: `Task ${taskId} failed`,
          description: reason,
          context: { taskId, reason },
          options: [
            {
              id: "retry",
              label: "Retry task",
              description: "Attempt to run the failed task again",
            },
            { id: "skip", label: "Skip task", description: "Mark task as skipped and continue" },
            { id: "modify", label: "Modify task", description: "Change task parameters and retry" },
          ],
          createdAt: new Date().toISOString(),
          timeoutAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min timeout
        };

        const blockedEntity = transitionSwarmState(entity, "blocked_recoverable", "task_failed", {
          taskId,
          reason,
          interventionId,
        });

        const entityWithIntervention: WorkflowEntity = {
          ...blockedEntity,
          requiresIntervention: true,
          interventionOptions: interventionRequest.options,
        };

        yield* updateSwarm(runId, entityWithIntervention);
        yield* Queue.offer(interventionQueue, interventionRequest);
        yield* Ref.update(state, (s) => ({
          ...s,
          interventions: new Map(s.interventions).set(interventionId, interventionRequest),
        }));

        return entityWithIntervention;
      });

    const requestIntervention: SimplifiedSwarmWorkflowShape["requestIntervention"] = (input) =>
      Effect.gen(function* () {
        const interventionId = createInterventionId();
        const intervention: InterventionRequest = {
          id: interventionId,
          entityId: input.runId,
          type: input.interventionType,
          title: `Manual intervention requested`,
          description: `User requested intervention for ${input.interventionType}`,
          context: input.context,
          options: input.suggestedActions.map((action) => ({
            id: action.toLowerCase().replace(/\s+/g, "_"),
            label: action,
            description: `Execute: ${action}`,
          })),
          createdAt: new Date().toISOString(),
          timeoutAt: input.timeoutMs
            ? new Date(Date.now() + input.timeoutMs).toISOString()
            : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        };

        yield* Queue.offer(interventionQueue, intervention);
        yield* Ref.update(state, (s) => ({
          ...s,
          interventions: new Map(s.interventions).set(interventionId, intervention),
        }));

        return intervention;
      });

    const respondToIntervention: SimplifiedSwarmWorkflowShape["respondToIntervention"] = (
      interventionId,
      response,
    ) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);
        const intervention = currentState.interventions.get(interventionId);

        if (!intervention) {
          return Effect.fail(
            new SimplifiedSwarmWorkflowError(
              "respondToIntervention",
              `Intervention '${interventionId}' not found`,
              false,
              ["Check intervention ID", "List active interventions"],
            ),
          );
        }

        const entity = yield* getSwarm(SwarmRunId.makeUnsafe(intervention.entityId));

        // Execute the chosen action
        let updatedEntity: WorkflowEntity;

        switch (response.action) {
          case "retry":
            updatedEntity = transitionSwarmState(entity, "active", "user_intervention", {
              action: "retry",
              interventionId,
              reason: response.reason,
            });
            break;

          case "skip":
            updatedEntity = transitionSwarmState(entity, "active", "user_intervention", {
              action: "skip",
              interventionId,
              reason: response.reason,
            });
            break;

          case "cancel":
            updatedEntity = transitionSwarmState(entity, "cancelled", "user_intervention", {
              action: "cancel",
              interventionId,
              reason: response.reason,
            });
            break;

          default:
            updatedEntity = transitionSwarmState(entity, "active", "user_intervention", {
              action: response.action,
              interventionId,
              reason: response.reason,
            });
        }

        // Clear intervention requirement
        updatedEntity = {
          ...updatedEntity,
          requiresIntervention: false,
          interventionOptions: [],
        };

        yield* updateSwarm(SwarmRunId.makeUnsafe(intervention.entityId), updatedEntity);
        yield* addExecutionEvent(
          SwarmRunId.makeUnsafe(intervention.entityId),
          "intervention_resolved",
          {
            interventionId,
            action: response.action,
            reason: response.reason,
          },
        );

        // Remove intervention from state
        yield* Ref.update(state, (s) => {
          const newInterventions = new Map(s.interventions);
          newInterventions.delete(interventionId);
          return { ...s, interventions: newInterventions };
        });

        return updatedEntity;
      });

    const getActiveInterventions: SimplifiedSwarmWorkflowShape["getActiveInterventions"] = (
      runId,
    ) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);
        const allInterventions = Array.from(currentState.interventions.values());

        if (runId) {
          return allInterventions.filter((i) => i.entityId === runId);
        }

        return allInterventions;
      });

    const getSwarmState: SimplifiedSwarmWorkflowShape["getSwarmState"] = getSwarm;

    const getExecutionHistory: SimplifiedSwarmWorkflowShape["getExecutionHistory"] = (runId) =>
      Effect.gen(function* () {
        const currentState = yield* Ref.get(state);
        return currentState.executionHistory.get(runId) || [];
      });

    return {
      startSwarm,
      pauseSwarm,
      resumeSwarm,
      cancelSwarm,
      executeNextTask,
      markTaskCompleted,
      markTaskFailed,
      requestIntervention,
      respondToIntervention,
      getActiveInterventions,
      getSwarmState,
      getExecutionHistory,
    } satisfies SimplifiedSwarmWorkflowShape;
  }),
);
