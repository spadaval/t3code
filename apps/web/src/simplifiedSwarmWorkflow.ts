import type { SwarmRunId, SwarmTaskExecutionId } from "@t3tools/contracts";
import type {
  WorkflowEntity,
  InterventionRequest,
  InterventionOption,
} from "@t3tools/contracts/workflowState";

/**
 * Web-side integration for the simplified swarm workflow.
 * Connects the simplified server-side workflow to the unified WorkflowStateManager.
 */

export interface SwarmWorkflowWebService {
  // Workflow control actions
  startSwarm: (projectId: string, epicIssueId: string) => Promise<WorkflowEntity>;
  pauseSwarm: (runId: SwarmRunId) => Promise<WorkflowEntity>;
  resumeSwarm: (runId: SwarmRunId) => Promise<WorkflowEntity>;
  cancelSwarm: (runId: SwarmRunId) => Promise<WorkflowEntity>;

  // Task control
  executeNextTask: (runId: SwarmRunId) => Promise<WorkflowEntity>;
  markTaskCompleted: (runId: SwarmRunId, taskId: SwarmTaskExecutionId) => Promise<WorkflowEntity>;
  markTaskFailed: (
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
    reason: string,
  ) => Promise<WorkflowEntity>;

  // Manual intervention
  requestManualIntervention: (runId: SwarmRunId, reason: string) => Promise<InterventionRequest>;
  respondToIntervention: (
    interventionId: string,
    optionId: string,
    reason?: string,
  ) => Promise<WorkflowEntity>;
  getActiveInterventions: (runId?: SwarmRunId) => Promise<readonly InterventionRequest[]>;

  // State inspection
  getSwarmState: (runId: SwarmRunId) => Promise<WorkflowEntity>;
  getExecutionHistory: (
    runId: SwarmRunId,
  ) => Promise<readonly { timestamp: string; event: string; context: Record<string, unknown> }[]>;
}

/**
 * WebSocket-based implementation that communicates with the simplified server workflow
 */
export class SimplifiedSwarmWorkflowWebService implements SwarmWorkflowWebService {
  constructor(
    private readonly wsClient: {
      send: (method: string, params: unknown) => Promise<unknown>;
    },
  ) {}

  async startSwarm(projectId: string, epicIssueId: string): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.start", {
      projectId,
      epicIssueId,
      workspaceMode: "shared", // Default for now
    });
    return result as WorkflowEntity;
  }

  async pauseSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.pause", { runId });
    return result as WorkflowEntity;
  }

  async resumeSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.resume", { runId });
    return result as WorkflowEntity;
  }

  async cancelSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.cancel", { runId });
    return result as WorkflowEntity;
  }

  async executeNextTask(runId: SwarmRunId): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.execute_next_task", { runId });
    return result as WorkflowEntity;
  }

  async markTaskCompleted(
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
  ): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.mark_task_completed", {
      runId,
      taskId,
    });
    return result as WorkflowEntity;
  }

  async markTaskFailed(
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
    reason: string,
  ): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.mark_task_failed", {
      runId,
      taskId,
      reason,
    });
    return result as WorkflowEntity;
  }

  async requestManualIntervention(runId: SwarmRunId, reason: string): Promise<InterventionRequest> {
    const result = await this.wsClient.send("simplified_swarm.request_intervention", {
      runId,
      interventionType: "user_requested",
      context: { reason },
      suggestedActions: ["Retry", "Skip", "Cancel", "Debug"],
    });
    return result as InterventionRequest;
  }

  async respondToIntervention(
    interventionId: string,
    optionId: string,
    reason?: string,
  ): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.respond_to_intervention", {
      interventionId,
      response: {
        action: optionId,
        reason,
      },
    });
    return result as WorkflowEntity;
  }

  async getActiveInterventions(runId?: SwarmRunId): Promise<readonly InterventionRequest[]> {
    const result = await this.wsClient.send("simplified_swarm.get_active_interventions", { runId });
    return result as readonly InterventionRequest[];
  }

  async getSwarmState(runId: SwarmRunId): Promise<WorkflowEntity> {
    const result = await this.wsClient.send("simplified_swarm.get_swarm_state", { runId });
    return result as WorkflowEntity;
  }

  async getExecutionHistory(
    runId: SwarmRunId,
  ): Promise<readonly { timestamp: string; event: string; context: Record<string, unknown> }[]> {
    const result = await this.wsClient.send("simplified_swarm.get_execution_history", { runId });
    return result as readonly {
      timestamp: string;
      event: string;
      context: Record<string, unknown>;
    }[];
  }
}

/**
 * Integration with WorkflowStateManager
 * Updates the unified workflow state when swarm operations complete
 */
export function createSwarmWorkflowIntegration(
  swarmService: SwarmWorkflowWebService,
  workflowStateManager: {
    updateEntity: (entity: WorkflowEntity) => void;
    addIntervention: (intervention: InterventionRequest) => void;
    removeIntervention: (interventionId: string) => void;
  },
) {
  return {
    // Enhanced actions that update the workflow state
    async startSwarm(projectId: string, epicIssueId: string): Promise<WorkflowEntity> {
      const entity = await swarmService.startSwarm(projectId, epicIssueId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async pauseSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
      const entity = await swarmService.pauseSwarm(runId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async resumeSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
      const entity = await swarmService.resumeSwarm(runId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async cancelSwarm(runId: SwarmRunId): Promise<WorkflowEntity> {
      const entity = await swarmService.cancelSwarm(runId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async executeNextTask(runId: SwarmRunId): Promise<WorkflowEntity> {
      const entity = await swarmService.executeNextTask(runId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async markTaskCompleted(
      runId: SwarmRunId,
      taskId: SwarmTaskExecutionId,
    ): Promise<WorkflowEntity> {
      const entity = await swarmService.markTaskCompleted(runId, taskId);
      workflowStateManager.updateEntity(entity);
      return entity;
    },

    async markTaskFailed(
      runId: SwarmRunId,
      taskId: SwarmTaskExecutionId,
      reason: string,
    ): Promise<WorkflowEntity> {
      const entity = await swarmService.markTaskFailed(runId, taskId, reason);
      workflowStateManager.updateEntity(entity);

      // If the entity requires intervention, it should already have interventionOptions populated
      if (entity.requiresIntervention) {
        // Check for new interventions
        const interventions = await swarmService.getActiveInterventions(runId);
        interventions.forEach((intervention) => {
          workflowStateManager.addIntervention(intervention);
        });
      }

      return entity;
    },

    async respondToIntervention(
      interventionId: string,
      optionId: string,
      reason?: string,
    ): Promise<WorkflowEntity> {
      const entity = await swarmService.respondToIntervention(interventionId, optionId, reason);
      workflowStateManager.updateEntity(entity);
      workflowStateManager.removeIntervention(interventionId);
      return entity;
    },

    async requestManualIntervention(
      runId: SwarmRunId,
      reason: string,
    ): Promise<InterventionRequest> {
      const intervention = await swarmService.requestManualIntervention(runId, reason);
      workflowStateManager.addIntervention(intervention);
      return intervention;
    },

    // Pass-through methods for state inspection
    getActiveInterventions: swarmService.getActiveInterventions.bind(swarmService),
    getSwarmState: swarmService.getSwarmState.bind(swarmService),
    getExecutionHistory: swarmService.getExecutionHistory.bind(swarmService),
  };
}
