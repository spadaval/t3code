import type {
  OrchestrationStopEpicRunInput,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRunControlResult,
  ThreadId,
} from "@t3tools/contracts";
import { Context } from "effect";
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
  readonly notifyWorkerStateChanged: (threadId: ThreadId) => Effect.Effect<void>;
}

export class EpicRunScheduler extends Context.Service<EpicRunScheduler, EpicRunSchedulerShape>()(
  "t3/orchestration/Services/EpicRunScheduler",
) {}
