import type {
  OrchestrationStopEpicRunInput,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRunControlResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { SwarmSchedulerError } from "../Errors.ts";

export interface SwarmSchedulerShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly startEpicRun: (
    input: OrchestrationStartEpicRunInput,
  ) => Effect.Effect<OrchestrationEpicRunControlResult, SwarmSchedulerError>;
  readonly stopEpicRun: (
    input: OrchestrationStopEpicRunInput,
  ) => Effect.Effect<OrchestrationEpicRunControlResult, SwarmSchedulerError>;
}

export class SwarmScheduler extends ServiceMap.Service<SwarmScheduler, SwarmSchedulerShape>()(
  "t3/orchestration/Services/SwarmScheduler",
) {}
