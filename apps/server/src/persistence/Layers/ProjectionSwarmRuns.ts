import {
  AssistantDeliveryMode,
  ProviderModelOptions,
  ProviderStartOptions,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionSwarmRunInput,
  ProjectionSwarmRun,
  ProjectionSwarmRunRepository,
  type ProjectionSwarmRunRepositoryShape,
} from "../Services/ProjectionSwarmRuns.ts";

const ProjectionSwarmRunDbRowSchema = ProjectionSwarmRun.mapFields(
  Struct.assign({
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderModelOptions)),
    providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
    assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  }),
);

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
          swarm_id,
          status,
          scheduler_mode,
          workspace_mode,
          provider,
          model,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          active_task_execution_id,
          latest_task_execution_id,
          last_error,
          requested_at,
          started_at,
          idled_at,
          paused_at,
          blocked_at,
          failed_at,
          cancelled_at,
          completed_at,
          updated_at
        )
        VALUES (
          ${row.runId},
          ${row.projectId},
          ${row.epicIssueId},
          ${row.swarmId},
          ${row.status},
          ${row.schedulerMode},
          ${row.workspaceMode},
          ${row.provider},
          ${row.model},
          ${row.modelOptions === null ? null : JSON.stringify(row.modelOptions)},
          ${row.providerOptions === null ? null : JSON.stringify(row.providerOptions)},
          ${row.assistantDeliveryMode},
          ${row.runtimeMode},
          ${row.activeTaskExecutionId},
          ${row.latestTaskExecutionId},
          ${row.lastError},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.idledAt},
          ${row.pausedAt},
          ${row.blockedAt},
          ${row.failedAt},
          ${row.cancelledAt},
          ${row.completedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          epic_issue_id = excluded.epic_issue_id,
          swarm_id = excluded.swarm_id,
          status = excluded.status,
          scheduler_mode = excluded.scheduler_mode,
          workspace_mode = excluded.workspace_mode,
          provider = excluded.provider,
          model = excluded.model,
          model_options_json = excluded.model_options_json,
          provider_options_json = excluded.provider_options_json,
          assistant_delivery_mode = excluded.assistant_delivery_mode,
          runtime_mode = excluded.runtime_mode,
          active_task_execution_id = excluded.active_task_execution_id,
          latest_task_execution_id = excluded.latest_task_execution_id,
          last_error = excluded.last_error,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          idled_at = excluded.idled_at,
          paused_at = excluded.paused_at,
          blocked_at = excluded.blocked_at,
          failed_at = excluded.failed_at,
          cancelled_at = excluded.cancelled_at,
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
          swarm_id AS "swarmId",
          status,
          scheduler_mode AS "schedulerMode",
          workspace_mode AS "workspaceMode",
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          active_task_execution_id AS "activeTaskExecutionId",
          latest_task_execution_id AS "latestTaskExecutionId",
          last_error AS "lastError",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          idled_at AS "idledAt",
          paused_at AS "pausedAt",
          blocked_at AS "blockedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
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
          swarm_id AS "swarmId",
          status,
          scheduler_mode AS "schedulerMode",
          workspace_mode AS "workspaceMode",
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          active_task_execution_id AS "activeTaskExecutionId",
          latest_task_execution_id AS "latestTaskExecutionId",
          last_error AS "lastError",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          idled_at AS "idledAt",
          paused_at AS "pausedAt",
          blocked_at AS "blockedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
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
      Effect.mapError(toPersistenceSqlError("ProjectionSwarmRunRepository.getById:query")),
    );

  const listAll: ProjectionSwarmRunRepositoryShape["listAll"] = () =>
    listRows(undefined).pipe(
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
