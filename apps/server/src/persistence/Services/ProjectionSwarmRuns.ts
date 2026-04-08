import {
  AssistantDeliveryMode,
  DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
  DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
  IsoDateTime,
  OrchestrationSwarmRunBlockedContext,
  OrchestrationSwarmSchedulerMode,
  OrchestrationSwarmRunStatus,
  OrchestrationSwarmWorkspaceMode,
  ProviderKind,
  ProviderModelOptions,
  ProviderStartOptions,
  ProjectId,
  RuntimeMode,
  SwarmRunId,
  SwarmTaskExecutionId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSwarmRun = Schema.Struct({
  runId: SwarmRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  swarmId: TrimmedNonEmptyString,
  status: OrchestrationSwarmRunStatus,
  schedulerMode: OrchestrationSwarmSchedulerMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE),
  ),
  workspaceMode: OrchestrationSwarmWorkspaceMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE),
  ),
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderModelOptions),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  activeTaskExecutionId: Schema.NullOr(SwarmTaskExecutionId),
  latestTaskExecutionId: Schema.NullOr(SwarmTaskExecutionId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  idledAt: Schema.NullOr(IsoDateTime),
  pausedAt: Schema.NullOr(IsoDateTime),
  blockedAt: Schema.NullOr(IsoDateTime),
  blockedContext: Schema.NullOr(OrchestrationSwarmRunBlockedContext),
  failedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionSwarmRun = typeof ProjectionSwarmRun.Type;

export const GetProjectionSwarmRunInput = Schema.Struct({
  runId: SwarmRunId,
});
export type GetProjectionSwarmRunInput = typeof GetProjectionSwarmRunInput.Type;

export interface ProjectionSwarmRunRepositoryShape {
  readonly upsert: (run: ProjectionSwarmRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionSwarmRunInput,
  ) => Effect.Effect<Option.Option<ProjectionSwarmRun>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionSwarmRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionSwarmRunRepository extends ServiceMap.Service<
  ProjectionSwarmRunRepository,
  ProjectionSwarmRunRepositoryShape
>()("t3/persistence/Services/ProjectionSwarmRuns/ProjectionSwarmRunRepository") {}
