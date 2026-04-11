import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionPendingCheckpointCaptureInput,
  DeleteProjectionPendingCheckpointCapturesByThreadInput,
  ListProjectionPendingCheckpointCapturesInput,
  ProjectionPendingCheckpointCapture,
  ProjectionPendingCheckpointCaptureRepository,
  type ProjectionPendingCheckpointCaptureRepositoryShape,
} from "../Services/ProjectionPendingCheckpointCaptures.ts";

const makeProjectionPendingCheckpointCaptureRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionPendingCheckpointCapture = SqlSchema.void({
    Request: ProjectionPendingCheckpointCapture,
    execute: (row) =>
      sql`
        INSERT INTO projection_pending_checkpoint_captures (
          thread_id,
          turn_id,
          checkpoint_turn_count,
          assistant_message_id,
          requested_at
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.checkpointTurnCount},
          ${row.assistantMessageId},
          ${row.requestedAt}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          assistant_message_id = excluded.assistant_message_id,
          requested_at = excluded.requested_at
      `,
  });

  const listProjectionPendingCheckpointCaptures = SqlSchema.findAll({
    Request: ListProjectionPendingCheckpointCapturesInput,
    Result: ProjectionPendingCheckpointCapture,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          assistant_message_id AS "assistantMessageId",
          requested_at AS "requestedAt"
        FROM projection_pending_checkpoint_captures
        WHERE thread_id = ${threadId}
        ORDER BY checkpoint_turn_count ASC, requested_at ASC, turn_id ASC
      `,
  });

  const deleteProjectionPendingCheckpointCapture = SqlSchema.void({
    Request: DeleteProjectionPendingCheckpointCaptureInput,
    execute: ({ threadId, turnId }) =>
      sql`
        DELETE FROM projection_pending_checkpoint_captures
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
      `,
  });

  const deleteProjectionPendingCheckpointCapturesByThread = SqlSchema.void({
    Request: DeleteProjectionPendingCheckpointCapturesByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_pending_checkpoint_captures
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionPendingCheckpointCaptureRepositoryShape["upsert"] = (row) =>
    upsertProjectionPendingCheckpointCapture(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingCheckpointCaptureRepository.upsert:query"),
      ),
    );

  const listByThreadId: ProjectionPendingCheckpointCaptureRepositoryShape["listByThreadId"] = (
    input,
  ) =>
    listProjectionPendingCheckpointCaptures(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPendingCheckpointCaptureRepository.listByThreadId:query"),
      ),
    );

  const deleteByThreadAndTurnId: ProjectionPendingCheckpointCaptureRepositoryShape["deleteByThreadAndTurnId"] =
    (input) =>
      deleteProjectionPendingCheckpointCapture(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionPendingCheckpointCaptureRepository.deleteByThreadAndTurnId:query",
          ),
        ),
      );

  const deleteByThreadId: ProjectionPendingCheckpointCaptureRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionPendingCheckpointCapturesByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError(
          "ProjectionPendingCheckpointCaptureRepository.deleteByThreadId:query",
        ),
      ),
    );

  return {
    upsert,
    listByThreadId,
    deleteByThreadAndTurnId,
    deleteByThreadId,
  } satisfies ProjectionPendingCheckpointCaptureRepositoryShape;
});

export const ProjectionPendingCheckpointCaptureRepositoryLive = Layer.effect(
  ProjectionPendingCheckpointCaptureRepository,
  makeProjectionPendingCheckpointCaptureRepository,
);
