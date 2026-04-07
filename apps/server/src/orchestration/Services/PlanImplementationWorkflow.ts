import type {
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationRetryPlanImplementationLaunchInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

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

export class PlanImplementationWorkflow extends ServiceMap.Service<
  PlanImplementationWorkflow,
  PlanImplementationWorkflowShape
>()("t3/orchestration/Services/PlanImplementationWorkflow") {}
