import type {
  ThreadId,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  BeadsSwarmSummary,
  BeadsCoordinatorEpicSnapshot,
  IsoDateTime,
} from "@t3tools/contracts";
import type {
  WorkflowEntity,
  WorkflowPhase,
  WorkflowEntityType,
  SwarmCoordinationState,
  TaskExecutionState,
  IssuePreparationState,
} from "@t3tools/contracts/workflowState";

type MutableWorkflowEntity = {
  -readonly [K in keyof WorkflowEntity]: WorkflowEntity[K];
};

type WorkflowEntityUpdates = Partial<MutableWorkflowEntity>;

/**
 * Workflow Data Adapters
 *
 * Functions to convert existing orchestration data into the unified workflow state system.
 * Provides migration path from current fragmented state to new unified model.
 */

// ── Status Mapping ────────────────────────────────────────────────────────────

/**
 * Maps orchestration swarm run status to workflow coordination state
 */
function mapSwarmRunStatus(status: OrchestrationSwarmRun["status"]): SwarmCoordinationState {
  switch (status) {
    case "requested":
      return "pending";
    case "running":
      return "active";
    case "idle":
      return "idle";
    case "paused":
      return "paused";
    case "blocked":
      return "blocked_recoverable"; // Default to recoverable - can be refined based on context
    case "failed":
      return "blocked_fatal";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      return "pending";
  }
}

/**
 * Maps orchestration task execution status to workflow task state
 */
function mapTaskExecutionStatus(
  status: OrchestrationSwarmTaskExecution["status"],
): TaskExecutionState {
  switch (status) {
    case "requested":
      return "queued";
    case "active":
      return "in_progress";
    case "completed":
      return "completed";
    case "failed":
      return "failed_retryable"; // Default to retryable - can be refined
    case "cancelled":
      return "cancelled";
    default:
      return "queued";
  }
}

/**
 * Determines workflow phase based on entity type and status
 */
function determineWorkflowPhase(
  entityType: WorkflowEntityType,
  _currentState: string,
): WorkflowPhase {
  switch (entityType) {
    case "issue":
      return "issue_preparation";
    case "epic":
      return "issue_preparation";
    case "swarm_run":
      return "swarm_coordination";
    case "task_execution":
      return "task_execution";
    case "recovery_session":
      return "error_recovery";
    default:
      return "issue_preparation";
  }
}

// ── Entity Creation ───────────────────────────────────────────────────────────

/**
 * Creates a workflow entity from an orchestration swarm run
 */
export function createSwarmRunEntity(
  swarmRun: OrchestrationSwarmRun,
  threadId?: ThreadId,
): WorkflowEntity {
  const currentState = mapSwarmRunStatus(swarmRun.status);
  const phase = determineWorkflowPhase("swarm_run", currentState);

  return {
    id: swarmRun.runId,
    type: "swarm_run",
    phase,
    currentState,
    parentId: swarmRun.epicIssueId, // Epic is parent of swarm run
    relatedIds: [], // Will be populated with task execution IDs
    title: `Swarm Run for ${swarmRun.epicIssueId}`,
    description: swarmRun.lastError || null,
    assignee: null,
    priority: null,
    transitions: [], // Will be populated from transition history if available
    interventions: [], // Will be populated based on current state
    availableActions: [], // Will be calculated based on current state
    lastError: swarmRun.lastError,
    errorRecoveryState: swarmRun.lastError ? "user_intervention_required" : "none",
    progressMetrics: {
      // TODO: Calculate from task execution data
    },
    createdAt: swarmRun.requestedAt,
    updatedAt: swarmRun.updatedAt,
    stateChangedAt: swarmRun.startedAt || swarmRun.requestedAt,
  };
}

/**
 * Creates a workflow entity from an orchestration task execution
 */
export function createTaskExecutionEntity(
  taskExecution: OrchestrationSwarmTaskExecution,
  threadId?: ThreadId,
): WorkflowEntity {
  const currentState = mapTaskExecutionStatus(taskExecution.status);
  const phase = determineWorkflowPhase("task_execution", currentState);

  return {
    id: taskExecution.executionId,
    type: "task_execution",
    phase,
    currentState,
    parentId: taskExecution.runId, // Swarm run is parent
    relatedIds: [taskExecution.issueId], // Related to the issue being worked on
    title: `Task: ${taskExecution.issueId}`,
    description: taskExecution.lastError || null,
    assignee: taskExecution.workerThreadId || null,
    priority: taskExecution.sequenceNumber,
    transitions: [],
    interventions: [],
    availableActions: [],
    lastError: taskExecution.lastError,
    errorRecoveryState: taskExecution.lastError ? "user_intervention_required" : "none",
    progressMetrics: {
      sequenceNumber: taskExecution.sequenceNumber,
    },
    createdAt: taskExecution.requestedAt,
    updatedAt: taskExecution.updatedAt,
    stateChangedAt: taskExecution.startedAt || taskExecution.requestedAt,
  };
}

