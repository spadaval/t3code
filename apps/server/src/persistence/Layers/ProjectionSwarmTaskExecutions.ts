import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionSwarmTaskExecutionInput,
  ProjectionSwarmTaskExecution,
  ProjectionSwarmTaskExecutionRepository,
  type ProjectionSwarmTaskExecutionRepositoryShape,
} from "../Services/ProjectionSwarmTaskExecutions.ts";

const makeProjectionSwarmTaskExecutionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionSwarmTaskExecution,
    execute: (row) =>
      sql`
        INSERT INTO projection_swarm_task_executions (
          execution_id,
          run_id,
          issue_id,
          worker_thread_id,
          sequence_number,
          status,
          original_status,
          original_assignee,
          last_error,
          requested_at,
          started_at,
          completed_at,
          failed_at,
          cancelled_at,
          updated_at
        )
        VALUES (
          ${row.executionId},
          ${row.runId},
          ${row.issueId},
          ${row.workerThreadId},
          ${row.sequenceNumber},
          ${row.status},
          ${row.originalStatus},
          ${row.originalAssignee},
          ${row.lastError},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.failedAt},
          ${row.cancelledAt},
          ${row.updatedAt}
        )
        ON CONFLICT (execution_id)
        DO UPDATE SET
          run_id = excluded.run_id,
          issue_id = excluded.issue_id,
          worker_thread_id = excluded.worker_thread_id,
          sequence_number = excluded.sequence_number,
          status = excluded.status,
          original_status = excluded.original_status,
          original_assignee = excluded.original_assignee,
          last_error = excluded.last_error,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          failed_at = excluded.failed_at,
          cancelled_at = excluded.cancelled_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionSwarmTaskExecutionInput,
    Result: ProjectionSwarmTaskExecution,
    execute: ({ executionId }) =>
      sql`
        SELECT
          execution_id AS "executionId",
          run_id AS "runId",
          issue_id AS "issueId",
          worker_thread_id AS "workerThreadId",
          sequence_number AS "sequenceNumber",
          status,
          original_status AS "originalStatus",
          original_assignee AS "originalAssignee",
          last_error AS "lastError",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
          updated_at AS "updatedAt"
        FROM projection_swarm_task_executions
        WHERE execution_id = ${executionId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSwarmTaskExecution,
    execute: () =>
      sql`
        SELECT
          execution_id AS "executionId",
          run_id AS "runId",
          issue_id AS "issueId",
          worker_thread_id AS "workerThreadId",
          sequence_number AS "sequenceNumber",
          status,
          original_status AS "originalStatus",
          original_assignee AS "originalAssignee",
          last_error AS "lastError",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
          updated_at AS "updatedAt"
        FROM projection_swarm_task_executions
        ORDER BY run_id ASC, sequence_number ASC, execution_id ASC
      `,
  });

  const upsert: ProjectionSwarmTaskExecutionRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSwarmTaskExecutionRepository.upsert:query")),
    );

  const getById: ProjectionSwarmTaskExecutionRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSwarmTaskExecutionRepository.getById:query"),
      ),
    );

  const listAll: ProjectionSwarmTaskExecutionRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionSwarmTaskExecutionRepository.listAll:query"),
      ),
    );

  return {
    upsert,
    getById,
    listAll,
  } satisfies ProjectionSwarmTaskExecutionRepositoryShape;
});

export const ProjectionSwarmTaskExecutionRepositoryLive = Layer.effect(
  ProjectionSwarmTaskExecutionRepository,
  makeProjectionSwarmTaskExecutionRepository,
);
