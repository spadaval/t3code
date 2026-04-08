import type {
  OrchestrationCancelSwarmRunInput,
  OrchestrationContinueSwarmRunInput,
  OrchestrationPauseSwarmRunInput,
  OrchestrationResumeSwarmRunInput,
  OrchestrationStartSwarmRunInput,
  OrchestrationSwarmRunControlResult,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import type {
  WorkflowEntity,
  SwarmState,
  TaskState,
  InterventionRequest,
} from "@t3tools/contracts/workflowState";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

/**
 * Simplified SwarmWorkflow that focuses on explicit state management
 * and manual intervention rather than complex auto-recovery.
 *
 * Key principles:
 * 1. Explicit state transitions with clear reasons
 * 2. Manual intervention points when automation fails
 * 3. No complex reconciliation - simple state machine
 * 4. Clear error states that users can act on
 */

export interface SwarmTaskInput {
  readonly issueId: string;
  readonly prompt: string;
  readonly priority: number;
  readonly dependencies: readonly string[];
}

export interface ManualInterventionInput {
  readonly runId: SwarmRunId;
  readonly interventionType: "task_failed" | "thread_lost" | "validation_failed" | "user_requested";
  readonly context: Record<string, unknown>;
  readonly suggestedActions: readonly string[];
  readonly timeoutMs?: number;
}

export interface InterventionResponse {
  readonly action: "retry" | "skip" | "modify" | "cancel" | "manual_fix";
  readonly parameters?: Record<string, unknown>;
  readonly reason?: string;
}

export interface SimplifiedSwarmWorkflowShape {
  // Core workflow control
  readonly startSwarm: (
    input: OrchestrationStartSwarmRunInput,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly pauseSwarm: (
    input: OrchestrationPauseSwarmRunInput,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly resumeSwarm: (
    input: OrchestrationResumeSwarmRunInput,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly cancelSwarm: (
    input: OrchestrationCancelSwarmRunInput,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  // Task execution control
  readonly executeNextTask: (
    runId: SwarmRunId,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly markTaskCompleted: (
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly markTaskFailed: (
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
    reason: string,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  // Manual intervention system
  readonly requestIntervention: (
    input: ManualInterventionInput,
  ) => Effect.Effect<InterventionRequest, SimplifiedSwarmWorkflowError>;

  readonly respondToIntervention: (
    interventionId: string,
    response: InterventionResponse,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly getActiveInterventions: (
    runId?: SwarmRunId,
  ) => Effect.Effect<readonly InterventionRequest[], SimplifiedSwarmWorkflowError>;

  // State inspection (no automatic changes)
  readonly getSwarmState: (
    runId: SwarmRunId,
  ) => Effect.Effect<WorkflowEntity, SimplifiedSwarmWorkflowError>;

  readonly getExecutionHistory: (
    runId: SwarmRunId,
  ) => Effect.Effect<
    readonly { timestamp: string; event: string; context: Record<string, unknown> }[],
    SimplifiedSwarmWorkflowError
  >;
}

export class SimplifiedSwarmWorkflowError {
  readonly _tag = "SimplifiedSwarmWorkflowError";

  constructor(
    public readonly operation: string,
    public readonly reason: string,
    public readonly canRetry: boolean = false,
    public readonly suggestedActions: readonly string[] = [],
    public readonly cause?: unknown,
  ) {}
}

export class SimplifiedSwarmWorkflow extends ServiceMap.Service<
  SimplifiedSwarmWorkflow,
  SimplifiedSwarmWorkflowShape
>()("t3/orchestration/Services/SimplifiedSwarmWorkflow") {}
