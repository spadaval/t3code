/**
 * ProjectionPendingCheckpointCaptureRepository - Repository interface for
 * pending checkpoint capture requests.
 *
 * Owns persistence operations for durable checkpoint-capture work that has
 * been requested but not yet settled into finalized checkpoint metadata.
 *
 * @module ProjectionPendingCheckpointCaptureRepository
 */
import { IsoDateTime, MessageId, NonNegativeInt, ThreadId, TurnId } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionPendingCheckpointCapture = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  assistantMessageId: Schema.NullOr(MessageId),
  requestedAt: IsoDateTime,
});
export type ProjectionPendingCheckpointCapture = typeof ProjectionPendingCheckpointCapture.Type;

export const ListProjectionPendingCheckpointCapturesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionPendingCheckpointCapturesInput =
  typeof ListProjectionPendingCheckpointCapturesInput.Type;

export const DeleteProjectionPendingCheckpointCaptureInput = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
});
export type DeleteProjectionPendingCheckpointCaptureInput =
  typeof DeleteProjectionPendingCheckpointCaptureInput.Type;

export const DeleteProjectionPendingCheckpointCapturesByThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionPendingCheckpointCapturesByThreadInput =
  typeof DeleteProjectionPendingCheckpointCapturesByThreadInput.Type;

export interface ProjectionPendingCheckpointCaptureRepositoryShape {
  readonly upsert: (
    row: ProjectionPendingCheckpointCapture,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByThreadId: (
    input: ListProjectionPendingCheckpointCapturesInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionPendingCheckpointCapture>, ProjectionRepositoryError>;

  readonly deleteByThreadAndTurnId: (
    input: DeleteProjectionPendingCheckpointCaptureInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly deleteByThreadId: (
    input: DeleteProjectionPendingCheckpointCapturesByThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionPendingCheckpointCaptureRepository extends ServiceMap.Service<
  ProjectionPendingCheckpointCaptureRepository,
  ProjectionPendingCheckpointCaptureRepositoryShape
>()(
  "t3/persistence/Services/ProjectionPendingCheckpointCaptures/ProjectionPendingCheckpointCaptureRepository",
) {}
