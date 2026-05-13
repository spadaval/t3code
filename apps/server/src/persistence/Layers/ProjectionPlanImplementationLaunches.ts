import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections, ProviderStartOptions } from "@t3tools/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionPlanImplementationLaunchInput,
  GetProjectionPlanImplementationLaunchInput,
  ProjectionPlanImplementationLaunch,
  ProjectionPlanImplementationLaunchRepository,
  type ProjectionPlanImplementationLaunchRepositoryShape,
} from "../Services/ProjectionPlanImplementationLaunches.ts";

const ProjectionPlanImplementationLaunchDbRowSchema = ProjectionPlanImplementationLaunch.mapFields(
  Struct.assign({
    setupEnabled: Schema.Number,
    modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderOptionSelections)),
    providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  }),
);

function fromDbRow(
  row: Schema.Schema.Type<typeof ProjectionPlanImplementationLaunchDbRowSchema>,
): ProjectionPlanImplementationLaunch {
  return {
    ...row,
    setupEnabled: row.setupEnabled === 1,
  };
}

const makeProjectionPlanImplementationLaunchRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionPlanImplementationLaunch,
    execute: (row) =>
      sql`
        INSERT INTO projection_plan_implementation_launches (
          launch_id,
          source_thread_id,
          source_plan_id,
          project_id,
          target_thread_id,
          retry_of_launch_id,
          status,
          launch_mode,
          branch,
          worktree_path,
          failure_reason,
          cleanup_status,
          cleanup_error,
          title,
          setup_enabled,
          prompt_text,
          provider,
          model,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          requested_at,
          prepared_at,
          started_at,
          failed_at,
          cancelled_at,
          updated_at
        )
        VALUES (
          ${row.launchId},
          ${row.sourceThreadId},
          ${row.sourcePlanId},
          ${row.projectId},
          ${row.targetThreadId},
          ${row.retryOfLaunchId},
          ${row.status},
          ${row.launchMode},
          ${row.branch},
          ${row.worktreePath},
          ${row.failureReason},
          ${row.cleanupStatus},
          ${row.cleanupError},
          ${row.title},
          ${row.setupEnabled ? 1 : 0},
          ${row.promptText},
          ${row.provider},
          ${row.model},
          ${row.modelOptions === null ? null : JSON.stringify(row.modelOptions)},
          ${row.providerOptions === null ? null : JSON.stringify(row.providerOptions)},
          ${row.assistantDeliveryMode},
          ${row.runtimeMode},
          ${row.requestedAt},
          ${row.preparedAt},
          ${row.startedAt},
          ${row.failedAt},
          ${row.cancelledAt},
          ${row.updatedAt}
        )
        ON CONFLICT (launch_id)
        DO UPDATE SET
          source_thread_id = excluded.source_thread_id,
          source_plan_id = excluded.source_plan_id,
          project_id = excluded.project_id,
          target_thread_id = excluded.target_thread_id,
          retry_of_launch_id = excluded.retry_of_launch_id,
          status = excluded.status,
          launch_mode = excluded.launch_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          failure_reason = excluded.failure_reason,
          cleanup_status = excluded.cleanup_status,
          cleanup_error = excluded.cleanup_error,
          title = excluded.title,
          setup_enabled = excluded.setup_enabled,
          prompt_text = excluded.prompt_text,
          provider = excluded.provider,
          model = excluded.model,
          model_options_json = excluded.model_options_json,
          provider_options_json = excluded.provider_options_json,
          assistant_delivery_mode = excluded.assistant_delivery_mode,
          runtime_mode = excluded.runtime_mode,
          requested_at = excluded.requested_at,
          prepared_at = excluded.prepared_at,
          started_at = excluded.started_at,
          failed_at = excluded.failed_at,
          cancelled_at = excluded.cancelled_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionPlanImplementationLaunchInput,
    Result: ProjectionPlanImplementationLaunchDbRowSchema,
    execute: ({ launchId }) =>
      sql`
        SELECT
          launch_id AS "launchId",
          source_thread_id AS "sourceThreadId",
          source_plan_id AS "sourcePlanId",
          project_id AS "projectId",
          target_thread_id AS "targetThreadId",
          retry_of_launch_id AS "retryOfLaunchId",
          status,
          launch_mode AS "launchMode",
          branch,
          worktree_path AS "worktreePath",
          failure_reason AS "failureReason",
          cleanup_status AS "cleanupStatus",
          cleanup_error AS "cleanupError",
          title,
          setup_enabled AS "setupEnabled",
          prompt_text AS "promptText",
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          requested_at AS "requestedAt",
          prepared_at AS "preparedAt",
          started_at AS "startedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
          updated_at AS "updatedAt"
        FROM projection_plan_implementation_launches
        WHERE launch_id = ${launchId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPlanImplementationLaunchDbRowSchema,
    execute: () =>
      sql`
        SELECT
          launch_id AS "launchId",
          source_thread_id AS "sourceThreadId",
          source_plan_id AS "sourcePlanId",
          project_id AS "projectId",
          target_thread_id AS "targetThreadId",
          retry_of_launch_id AS "retryOfLaunchId",
          status,
          launch_mode AS "launchMode",
          branch,
          worktree_path AS "worktreePath",
          failure_reason AS "failureReason",
          cleanup_status AS "cleanupStatus",
          cleanup_error AS "cleanupError",
          title,
          setup_enabled AS "setupEnabled",
          prompt_text AS "promptText",
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          requested_at AS "requestedAt",
          prepared_at AS "preparedAt",
          started_at AS "startedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
          updated_at AS "updatedAt"
        FROM projection_plan_implementation_launches
        ORDER BY requested_at ASC, launch_id ASC
      `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeleteProjectionPlanImplementationLaunchInput,
    execute: ({ launchId }) =>
      sql`
        DELETE FROM projection_plan_implementation_launches
        WHERE launch_id = ${launchId}
      `,
  });

  const upsert: ProjectionPlanImplementationLaunchRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPlanImplementationLaunchRepository.upsert:query"),
      ),
    );

  const getById: ProjectionPlanImplementationLaunchRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.map((row) => Option.map(row, fromDbRow)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionPlanImplementationLaunchRepository.getById:query"),
      ),
    );

  const listAll: ProjectionPlanImplementationLaunchRepositoryShape["listAll"] = () =>
    listRows(void 0).pipe(
      Effect.map((rows) => rows.map(fromDbRow)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionPlanImplementationLaunchRepository.listAll:query"),
      ),
    );

  const deleteById: ProjectionPlanImplementationLaunchRepositoryShape["deleteById"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionPlanImplementationLaunchRepository.deleteById:query"),
      ),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionPlanImplementationLaunchRepositoryShape;
});

export const ProjectionPlanImplementationLaunchRepositoryLive = Layer.effect(
  ProjectionPlanImplementationLaunchRepository,
  makeProjectionPlanImplementationLaunchRepository,
);
