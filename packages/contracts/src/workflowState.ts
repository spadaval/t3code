import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import type {
  OrchestrationSwarmRunStatus,
  OrchestrationSwarmTaskExecutionStatus,
} from "./orchestration";

/**
 * Unified Workflow State System
 *
 * This module defines clear state machines for the issue->swarm->execution workflow
 * with explicit transitions, guards, and manual intervention points.
 */

// ── Core Workflow States ──────────────────────────────────────────────────────

export const WorkflowPhase = Schema.Literals([
  "issue_preparation", // Setting up issues, epics, dependencies
  "swarm_coordination", // Managing swarm lifecycle (start/pause/resume)
  "task_execution", // Individual task execution by agents
  "completion_review", // Final review and cleanup
  "error_recovery", // Handling failures and recovery
  "coordination", // Legacy alias used by older workflow modules
]);
export type WorkflowPhase = typeof WorkflowPhase.Type;

// ── Issue Preparation States ──────────────────────────────────────────────────

export const IssuePreparationState = Schema.Literals([
  "draft", // Issue being created/edited
  "ready", // Issue ready for work, dependencies satisfied
  "blocked", // Blocked by dependencies or external factors
  "deferred", // Intentionally postponed
]);
export type IssuePreparationState = typeof IssuePreparationState.Type;

// ── Swarm Coordination States ─────────────────────────────────────────────────

export const SwarmCoordinationState = Schema.Literals([
  "pending", // Swarm configured but not started
  "starting", // Swarm startup in progress
  "active", // Swarm running with active workers
  "paused", // Swarm paused by user
  "idle", // Swarm waiting for work or next task
  "blocked_recoverable", // Swarm blocked but can be recovered manually
  "blocked_fatal", // Swarm failed and requires restart
  "completing", // Swarm finishing final tasks
  "completed", // Swarm successfully completed all work
  "cancelled", // Swarm cancelled by user
]);
export type SwarmCoordinationState = typeof SwarmCoordinationState.Type;
export const SwarmState = SwarmCoordinationState;
export type SwarmState = SwarmCoordinationState;

// ── Task Execution States ─────────────────────────────────────────────────────

export const TaskExecutionState = Schema.Literals([
  "queued", // Task waiting to be picked up
  "assigned", // Task assigned to specific worker
  "in_progress", // Task actively being worked on
  "review_required", // Task completed but needs review
  "completed", // Task successfully completed
  "failed_retryable", // Task failed but can be retried
  "failed_terminal", // Task failed and cannot be retried
  "cancelled", // Task cancelled by user or system
]);
export type TaskExecutionState = typeof TaskExecutionState.Type;
export const TaskState = TaskExecutionState;
export type TaskState = TaskExecutionState;

// ── Error Recovery States ─────────────────────────────────────────────────────

export const ErrorRecoveryState = Schema.Literals([
  "none", // No errors present
  "diagnosing", // System identifying the problem
  "user_intervention_required", // User must take action
  "auto_retry_pending", // Automatic retry scheduled
  "manual_recovery", // Manual recovery in progress
  "recovery_complete", // Error resolved, resuming normal flow
]);
export type ErrorRecoveryState = typeof ErrorRecoveryState.Type;

// ── State Transition Contexts ─────────────────────────────────────────────────

export const WorkflowTransitionReason = Schema.Literals([
  "user_action", // User explicitly triggered transition
  "system_event", // System event caused transition
  "dependency_resolved", // Dependency became satisfied
  "error_occurred", // Error caused transition
  "timeout_reached", // Timeout caused transition
  "manual_override", // User manually overrode normal flow
  "user_requested", // Legacy alias
  "user_initiated", // Legacy alias
  "orchestration_started", // Legacy alias
  "orchestration_failed", // Legacy alias
  "task_failed", // Legacy alias
  "user_intervention", // Legacy alias
]);
export type WorkflowTransitionReason = typeof WorkflowTransitionReason.Type;

export const WorkflowTransition = Schema.Struct({
  fromState: Schema.String,
  toState: Schema.String,
  reason: WorkflowTransitionReason,
  triggeredBy: Schema.NullOr(Schema.String), // user ID or system component
  metadata: Schema.Record(Schema.String, Schema.Unknown), // additional context
  timestamp: IsoDateTime,
});
export type WorkflowTransition = typeof WorkflowTransition.Type;

