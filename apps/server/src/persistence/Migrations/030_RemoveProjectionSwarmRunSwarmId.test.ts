// @ts-nocheck
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("030_RemoveProjectionSwarmRunSwarmId", (it) => {
  it.effect("drops swarm_id and preserves existing swarm run rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 29 });
      yield* sql`
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
          'run-1',
          'project-1',
          'EPIC-1',
          'SWARM-1',
          'running',
          'automatic',
          'shared',
          'codex',
          'gpt-5.4',
          NULL,
          NULL,
          'streaming',
          'full-access',
          NULL,
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:01.000Z',
          NULL,
          NULL,
          NULL,
          'worker_failure',
          'execution-1',
          'TASK-1',
          'thread-1',
          NULL,
          NULL,
          NULL,
          '2026-04-06T00:00:02.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 30 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_swarm_runs)
      `;
      assert.ok(columns.every((column) => column.name !== "swarm_id"));

      const rows = yield* sql<{
        readonly runId: string;
        readonly epicIssueId: string;
        readonly blockedKind: string | null;
        readonly blockedExecutionId: string | null;
        readonly blockedIssueId: string | null;
        readonly blockedWorkerThreadId: string | null;
      }>`
        SELECT
          run_id AS "runId",
          epic_issue_id AS "epicIssueId",
          blocked_kind AS "blockedKind",
          blocked_execution_id AS "blockedExecutionId",
          blocked_issue_id AS "blockedIssueId",
          blocked_worker_thread_id AS "blockedWorkerThreadId"
        FROM projection_swarm_runs
        WHERE run_id = 'run-1'
      `;
      assert.deepStrictEqual(rows, [
        {
          runId: "run-1",
          epicIssueId: "EPIC-1",
          blockedKind: "worker_failure",
          blockedExecutionId: "execution-1",
          blockedIssueId: "TASK-1",
          blockedWorkerThreadId: "thread-1",
        },
      ]);
    }),
  );
});
