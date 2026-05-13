import { OrchestrationEpicRunFailureContext } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionEpicIssueExecutionInput,
  ProjectionEpicIssueExecution,
  ProjectionEpicIssueExecutionRepository,
  type ProjectionEpicIssueExecutionRepositoryShape,
} from "../Services/ProjectionEpicIssueExecutions.ts";

const ProjectionEpicIssueExecutionDbRow = Schema.Struct({
  ...ProjectionEpicIssueExecution.fields,
  failureContext: Schema.NullOr(Schema.fromJsonString(OrchestrationEpicRunFailureContext)),
});

function toProjectionEpicIssueExecution(
  row: typeof ProjectionEpicIssueExecutionDbRow.Type,
): ProjectionEpicIssueExecution {
  return {
    ...row,
    failureContext: row.failureContext,
  };
}

const makeProjectionEpicIssueExecutionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionEpicIssueExecution,
    execute: (row) =>
      sql`
        INSERT INTO projection_epic_issue_executions (
          execution_id,
          run_id,
          issue_id,
          worker_thread_id,
          sequence_number,
          status,
          workspace_key,
          workspace_path,
          failure_kind,
          failure_message,
          failure_issue_id,
          failure_execution_id,
          failure_worker_thread_id,
          requested_at,
          started_at,
          stop_requested_at,
          stopped_at,
          completed_at,
          failed_at,
          updated_at
        )
        VALUES (
          ${row.executionId},
          ${row.runId},
          ${row.issueId},
          ${row.workerThreadId},
          ${row.sequenceNumber},
          ${row.status},
          ${row.workspaceKey},
          ${row.workspacePath},
          ${row.failureContext?.kind ?? null},
          ${row.failureContext?.message ?? null},
          ${row.failureContext?.issueId ?? null},
          ${row.failureContext?.executionId ?? null},
          ${row.failureContext?.workerThreadId ?? null},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.stopRequestedAt},
          ${row.stoppedAt},
          ${row.completedAt},
          ${row.failedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (execution_id)
        DO UPDATE SET
          run_id = excluded.run_id,
          issue_id = excluded.issue_id,
          worker_thread_id = excluded.worker_thread_id,
          sequence_number = excluded.sequence_number,
          status = excluded.status,
          workspace_key = excluded.workspace_key,
          workspace_path = excluded.workspace_path,
          failure_kind = excluded.failure_kind,
          failure_message = excluded.failure_message,
          failure_issue_id = excluded.failure_issue_id,
          failure_execution_id = excluded.failure_execution_id,
          failure_worker_thread_id = excluded.failure_worker_thread_id,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          stop_requested_at = excluded.stop_requested_at,
          stopped_at = excluded.stopped_at,
          completed_at = excluded.completed_at,
          failed_at = excluded.failed_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionEpicIssueExecutionInput,
    Result: ProjectionEpicIssueExecutionDbRow,
    execute: ({ executionId }) =>
      sql`
        SELECT
          execution_id AS "executionId",
          run_id AS "runId",
          issue_id AS "issueId",
          worker_thread_id AS "workerThreadId",
          sequence_number AS "sequenceNumber",
          status,
          workspace_key AS "workspaceKey",
          workspace_path AS "workspacePath",
          CASE
            WHEN failure_kind IS NULL OR failure_message IS NULL THEN NULL
            ELSE json_object(
              'kind', failure_kind,
              'message', failure_message,
              'issueId', failure_issue_id,
              'executionId', failure_execution_id,
              'workerThreadId', failure_worker_thread_id
            )
          END AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          completed_at AS "completedAt",
          failed_at AS "failedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_issue_executions
        WHERE execution_id = ${executionId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionEpicIssueExecutionDbRow,
    execute: () =>
      sql`
        SELECT
          execution_id AS "executionId",
          run_id AS "runId",
          issue_id AS "issueId",
          worker_thread_id AS "workerThreadId",
          sequence_number AS "sequenceNumber",
          status,
          workspace_key AS "workspaceKey",
          workspace_path AS "workspacePath",
          CASE
            WHEN failure_kind IS NULL OR failure_message IS NULL THEN NULL
            ELSE json_object(
              'kind', failure_kind,
              'message', failure_message,
              'issueId', failure_issue_id,
              'executionId', failure_execution_id,
              'workerThreadId', failure_worker_thread_id
            )
          END AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          completed_at AS "completedAt",
          failed_at AS "failedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_issue_executions
        ORDER BY run_id ASC, sequence_number ASC, execution_id ASC
      `,
  });

  const upsert: ProjectionEpicIssueExecutionRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionEpicIssueExecutionRepository.upsert:query")),
    );

  const getById: ProjectionEpicIssueExecutionRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.map((row) => row.pipe(Option.map(toProjectionEpicIssueExecution))),
      Effect.mapError(
        toPersistenceSqlError("ProjectionEpicIssueExecutionRepository.getById:query"),
      ),
    );

  const listAll: ProjectionEpicIssueExecutionRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
      Effect.map((rows) => rows.map(toProjectionEpicIssueExecution)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionEpicIssueExecutionRepository.listAll:query"),
      ),
    );

  return {
    upsert,
    getById,
    listAll,
  } satisfies ProjectionEpicIssueExecutionRepositoryShape;
});

export const ProjectionEpicIssueExecutionRepositoryLive = Layer.effect(
  ProjectionEpicIssueExecutionRepository,
  makeProjectionEpicIssueExecutionRepository,
);