/**
 * Creates a workflow entity from a beads epic snapshot
 */
export function createEpicEntity(
  epic: BeadsCoordinatorEpicSnapshot,
  threadId?: ThreadId,
): WorkflowEntity {
  // Map epic state to workflow state
  const currentState: IssuePreparationState = epic.stateKind === "ready" ? "ready" : "draft";
  const phase = determineWorkflowPhase("epic", currentState);

  return {
    id: epic.epicId,
    type: "epic",
    phase,
    currentState,
    parentId: null, // Epics are top-level
    relatedIds: [], // Will be populated with issue IDs
    title: epic.epicTitle,
    description: epic.primaryAction?.label || null,
    assignee: null,
    priority: null,
    transitions: [],
    interventions: [],
    availableActions: [],
    lastError: null,
    errorRecoveryState: "none",
    progressMetrics: {},
    createdAt: new Date().toISOString() as IsoDateTime, // Not available in epic snapshot
    updatedAt: new Date().toISOString() as IsoDateTime,
    stateChangedAt: new Date().toISOString() as IsoDateTime,
  };
}

/**
 * Creates a workflow entity from a beads swarm summary
 */
export function createSwarmSummaryEntity(
  swarmSummary: BeadsSwarmSummary,
  threadId?: ThreadId,
): WorkflowEntity {
  // Determine state based on swarm activity
  let currentState: SwarmCoordinationState;
  if (swarmSummary.activeWorkerCount > 0) {
    currentState = "active";
  } else if (swarmSummary.readyIssueCount > 0) {
    currentState = "idle";
  } else {
    currentState = "pending";
  }

  const phase = determineWorkflowPhase("swarm_run", currentState);

  return {
    id: swarmSummary.swarmId,
    type: "swarm_run",
    phase,
    currentState,
    parentId: swarmSummary.epicId,
    relatedIds: [],
    title: swarmSummary.epicTitle,
    description: null,
    assignee: null,
    priority: null,
    transitions: [],
    interventions: [],
    availableActions: [],
    lastError: null,
    errorRecoveryState: "none",
    progressMetrics: {
      activeWorkers: swarmSummary.activeWorkerCount,
      readyIssues: swarmSummary.readyIssueCount,
      completedIssues: swarmSummary.completedIssueCount,
      totalIssues: swarmSummary.totalIssueCount,
      completionRate:
        swarmSummary.totalIssueCount > 0
          ? swarmSummary.completedIssueCount / swarmSummary.totalIssueCount
          : 0,
    },
    createdAt: new Date().toISOString() as IsoDateTime,
    updatedAt: new Date().toISOString() as IsoDateTime,
    stateChangedAt: new Date().toISOString() as IsoDateTime,
  };
}

// ── Batch Conversion Functions ────────────────────────────────────────────────

/**
 * Converts orchestration data to workflow entities
 */
export function convertOrchestrationDataToWorkflowEntities(data: {
  swarmRuns: OrchestrationSwarmRun[];
  taskExecutions: OrchestrationSwarmTaskExecution[];
  swarmSummaries: BeadsSwarmSummary[];
  epics: BeadsCoordinatorEpicSnapshot[];
  threadId?: ThreadId;
}): WorkflowEntity[] {
  const entities: WorkflowEntity[] = [];

  // Convert epics
  data.epics.forEach((epic) => {
    entities.push(createEpicEntity(epic, data.threadId));
  });

  // Convert swarm runs
  data.swarmRuns.forEach((swarmRun) => {
    entities.push(createSwarmRunEntity(swarmRun, data.threadId));
  });

  // Convert swarm summaries (if not already covered by swarm runs)
  data.swarmSummaries.forEach((swarmSummary) => {
    // Only add if we don't already have a swarm run entity for this swarm
    if (!entities.find((e) => e.id === swarmSummary.swarmId)) {
      entities.push(createSwarmSummaryEntity(swarmSummary, data.threadId));
    }
  });

  // Convert task executions
  data.taskExecutions.forEach((taskExecution) => {
    entities.push(createTaskExecutionEntity(taskExecution, data.threadId));
  });

  // Establish relationships between entities
  establishEntityRelationships(entities);

  return entities;
}

