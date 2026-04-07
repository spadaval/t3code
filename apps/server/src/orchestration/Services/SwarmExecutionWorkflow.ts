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
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { SwarmExecutionWorkflowError } from "../Errors.ts";

export interface StartSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
  readonly issueId: string;
  readonly workerThreadId?: ThreadId;
  readonly sequenceNumber: number;
}

export interface CompleteSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
}

export interface FailSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
  readonly reason: string;
}

export interface CancelSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
}

export interface SwarmExecutionWorkflowShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly startSwarmRun: (
    input: OrchestrationStartSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly continueSwarmRun: (
    input: OrchestrationContinueSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly pauseSwarmRun: (
    input: OrchestrationPauseSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly resumeSwarmRun: (
    input: OrchestrationResumeSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly cancelSwarmRun: (
    input: OrchestrationCancelSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly startSwarmTaskExecution: (
    input: StartSwarmTaskExecutionInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly completeSwarmTaskExecution: (
    input: CompleteSwarmTaskExecutionInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly failSwarmTaskExecution: (
    input: FailSwarmTaskExecutionInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
  readonly cancelSwarmTaskExecution: (
    input: CancelSwarmTaskExecutionInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmExecutionWorkflowError>;
}

export class SwarmExecutionWorkflow extends ServiceMap.Service<
  SwarmExecutionWorkflow,
  SwarmExecutionWorkflowShape
>()("t3/orchestration/Services/SwarmExecutionWorkflow") {}
