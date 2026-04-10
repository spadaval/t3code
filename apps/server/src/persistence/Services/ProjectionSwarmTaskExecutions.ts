import {
  DEFAULT_ORCHESTRATION_EPIC_WORKSPACE_KEY,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationEpicRunFailureContext,
  OrchestrationEpicIssueExecutionStatus,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSwarmTaskExecution = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.NullOr(ThreadId),
  sequenceNumber: NonNegativeInt,
  status: OrchestrationEpicIssueExecutionStatus,
  workspaceKey: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_EPIC_WORKSPACE_KEY),
  ),
  workspacePath: Schema.NullOr(TrimmedNonEmptyString),
  failureContext: Schema.NullOr(OrchestrationEpicRunFailureContext),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  stopRequestedAt: Schema.NullOr(IsoDateTime),
  stoppedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionSwarmTaskExecution = typeof ProjectionSwarmTaskExecution.Type;

export const GetProjectionSwarmTaskExecutionInput = Schema.Struct({
  executionId: EpicIssueExecutionId,
});
export type GetProjectionSwarmTaskExecutionInput = typeof GetProjectionSwarmTaskExecutionInput.Type;

export interface ProjectionSwarmTaskExecutionRepositoryShape {
  readonly upsert: (
    execution: ProjectionSwarmTaskExecution,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionSwarmTaskExecutionInput,
  ) => Effect.Effect<Option.Option<ProjectionSwarmTaskExecution>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionSwarmTaskExecution>,
    ProjectionRepositoryError
  >;
}

export class ProjectionSwarmTaskExecutionRepository extends ServiceMap.Service<
  ProjectionSwarmTaskExecutionRepository,
  ProjectionSwarmTaskExecutionRepositoryShape
>()(
  "t3/persistence/Services/ProjectionSwarmTaskExecutions/ProjectionSwarmTaskExecutionRepository",
) {}
