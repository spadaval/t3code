// @ts-nocheck
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("034_RenameProjectionSwarmTablesToEpicRun", (it) => {
  it.effect("renames projection swarm tables in place and preserves existing rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* sql`
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
          'run-1',
          'project-1',
          'EPIC-1',
          'running',
          'codex',
          'gpt-5.4',
          NULL,
          NULL,
          'streaming',
          'full-access',
          NULL,
          '2026-04-10T00:00:00.000Z',
          '2026-04-10T00:00:01.000Z',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-04-10T00:00:02.000Z'
        )
      `;
      yield* sql`
        INSERT INTO projection_swarm_task_executions (
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
          'execution-1',
          'run-1',
          'TASK-1',
          'thread-1',
          1,
          'running',
          'project-root',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-04-10T00:00:00.000Z',
          '2026-04-10T00:00:01.000Z',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-04-10T00:00:02.000Z'
        )
      `;

      yield* runMigrations();

      const epicRunRows = yield* sql<{
        readonly runId: string;
        readonly status: string;
      }>`
        SELECT run_id AS "runId", status
        FROM projection_epic_runs
        WHERE run_id = 'run-1'
      `;
      assert.deepStrictEqual(epicRunRows, [{ runId: "run-1", status: "running" }]);

      const executionRows = yield* sql<{
        readonly executionId: string;
        readonly runId: string;
      }>`
        SELECT execution_id AS "executionId", run_id AS "runId"
        FROM projection_epic_issue_executions
        WHERE execution_id = 'execution-1'
      `;
      assert.deepStrictEqual(executionRows, [{ executionId: "execution-1", runId: "run-1" }]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'projection_swarm_runs',
            'projection_swarm_task_executions',
            'projection_epic_runs',
            'projection_epic_issue_executions'
          )
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["projection_epic_issue_executions", "projection_epic_runs"],
      );
    }),
  );
});