// ── Manual Intervention Points ────────────────────────────────────────────────

export const InterventionType = Schema.Literals([
  "approval_required", // User must approve action
  "choice_required", // User must make a choice between options
  "input_required", // User must provide input/configuration
  "recovery_action", // User must perform recovery action
  "override_confirmation", // User must confirm override of safety check
]);
export type InterventionType = typeof InterventionType.Type;

export const InterventionOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  isDestructive: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  isRecommended: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type InterventionOption = typeof InterventionOption.Type;

export const WorkflowInterventionPoint = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: InterventionType,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  options: Schema.Array(InterventionOption),
  defaultOptionId: Schema.NullOr(TrimmedNonEmptyString),
  timeoutSeconds: Schema.NullOr(Schema.Number), // auto-select default after timeout
  createdAt: IsoDateTime,
});
export type WorkflowInterventionPoint = typeof WorkflowInterventionPoint.Type;

export const InterventionRequestOption = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
});
export type InterventionRequestOption = typeof InterventionRequestOption.Type;

export const InterventionRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  entityId: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  context: Schema.Record(Schema.String, Schema.Unknown),
  options: Schema.Array(InterventionRequestOption),
  createdAt: IsoDateTime,
  timeoutAt: IsoDateTime,
});
export type InterventionRequest = typeof InterventionRequest.Type;

// ── Contextual Actions ────────────────────────────────────────────────────────

export const ActionCategory = Schema.Literals([
  "primary", // Main action user should take
  "secondary", // Alternative actions
  "diagnostic", // Actions for debugging/understanding state
  "recovery", // Actions for fixing problems
  "destructive", // Potentially harmful actions (require confirmation)
]);
export type ActionCategory = typeof ActionCategory.Type;

export const ContextualAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  category: ActionCategory,
  icon: Schema.NullOr(TrimmedNonEmptyString),
  isEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  requiresConfirmation: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  shortcut: Schema.NullOr(TrimmedNonEmptyString), // keyboard shortcut
});
export type ContextualAction = typeof ContextualAction.Type;

// ── Unified Workflow Entity ───────────────────────────────────────────────────

export const WorkflowEntityType = Schema.Literals([
  "issue",
  "epic",
  "swarm", // Legacy alias
  "swarm_run",
  "task_execution",
  "recovery_session",
]);
export type WorkflowEntityType = typeof WorkflowEntityType.Type;

export const WorkflowProgress = Schema.Struct({
  completed: Schema.Number.pipe(Schema.withDecodingDefault(() => 0)),
  total: Schema.Number.pipe(Schema.withDecodingDefault(() => 0)),
  percentage: Schema.Number.pipe(Schema.withDecodingDefault(() => 0)),
  estimatedCompletion: Schema.optional(IsoDateTime),
  velocity: Schema.optional(Schema.Number),
  errorRate: Schema.optional(Schema.Number),
});
export type WorkflowProgress = typeof WorkflowProgress.Type;

export const WorkflowStateHistoryEntry = Schema.Struct({
  state: Schema.String,
  timestamp: IsoDateTime,
  reason: Schema.String,
  context: Schema.Record(Schema.String, Schema.Unknown),
});
export type WorkflowStateHistoryEntry = typeof WorkflowStateHistoryEntry.Type;

export const WorkflowEntity = Schema.Struct({
  id: TrimmedNonEmptyString,
  type: WorkflowEntityType,
  phase: WorkflowPhase,

  // Current state (varies by entity type)
  currentState: Schema.String,

  // Entity relationships
  parentId: Schema.NullOr(TrimmedNonEmptyString), // e.g., epic for issue
  relatedIds: Schema.Array(TrimmedNonEmptyString), // dependencies, linked entities
  childIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),

  // Core metadata
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(TrimmedNonEmptyString),
  assignee: Schema.NullOr(TrimmedNonEmptyString),
  priority: Schema.NullOr(Schema.Number),
  tags: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),

  // State transition history
  transitions: Schema.Array(WorkflowTransition),
  stateHistory: Schema.optional(Schema.Array(WorkflowStateHistoryEntry)),

  // Active intervention points
  interventions: Schema.Array(WorkflowInterventionPoint),
  interventionOptions: Schema.optional(Schema.Array(InterventionRequestOption)),
  requiresIntervention: Schema.optional(Schema.Boolean),

  // Available contextual actions
  availableActions: Schema.Array(ContextualAction),

  // Error context
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  errorRecoveryState: ErrorRecoveryState,

  // Progress tracking
  progressMetrics: Schema.Record(Schema.String, Schema.Number), // completion %, etc.
  progress: Schema.optional(WorkflowProgress),

  // Timestamps
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  stateChangedAt: IsoDateTime,
});
export type WorkflowEntity = typeof WorkflowEntity.Type;

