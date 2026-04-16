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
import { Context, Effect, Option, Schema } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionEpicIssueExecution = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.NullOr(ThreadId),
  sequenceNumber: NonNegativeInt,
  status: OrchestrationEpicIssueExecutionStatus,
  workspaceKey: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ORCHESTRATION_EPIC_WORKSPACE_KEY)),
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
export type ProjectionEpicIssueExecution = typeof ProjectionEpicIssueExecution.Type;

export const GetProjectionEpicIssueExecutionInput = Schema.Struct({
  executionId: EpicIssueExecutionId,
});
export type GetProjectionEpicIssueExecutionInput = typeof GetProjectionEpicIssueExecutionInput.Type;

export interface ProjectionEpicIssueExecutionRepositoryShape {
  readonly upsert: (
    execution: ProjectionEpicIssueExecution,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionEpicIssueExecutionInput,
  ) => Effect.Effect<Option.Option<ProjectionEpicIssueExecution>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionEpicIssueExecution>,
    ProjectionRepositoryError
  >;
}

export class ProjectionEpicIssueExecutionRepository extends Context.Service<
  ProjectionEpicIssueExecutionRepository,
  ProjectionEpicIssueExecutionRepositoryShape
>()(
  "t3/persistence/Services/ProjectionEpicIssueExecutions/ProjectionEpicIssueExecutionRepository",
) {}
