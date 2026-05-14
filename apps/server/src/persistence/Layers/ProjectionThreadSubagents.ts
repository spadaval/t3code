import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionThreadSubagentEntry,
  ProjectionThreadSubagentEntryRepository,
  type ProjectionThreadSubagentEntryRepositoryShape,
  ProjectionThreadSubagentRun,
  ProjectionThreadSubagentRunRepository,
  type ProjectionThreadSubagentRunRepositoryShape,
  ThreadSubagentRunIdInput,
  ThreadSubagentThreadIdInput,
} from "../Services/ProjectionThreadSubagents.ts";

const ProjectionThreadSubagentRunDbRowSchema = ProjectionThreadSubagentRun.mapFields(
  Struct.assign({
    config: Schema.fromJsonString(Schema.Unknown),
  }),
);

const ProjectionThreadSubagentEntryDbRowSchema = ProjectionThreadSubagentEntry.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
  }),
);

const makeProjectionThreadSubagentRunRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRunRow = SqlSchema.void({
    Request: ProjectionThreadSubagentRun,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_subagent_runs (
          run_id,
          thread_id,
          turn_id,
          parent_item_id,
          provider,
          provider_instance_id,
          provider_run_id,
          title,
          description,
          prompt,
          agent_type,
          model,
          reasoning_effort,
          config_json,
          status,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (
          ${row.runId},
          ${row.threadId},
          ${row.turnId},
          ${row.parentItemId},
          ${row.provider},
          ${row.providerInstanceId},
          ${row.providerRunId},
          ${row.title},
          ${row.description},
          ${row.prompt},
          ${row.agentType},
          ${row.model},
          ${row.reasoningEffort},
          ${JSON.stringify(row.config)},
          ${row.status},
          ${row.startedAt},
          ${row.completedAt},
          ${row.updatedAt}
        )
        ON CONFLICT (run_id)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          turn_id = excluded.turn_id,
          parent_item_id = excluded.parent_item_id,
          provider = excluded.provider,
          provider_instance_id = excluded.provider_instance_id,
          provider_run_id = excluded.provider_run_id,
          title = excluded.title,
          description = excluded.description,
          prompt = excluded.prompt,
          agent_type = excluded.agent_type,
          model = excluded.model,
          reasoning_effort = excluded.reasoning_effort,
          config_json = excluded.config_json,
          status = excluded.status,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `,
  });

  const getRunRow = SqlSchema.findOneOption({
    Request: ThreadSubagentRunIdInput,
    Result: ProjectionThreadSubagentRunDbRowSchema,
    execute: ({ runId }) =>
      sql`
        SELECT
          run_id AS "runId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          parent_item_id AS "parentItemId",
          provider,
          provider_instance_id AS "providerInstanceId",
          provider_run_id AS "providerRunId",
          title,
          description,
          prompt,
          agent_type AS "agentType",
          model,
          reasoning_effort AS "reasoningEffort",
          config_json AS "config",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          updated_at AS "updatedAt"
        FROM projection_thread_subagent_runs
        WHERE run_id = ${runId}
        LIMIT 1
      `,
  });

  const listRunRows = SqlSchema.findAll({
    Request: ThreadSubagentThreadIdInput,
    Result: ProjectionThreadSubagentRunDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          run_id AS "runId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          parent_item_id AS "parentItemId",
          provider,
          provider_instance_id AS "providerInstanceId",
          provider_run_id AS "providerRunId",
          title,
          description,
          prompt,
          agent_type AS "agentType",
          model,
          reasoning_effort AS "reasoningEffort",
          config_json AS "config",
          status,
          started_at AS "startedAt",
          completed_at AS "completedAt",
          updated_at AS "updatedAt"
        FROM projection_thread_subagent_runs
        WHERE thread_id = ${threadId}
        ORDER BY started_at ASC, run_id ASC
      `,
  });

  const deleteRunRows = SqlSchema.void({
    Request: ThreadSubagentThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_subagent_runs
        WHERE thread_id = ${threadId}
      `,
  });

  return {
    upsert: (row) =>
      upsertRunRow(row).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentRunRepository.upsert:query"),
        ),
      ),
    getByRunId: (input) =>
      getRunRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentRunRepository.getByRunId:query"),
        ),
        Effect.map(Option.map((row) => row)),
      ),
    listByThreadId: (input) =>
      listRunRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentRunRepository.listByThreadId:query"),
        ),
      ),
    deleteByThreadId: (input) =>
      deleteRunRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentRunRepository.deleteByThreadId:query"),
        ),
      ),
  } satisfies ProjectionThreadSubagentRunRepositoryShape;
});

const makeProjectionThreadSubagentEntryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertEntryRow = SqlSchema.void({
    Request: ProjectionThreadSubagentEntry,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_subagent_entries (
          entry_id,
          run_id,
          kind,
          title,
          text,
          payload_json,
          created_at
        )
        VALUES (
          ${row.entryId},
          ${row.runId},
          ${row.kind},
          ${row.title},
          ${row.text},
          ${JSON.stringify(row.payload)},
          ${row.createdAt}
        )
        ON CONFLICT (entry_id)
        DO UPDATE SET
          run_id = excluded.run_id,
          kind = excluded.kind,
          title = excluded.title,
          text = excluded.text,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at
      `,
  });

  const listEntryRows = SqlSchema.findAll({
    Request: ThreadSubagentRunIdInput,
    Result: ProjectionThreadSubagentEntryDbRowSchema,
    execute: ({ runId }) =>
      sql`
        SELECT
          entry_id AS "entryId",
          run_id AS "runId",
          kind,
          title,
          text,
          payload_json AS "payload",
          created_at AS "createdAt"
        FROM projection_thread_subagent_entries
        WHERE run_id = ${runId}
        ORDER BY created_at ASC, entry_id ASC
      `,
  });

  const deleteEntryRowsByRun = SqlSchema.void({
    Request: ThreadSubagentRunIdInput,
    execute: ({ runId }) =>
      sql`
        DELETE FROM projection_thread_subagent_entries
        WHERE run_id = ${runId}
      `,
  });

  const deleteEntryRowsByThread = SqlSchema.void({
    Request: ThreadSubagentThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_subagent_entries
        WHERE run_id IN (
          SELECT run_id
          FROM projection_thread_subagent_runs
          WHERE thread_id = ${threadId}
        )
      `,
  });

  return {
    upsert: (row) =>
      upsertEntryRow(row).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentEntryRepository.upsert:query"),
        ),
      ),
    listByRunId: (input) =>
      listEntryRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentEntryRepository.listByRunId:query"),
        ),
      ),
    deleteByRunId: (input) =>
      deleteEntryRowsByRun(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentEntryRepository.deleteByRunId:query"),
        ),
      ),
    deleteByThreadId: (input) =>
      deleteEntryRowsByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadSubagentEntryRepository.deleteByThreadId:query"),
        ),
      ),
  } satisfies ProjectionThreadSubagentEntryRepositoryShape;
});

export const ProjectionThreadSubagentRunRepositoryLive = Layer.effect(
  ProjectionThreadSubagentRunRepository,
  makeProjectionThreadSubagentRunRepository,
);

export const ProjectionThreadSubagentEntryRepositoryLive = Layer.effect(
  ProjectionThreadSubagentEntryRepository,
  makeProjectionThreadSubagentEntryRepository,
);
