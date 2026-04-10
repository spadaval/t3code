import type {
  OrchestrationStopEpicRunInput,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRunControlResult,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { EpicRunSchedulerError } from "../Errors.ts";

export interface EpicRunSchedulerShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly startEpicRun: (
    input: OrchestrationStartEpicRunInput,
  ) => Effect.Effect<OrchestrationEpicRunControlResult, EpicRunSchedulerError>;
  readonly stopEpicRun: (
    input: OrchestrationStopEpicRunInput,
  ) => Effect.Effect<OrchestrationEpicRunControlResult, EpicRunSchedulerError>;
}

export class EpicRunScheduler extends ServiceMap.Service<EpicRunScheduler, EpicRunSchedulerShape>()(
  "t3/orchestration/Services/EpicRunScheduler",
) {}
