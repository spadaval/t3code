import type {
  OrchestrationStopEpicRunInput,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRunControlResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

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
