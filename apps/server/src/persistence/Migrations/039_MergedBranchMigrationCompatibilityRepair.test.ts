import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0031 from "./031_ProjectionPlanImplementationLaunches.ts";
import Migration0032 from "./032_ProjectionThreadsIssueLink.ts";
import Migration0033 from "./033_ProjectionPlanMetadata.ts";
import Migration0034 from "./034_ProjectionEpicRuns.ts";
import Migration0035 from "./035_ProposedPlanFollowUpOutcome.ts";
import Migration0036 from "./036_ProjectionPendingCheckpointCaptures.ts";
import Migration0037 from "./037_ProjectionTurnsTerminalSource.ts";
import Migration0038 from "./038_EnsureProviderInstanceIdColumns.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("039_MergedBranchMigrationCompatibilityRepair", (it) => {
  it.effect("repairs databases that already recorded branch migration ids 030-037", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 29 });

      yield* Migration0031;
      yield* Migration0032;
      yield* Migration0033;
      yield* Migration0034;
      yield* Migration0035;
      yield* Migration0036;
      yield* Migration0037;
      yield* Migration0038;

      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (30, 'ProjectionPlanImplementationLaunches'),
          (31, 'ProjectionThreadsIssueLink'),
          (32, 'ProjectionPlanMetadata'),
          (33, 'ProjectionEpicRuns'),
          (34, 'ProposedPlanFollowUpOutcome'),
          (35, 'ProjectionPendingCheckpointCaptures'),
          (36, 'ProjectionTurnsTerminalSource'),
          (37, 'EnsureProviderInstanceIdColumns')
      `;

      yield* sql`
        INSERT INTO projection_epic_runs (
          run_id,
          project_id,
          epic_issue_id,
          status,
          runtime_mode,
          requested_at,
          updated_at
        ) VALUES (
          'run-1',
          'project-1',
          'issue-1',
          'running',
          'approval-required',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_plan_implementation_launches (
          launch_id,
          source_thread_id,
          source_plan_id,
          project_id,
          target_thread_id,
          status,
          cleanup_status,
          title,
          setup_enabled,
          prompt_text,
          runtime_mode,
          requested_at,
          updated_at
        ) VALUES (
          'launch-1',
          'thread-source',
          'plan-1',
          'project-1',
          'thread-target',
          'running',
          'pending',
          'Implement plan',
          0,
          'Please implement the plan.',
          'approval-required',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_pending_checkpoint_captures (
          thread_id,
          turn_id,
          checkpoint_turn_count,
          requested_at
        ) VALUES (
          'thread-1',
          'turn-1',
          1,
          '2026-01-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations();

      const repairedMigrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (38, 39)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(repairedMigrations, [
        { migration_id: 38, name: "EnsureProviderInstanceIdColumns" },
        { migration_id: 39, name: "MergedBranchMigrationCompatibilityRepair" },
      ]);

      const archiveIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_threads)
      `;
      assert.ok(
        archiveIndexes.some((index) => index.name === "idx_projection_threads_shell_active"),
      );
      assert.ok(
        archiveIndexes.some((index) => index.name === "idx_projection_threads_shell_archived"),
      );

      const epicRuns = yield* sql<{ readonly run_id: string }>`
        SELECT run_id
        FROM projection_epic_runs
      `;
      assert.deepStrictEqual(
        epicRuns.map((row) => row.run_id),
        ["run-1"],
      );

      const launches = yield* sql<{ readonly launch_id: string }>`
        SELECT launch_id
        FROM projection_plan_implementation_launches
      `;
      assert.deepStrictEqual(
        launches.map((row) => row.launch_id),
        ["launch-1"],
      );

      const pendingCaptures = yield* sql<{ readonly thread_id: string }>`
        SELECT thread_id
        FROM projection_pending_checkpoint_captures
      `;
      assert.deepStrictEqual(
        pendingCaptures.map((row) => row.thread_id),
        ["thread-1"],
      );
    }),
  );
});
