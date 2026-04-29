import {
  AssistantDeliveryMode,
  OrchestrationEpicRunFailureContext,
  ProviderOptionSelections,
  ProviderStartOptions,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionEpicRunInput,
  ProjectionEpicRun,
  ProjectionEpicRunRepository,
  type ProjectionEpicRunRepositoryShape,
} from "../Services/ProjectionEpicRuns.ts";

const ProjectionEpicRunDbRowSchema = Schema.Struct({
  runId: ProjectionEpicRun.fields.runId,
  projectId: ProjectionEpicRun.fields.projectId,
  epicIssueId: ProjectionEpicRun.fields.epicIssueId,
  status: ProjectionEpicRun.fields.status,
  provider: ProjectionEpicRun.fields.provider,
  model: ProjectionEpicRun.fields.model,
  modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderOptionSelections)),
  providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: ProjectionEpicRun.fields.runtimeMode,
  failureContext: Schema.NullOr(Schema.fromJsonString(OrchestrationEpicRunFailureContext)),
  requestedAt: ProjectionEpicRun.fields.requestedAt,
  startedAt: ProjectionEpicRun.fields.startedAt,
  stopRequestedAt: ProjectionEpicRun.fields.stopRequestedAt,
  stoppedAt: ProjectionEpicRun.fields.stoppedAt,
  failedAt: ProjectionEpicRun.fields.failedAt,
  completedAt: ProjectionEpicRun.fields.completedAt,
  updatedAt: ProjectionEpicRun.fields.updatedAt,
});

type ProjectionEpicRunDbRow = typeof ProjectionEpicRunDbRowSchema.Type;

function toProjectionEpicRun(row: ProjectionEpicRunDbRow): ProjectionEpicRun {
  return {
    runId: row.runId,
    projectId: row.projectId,
    epicIssueId: row.epicIssueId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    modelOptions: row.modelOptions,
    providerOptions: row.providerOptions,
    assistantDeliveryMode: row.assistantDeliveryMode,
    runtimeMode: row.runtimeMode,
    failureContext: row.failureContext,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    stopRequestedAt: row.stopRequestedAt,
    stoppedAt: row.stoppedAt,
    failedAt: row.failedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

const makeProjectionEpicRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionEpicRun,
    execute: (row) =>
      sql`
        INSERT INTO projection_epic_runs (
          run_id,
          project_id,
          epic_issue_id,
          status,
          provider,
          model,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          failure_context_json,
          requested_at,
          started_at,
          stop_requested_at,
          stopped_at,
          failed_at,
          completed_at,
          updated_at
        )
        VALUES (
          ${row.runId},
          ${row.projectId},
          ${row.epicIssueId},
          ${row.status},
          ${row.provider},
          ${row.model},
          ${row.modelOptions === null ? null : JSON.stringify(row.modelOptions)},
          ${row.providerOptions === null ? null : JSON.stringify(row.providerOptions)},
          ${row.assistantDeliveryMode},
          ${row.runtimeMode},
          ${row.failureContext === null ? null : JSON.stringify(row.failureContext)},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.stopRequestedAt},
          ${row.stoppedAt},
          ${row.failedAt},
          ${row.completedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          epic_issue_id = excluded.epic_issue_id,
          status = excluded.status,
          provider = excluded.provider,
          model = excluded.model,
          model_options_json = excluded.model_options_json,
          provider_options_json = excluded.provider_options_json,
          assistant_delivery_mode = excluded.assistant_delivery_mode,
          runtime_mode = excluded.runtime_mode,
          failure_context_json = excluded.failure_context_json,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          stop_requested_at = excluded.stop_requested_at,
          stopped_at = excluded.stopped_at,
          failed_at = excluded.failed_at,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionEpicRunInput,
    Result: ProjectionEpicRunDbRowSchema,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          epic_issue_id AS "epicIssueId",
          status,
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          failure_context_json AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          failed_at AS "failedAt",
          completed_at AS "completedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_runs
        WHERE run_id = ${runId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionEpicRunDbRowSchema,
    execute: () =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          epic_issue_id AS "epicIssueId",
          status,
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          failure_context_json AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          failed_at AS "failedAt",
          completed_at AS "completedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_runs
        ORDER BY requested_at ASC, run_id ASC
      `,
  });

  const upsert: ProjectionEpicRunRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionEpicRunRepository.upsert:query")),
    );

  const getById: ProjectionEpicRunRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.map(Option.map(toProjectionEpicRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionEpicRunRepository.getById:query")),
    );

  const listAll: ProjectionEpicRunRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
      Effect.map((rows) => rows.map(toProjectionEpicRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionEpicRunRepository.listAll:query")),
    );

  return {
    upsert,
    getById,
    listAll,
  } satisfies ProjectionEpicRunRepositoryShape;
});

export const ProjectionEpicRunRepositoryLive = Layer.effect(
  ProjectionEpicRunRepository,
  makeProjectionEpicRunRepository,
);
