import {
  AssistantDeliveryMode,
  OrchestrationEpicRunFailureContext,
  ProviderModelOptions,
  ProviderStartOptions,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionSwarmRunInput,
  ProjectionSwarmRun,
  ProjectionSwarmRunRepository,
  type ProjectionSwarmRunRepositoryShape,
} from "../Services/ProjectionSwarmRuns.ts";

const ProjectionSwarmRunDbRowSchema = Schema.Struct({
  runId: ProjectionSwarmRun.fields.runId,
  projectId: ProjectionSwarmRun.fields.projectId,
  epicIssueId: ProjectionSwarmRun.fields.epicIssueId,
  status: ProjectionSwarmRun.fields.status,
  provider: ProjectionSwarmRun.fields.provider,
  model: ProjectionSwarmRun.fields.model,
  modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderModelOptions)),
  providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: ProjectionSwarmRun.fields.runtimeMode,
  failureContext: Schema.NullOr(Schema.fromJsonString(OrchestrationEpicRunFailureContext)),
  requestedAt: ProjectionSwarmRun.fields.requestedAt,
  startedAt: ProjectionSwarmRun.fields.startedAt,
  stopRequestedAt: ProjectionSwarmRun.fields.stopRequestedAt,
  stoppedAt: ProjectionSwarmRun.fields.stoppedAt,
  failedAt: ProjectionSwarmRun.fields.failedAt,
  completedAt: ProjectionSwarmRun.fields.completedAt,
  updatedAt: ProjectionSwarmRun.fields.updatedAt,
});

type ProjectionSwarmRunDbRow = typeof ProjectionSwarmRunDbRowSchema.Type;

function toProjectionSwarmRun(row: ProjectionSwarmRunDbRow): ProjectionSwarmRun {
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

const makeProjectionSwarmRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionSwarmRun,
    execute: (row) =>
      sql`
        INSERT INTO projection_swarm_runs (
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
    Request: GetProjectionSwarmRunInput,
    Result: ProjectionSwarmRunDbRowSchema,
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
        FROM projection_swarm_runs
        WHERE run_id = ${runId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionSwarmRunDbRowSchema,
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
        FROM projection_swarm_runs
        ORDER BY requested_at ASC, run_id ASC
      `,
  });

  const upsert: ProjectionSwarmRunRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSwarmRunRepository.upsert:query")),
    );

  const getById: ProjectionSwarmRunRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.map(Option.map(toProjectionSwarmRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionSwarmRunRepository.getById:query")),
    );

  const listAll: ProjectionSwarmRunRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
      Effect.map((rows) => rows.map(toProjectionSwarmRun)),
      Effect.mapError(toPersistenceSqlError("ProjectionSwarmRunRepository.listAll:query")),
    );

  return {
    upsert,
    getById,
    listAll,
  } satisfies ProjectionSwarmRunRepositoryShape;
});

export const ProjectionSwarmRunRepositoryLive = Layer.effect(
  ProjectionSwarmRunRepository,
  makeProjectionSwarmRunRepository,
);
