import {
  AssistantDeliveryMode,
  DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE,
  IsoDateTime,
  OrchestrationPlanImplementationLaunchMode,
  OrchestrationProposedPlanId,
  OrchestrationPlanImplementationLaunchCleanupStatus,
  OrchestrationPlanImplementationLaunchStatus,
  PlanImplementationLaunchId,
  ProviderOptionSelections,
  ProviderKind,
  ProviderStartOptions,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionPlanImplementationLaunch = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  sourceThreadId: ThreadId,
  sourcePlanId: OrchestrationProposedPlanId,
  projectId: ProjectId,
  targetThreadId: ThreadId,
  retryOfLaunchId: Schema.NullOr(PlanImplementationLaunchId),
  status: OrchestrationPlanImplementationLaunchStatus,
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
    ),
  ),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.NullOr(Schema.String),
  title: Schema.String,
  setupEnabled: Schema.Boolean,
  promptText: Schema.String,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(Schema.String),
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  requestedAt: IsoDateTime,
  preparedAt: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionPlanImplementationLaunch = typeof ProjectionPlanImplementationLaunch.Type;

export const GetProjectionPlanImplementationLaunchInput = Schema.Struct({
  launchId: PlanImplementationLaunchId,
});
export type GetProjectionPlanImplementationLaunchInput =
  typeof GetProjectionPlanImplementationLaunchInput.Type;

export const DeleteProjectionPlanImplementationLaunchInput = Schema.Struct({
  launchId: PlanImplementationLaunchId,
});
export type DeleteProjectionPlanImplementationLaunchInput =
  typeof DeleteProjectionPlanImplementationLaunchInput.Type;

export interface ProjectionPlanImplementationLaunchRepositoryShape {
  readonly upsert: (
    launch: ProjectionPlanImplementationLaunch,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionPlanImplementationLaunchInput,
  ) => Effect.Effect<Option.Option<ProjectionPlanImplementationLaunch>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionPlanImplementationLaunch>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeleteProjectionPlanImplementationLaunchInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionPlanImplementationLaunchRepository extends Context.Service<
  ProjectionPlanImplementationLaunchRepository,
  ProjectionPlanImplementationLaunchRepositoryShape
>()(
  "t3/persistence/Services/ProjectionPlanImplementationLaunches/ProjectionPlanImplementationLaunchRepository",
) {}