// ── State Machine Definitions ─────────────────────────────────────────────────

/**
 * Defines valid state transitions for each workflow entity type
 */
export const StateTransitions: Record<WorkflowEntityType, Record<string, string[]>> = {
  issue: {
    draft: ["ready", "deferred", "blocked"],
    ready: ["blocked", "deferred"],
    blocked: ["ready", "deferred"],
    deferred: ["draft", "ready"],
  },
  epic: {
    draft: ["ready", "deferred"],
    ready: ["blocked", "deferred"],
    blocked: ["ready", "deferred"],
    deferred: ["draft", "ready"],
  },
  swarm: {
    pending: ["starting", "cancelled"],
    starting: ["active", "blocked_recoverable", "blocked_fatal", "cancelled"],
    active: ["paused", "idle", "blocked_recoverable", "blocked_fatal", "completing", "cancelled"],
    paused: ["active", "cancelled"],
    idle: ["active", "completing", "cancelled"],
    blocked_recoverable: ["active", "paused", "blocked_fatal", "cancelled"],
    blocked_fatal: ["pending", "cancelled"],
    completing: ["completed", "blocked_recoverable"],
    completed: [],
    cancelled: [],
  },
  swarm_run: {
    pending: ["starting", "cancelled"],
    starting: ["active", "blocked_recoverable", "blocked_fatal", "cancelled"],
    active: ["paused", "idle", "blocked_recoverable", "blocked_fatal", "completing", "cancelled"],
    paused: ["active", "cancelled"],
    idle: ["active", "completing", "cancelled"],
    blocked_recoverable: ["active", "paused", "blocked_fatal", "cancelled"],
    blocked_fatal: ["pending", "cancelled"], // requires restart
    completing: ["completed", "blocked_recoverable"],
    completed: [],
    cancelled: [],
  },
  task_execution: {
    queued: ["assigned", "cancelled"],
    assigned: ["in_progress", "queued", "cancelled"],
    in_progress: [
      "review_required",
      "completed",
      "failed_retryable",
      "failed_terminal",
      "cancelled",
    ],
    review_required: ["completed", "in_progress", "failed_retryable"],
    completed: [],
    failed_retryable: ["queued", "failed_terminal", "cancelled"],
    failed_terminal: [],
    cancelled: [],
  },
  recovery_session: {
    none: ["diagnosing"],
    diagnosing: ["user_intervention_required", "auto_retry_pending", "recovery_complete"],
    user_intervention_required: ["manual_recovery", "recovery_complete"],
    auto_retry_pending: ["diagnosing", "recovery_complete"],
    manual_recovery: ["diagnosing", "recovery_complete"],
    recovery_complete: ["none"],
  },
};

/**
 * Determines which actions are available for a given entity state
 * This is a placeholder - actual implementation should be in the UI layer
 */
export function getAvailableActions(entity: WorkflowEntity): readonly ContextualAction[] {
  // Return the actions stored in the entity itself
  return entity.availableActions;
}

/**
 * Validates if a state transition is allowed
 */
export function isTransitionValid(
  entityType: WorkflowEntityType,
  fromState: string,
  toState: string,
): boolean {
  const transitions = StateTransitions[entityType];
  const validNextStates = transitions[fromState] || [];
  return validNextStates.includes(toState);
}

/**
 * Creates a workflow transition record
 */
export function createTransition(
  fromState: string,
  toState: string,
  reason: WorkflowTransitionReason,
  triggeredBy: string | null = null,
  metadata: Record<string, unknown> = {},
): WorkflowTransition {
  return {
    fromState,
    toState,
    reason,
    triggeredBy,
    metadata,
    timestamp: new Date().toISOString() as IsoDateTime,
  };
}
