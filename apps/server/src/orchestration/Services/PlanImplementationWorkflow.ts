import type {
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationRetryPlanImplementationLaunchInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { PlanImplementationWorkflowError } from "../Errors.ts";

export interface PlanImplementationWorkflowShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
  readonly launchPlanImplementation: (
    input: OrchestrationLaunchPlanImplementationInput,
  ) => Effect.Effect<OrchestrationLaunchPlanImplementationResult, PlanImplementationWorkflowError>;
  readonly cancelPlanImplementationLaunch: (
    input: OrchestrationCancelPlanImplementationLaunchInput,
  ) => Effect.Effect<
    OrchestrationCancelPlanImplementationLaunchResult,
    PlanImplementationWorkflowError
  >;
  readonly retryPlanImplementationLaunch: (
    input: OrchestrationRetryPlanImplementationLaunchInput,
  ) => Effect.Effect<OrchestrationLaunchPlanImplementationResult, PlanImplementationWorkflowError>;
}

export class PlanImplementationWorkflow extends Context.Service<
  PlanImplementationWorkflow,
  PlanImplementationWorkflowShape
>()("t3/orchestration/Services/PlanImplementationWorkflow") {}