/**
 * Establishes parent-child and related entity relationships
 */
function establishEntityRelationships(entities: WorkflowEntity[]): void {
  const mutableEntities = entities as MutableWorkflowEntity[];

  mutableEntities.forEach((entity) => {
    switch (entity.type) {
      case "swarm_run": {
        const taskExecutions = mutableEntities.filter(
          (e) => e.type === "task_execution" && e.parentId === entity.id,
        );
        entity.relatedIds = taskExecutions.map((te) => te.id);
        break;
      }

      case "epic": {
        const swarmRuns = mutableEntities.filter(
          (e) => e.type === "swarm_run" && e.parentId === entity.id,
        );
        entity.relatedIds = swarmRuns.map((sr) => sr.id);
        break;
      }

      case "task_execution": {
        // Task executions are already properly linked via parentId
        break;
      }
    }
  });
}

// ── State Synchronization ─────────────────────────────────────────────────────

/**
 * Determines if orchestration data represents a state change for an existing entity
 */
export function hasEntityStateChanged(
  existingEntity: WorkflowEntity,
  newData: OrchestrationSwarmRun | OrchestrationSwarmTaskExecution | BeadsSwarmSummary,
): boolean {
  let newState: string;

  if ("status" in newData) {
    if ("runId" in newData) {
      // This is a task execution
      newState = mapTaskExecutionStatus((newData as OrchestrationSwarmTaskExecution).status);
    } else {
      // This is a swarm run
      newState = mapSwarmRunStatus((newData as OrchestrationSwarmRun).status);
    }
  } else {
    // This is a swarm summary - derive state from activity
    const summary = newData as BeadsSwarmSummary;
    if (summary.activeWorkerCount > 0) {
      newState = "active";
    } else if (summary.readyIssueCount > 0) {
      newState = "idle";
    } else {
      newState = "pending";
    }
  }

  return existingEntity.currentState !== newState;
}

/**
 * Updates an existing workflow entity with new orchestration data
 */
export function updateEntityFromOrchestrationData(
  existingEntity: WorkflowEntity,
  newData: OrchestrationSwarmRun | OrchestrationSwarmTaskExecution | BeadsSwarmSummary,
): Partial<WorkflowEntity> {
  const updates: WorkflowEntityUpdates = {};

  if ("status" in newData) {
    if ("runId" in newData) {
      // Task execution update
      const taskExecution = newData as OrchestrationSwarmTaskExecution;
      updates.currentState = mapTaskExecutionStatus(taskExecution.status);
      updates.lastError = taskExecution.lastError;
      updates.updatedAt = taskExecution.updatedAt;
      updates.assignee = taskExecution.workerThreadId;

      if (taskExecution.lastError) {
        updates.errorRecoveryState = "user_intervention_required";
      } else {
        updates.errorRecoveryState = "none";
      }
    } else {
      // Swarm run update
      const swarmRun = newData as OrchestrationSwarmRun;
      updates.currentState = mapSwarmRunStatus(swarmRun.status);
      updates.lastError = swarmRun.lastError;
      updates.updatedAt = swarmRun.updatedAt;

      if (swarmRun.lastError) {
        updates.errorRecoveryState = "user_intervention_required";
      } else {
        updates.errorRecoveryState = "none";
      }
    }
  } else {
    // Swarm summary update
    const summary = newData as BeadsSwarmSummary;
    if (summary.activeWorkerCount > 0) {
      updates.currentState = "active";
    } else if (summary.readyIssueCount > 0) {
      updates.currentState = "idle";
    } else {
      updates.currentState = "pending";
    }

    updates.progressMetrics = {
      ...existingEntity.progressMetrics,
      activeWorkers: summary.activeWorkerCount,
      readyIssues: summary.readyIssueCount,
      completedIssues: summary.completedIssueCount,
      totalIssues: summary.totalIssueCount,
      completionRate:
        summary.totalIssueCount > 0 ? summary.completedIssueCount / summary.totalIssueCount : 0,
    };
  }

  return updates;
}
