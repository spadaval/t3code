import {
  AssistantDeliveryMode,
  IsoDateTime,
  OrchestrationProposedPlanId,
  OrchestrationPlanImplementationLaunchCleanupStatus,
  OrchestrationPlanImplementationLaunchStatus,
  PlanImplementationLaunchId,
  ProviderKind,
  ProviderModelOptions,
  ProviderStartOptions,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionPlanImplementationLaunch = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  sourceThreadId: ThreadId,
  sourcePlanId: OrchestrationProposedPlanId,
  projectId: ProjectId,
  targetThreadId: ThreadId,
  retryOfLaunchId: Schema.NullOr(PlanImplementationLaunchId),
  status: OrchestrationPlanImplementationLaunchStatus,
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
  modelOptions: Schema.NullOr(ProviderModelOptions),
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

export class ProjectionPlanImplementationLaunchRepository extends ServiceMap.Service<
  ProjectionPlanImplementationLaunchRepository,
  ProjectionPlanImplementationLaunchRepositoryShape
>()(
  "t3/persistence/Services/ProjectionPlanImplementationLaunches/ProjectionPlanImplementationLaunchRepository",
) {}
