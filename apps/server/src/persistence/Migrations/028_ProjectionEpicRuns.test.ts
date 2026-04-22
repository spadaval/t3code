// @ts-nocheck
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("028_ProjectionEpicRuns", (it) => {
  it.effect("creates the canonical epic run projection tables and indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 29 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('projection_epic_runs', 'projection_epic_issue_executions')
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["projection_epic_issue_executions", "projection_epic_runs"],
      );

      const runColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_epic_runs)
      `;
      assert.deepStrictEqual(
        runColumns.map((column) => column.name),
        [
          "run_id",
          "project_id",
          "epic_issue_id",
          "status",
          "provider",
          "model",
          "model_options_json",
          "provider_options_json",
          "assistant_delivery_mode",
          "runtime_mode",
          "failure_context_json",
          "requested_at",
          "started_at",
          "stop_requested_at",
          "stopped_at",
          "failed_at",
          "completed_at",
          "updated_at",
        ],
      );

      const executionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_epic_issue_executions)
      `;
      assert.deepStrictEqual(
        executionColumns.map((column) => column.name),
        [
          "execution_id",
          "run_id",
          "issue_id",
          "worker_thread_id",
          "sequence_number",
          "status",
          "workspace_key",
          "workspace_path",
          "failure_kind",
          "failure_message",
          "failure_issue_id",
          "failure_execution_id",
          "failure_worker_thread_id",
          "requested_at",
          "started_at",
          "stop_requested_at",
          "stopped_at",
          "completed_at",
          "failed_at",
          "updated_at",
        ],
      );
    }),
  );
});
