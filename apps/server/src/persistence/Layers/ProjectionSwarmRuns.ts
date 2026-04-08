import {
  AssistantDeliveryMode,
  OrchestrationSwarmRunBlockedKind,
  ProviderModelOptions,
  ProviderStartOptions,
  SwarmTaskExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
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
  swarmId: ProjectionSwarmRun.fields.swarmId,
  status: ProjectionSwarmRun.fields.status,
  schedulerMode: ProjectionSwarmRun.fields.schedulerMode,
  workspaceMode: ProjectionSwarmRun.fields.workspaceMode,
  provider: ProjectionSwarmRun.fields.provider,
  model: ProjectionSwarmRun.fields.model,
  modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderModelOptions)),
  providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: ProjectionSwarmRun.fields.runtimeMode,
  activeTaskExecutionId: ProjectionSwarmRun.fields.activeTaskExecutionId,
  latestTaskExecutionId: ProjectionSwarmRun.fields.latestTaskExecutionId,
  lastError: ProjectionSwarmRun.fields.lastError,
  requestedAt: ProjectionSwarmRun.fields.requestedAt,
  startedAt: ProjectionSwarmRun.fields.startedAt,
  idledAt: ProjectionSwarmRun.fields.idledAt,
  pausedAt: ProjectionSwarmRun.fields.pausedAt,
  blockedAt: ProjectionSwarmRun.fields.blockedAt,
  blockedKind: Schema.NullOr(OrchestrationSwarmRunBlockedKind),
  blockedExecutionId: Schema.NullOr(SwarmTaskExecutionId),
  blockedIssueId: Schema.NullOr(TrimmedNonEmptyString),
  blockedWorkerThreadId: Schema.NullOr(ThreadId),
  failedAt: ProjectionSwarmRun.fields.failedAt,
  cancelledAt: ProjectionSwarmRun.fields.cancelledAt,
  completedAt: ProjectionSwarmRun.fields.completedAt,
  updatedAt: ProjectionSwarmRun.fields.updatedAt,
});

type ProjectionSwarmRunDbRow = typeof ProjectionSwarmRunDbRowSchema.Type;

function toBlockedContext(row: ProjectionSwarmRunDbRow): ProjectionSwarmRun["blockedContext"] {
  if (row.blockedKind === null) {
    return null;
  }

  return {
    kind: row.blockedKind,
    issueId: row.blockedIssueId,
    executionId: row.blockedExecutionId,
    workerThreadId: row.blockedWorkerThreadId,
  };
}

function toProjectionSwarmRun(row: ProjectionSwarmRunDbRow): ProjectionSwarmRun {
  return {
    runId: row.runId,
    projectId: row.projectId,
    epicIssueId: row.epicIssueId,
    swarmId: row.swarmId,
    status: row.status,
    schedulerMode: row.schedulerMode,
    workspaceMode: row.workspaceMode,
    provider: row.provider,
    model: row.model,
    modelOptions: row.modelOptions,
    providerOptions: row.providerOptions,
    assistantDeliveryMode: row.assistantDeliveryMode,
    runtimeMode: row.runtimeMode,
    activeTaskExecutionId: row.activeTaskExecutionId,
    latestTaskExecutionId: row.latestTaskExecutionId,
    lastError: row.lastError,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    idledAt: row.idledAt,
    pausedAt: row.pausedAt,
    blockedAt: row.blockedAt,
    blockedContext: toBlockedContext(row),
    failedAt: row.failedAt,
    cancelledAt: row.cancelledAt,
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
          blocked_kind,
          blocked_execution_id,
          blocked_issue_id,
          blocked_worker_thread_id,
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
          ${row.blockedContext?.kind ?? null},
          ${row.blockedContext?.executionId ?? null},
          ${row.blockedContext?.issueId ?? null},
          ${row.blockedContext?.workerThreadId ?? null},
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
          blocked_kind = excluded.blocked_kind,
          blocked_execution_id = excluded.blocked_execution_id,
          blocked_issue_id = excluded.blocked_issue_id,
          blocked_worker_thread_id = excluded.blocked_worker_thread_id,
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
          blocked_kind AS "blockedKind",
          blocked_execution_id AS "blockedExecutionId",
          blocked_issue_id AS "blockedIssueId",
          blocked_worker_thread_id AS "blockedWorkerThreadId",
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
          blocked_kind AS "blockedKind",
          blocked_execution_id AS "blockedExecutionId",
          blocked_issue_id AS "blockedIssueId",
          blocked_worker_thread_id AS "blockedWorkerThreadId",
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
