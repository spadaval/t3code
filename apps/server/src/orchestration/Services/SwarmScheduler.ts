import type {
  OrchestrationCancelSwarmRunInput,
  OrchestrationPauseSwarmRunInput,
  OrchestrationResumePausedSwarmRunInput,
  OrchestrationRetrySwarmTaskExecutionInput,
  OrchestrationRunNextSwarmTaskInput,
  OrchestrationStartSwarmRunInput,
  OrchestrationSwarmRunControlResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { SwarmSchedulerError } from "../Errors.ts";

export interface SwarmSchedulerShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly startSwarmRun: (
    input: OrchestrationStartSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
  readonly pauseSwarmRun: (
    input: OrchestrationPauseSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
  readonly resumePausedSwarmRun: (
    input: OrchestrationResumePausedSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
  readonly runNextSwarmTask: (
    input: OrchestrationRunNextSwarmTaskInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
  readonly retrySwarmTaskExecution: (
    input: OrchestrationRetrySwarmTaskExecutionInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
  readonly cancelSwarmRun: (
    input: OrchestrationCancelSwarmRunInput,
  ) => Effect.Effect<OrchestrationSwarmRunControlResult, SwarmSchedulerError>;
}

export class SwarmScheduler extends ServiceMap.Service<SwarmScheduler, SwarmSchedulerShape>()(
  "t3/orchestration/Services/SwarmScheduler",
) {}
