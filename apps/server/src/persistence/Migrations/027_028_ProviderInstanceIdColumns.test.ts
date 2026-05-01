import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.fresh(Layer.mergeAll(NodeSqliteClient.layerMemory())));

layer("027_028_ProviderInstanceIdColumns", (it) => {
  it.effect("continues when provider_session_runtime was partially migrated", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });
      yield* sql`
        ALTER TABLE provider_session_runtime
        ADD COLUMN provider_instance_id TEXT
      `;

      yield* runMigrations({ toMigrationInclusive: 28 });

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (27, 28)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        {
          migration_id: 27,
          name: "ProviderSessionRuntimeInstanceId",
        },
        {
          migration_id: 28,
          name: "ProjectionThreadSessionInstanceId",
        },
      ]);

      const providerSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assert.ok(providerSessionColumns.some((column) => column.name === "provider_instance_id"));

      const projectionThreadSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionColumns.some((column) => column.name === "provider_instance_id"),
      );

      const providerSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(provider_session_runtime)
      `;
      assert.ok(
        providerSessionIndexes.some(
          (index) => index.name === "idx_provider_session_runtime_instance",
        ),
      );

      const projectionThreadSessionIndexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionIndexes.some(
          (index) => index.name === "idx_projection_thread_sessions_instance",
        ),
      );
    }),
  );
});

const recoveryLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

recoveryLayer("036_EnsureProviderInstanceIdColumns", (it) => {
  it.effect("recovers older databases where migration ids 27 and 28 were already used", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (27, 'ProjectionPlanImplementationLaunches'),
          (28, 'ProjectionThreadsIssueLink')
      `;

      yield* runMigrations({ toMigrationInclusive: 36 });

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (27, 28, 36)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        {
          migration_id: 27,
          name: "ProjectionPlanImplementationLaunches",
        },
        {
          migration_id: 28,
          name: "ProjectionThreadsIssueLink",
        },
        {
          migration_id: 36,
          name: "EnsureProviderInstanceIdColumns",
        },
      ]);

      const providerSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_session_runtime)
      `;
      assert.ok(providerSessionColumns.some((column) => column.name === "provider_instance_id"));

      const projectionThreadSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(
        projectionThreadSessionColumns.some((column) => column.name === "provider_instance_id"),
      );
    }),
  );
});
