import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("022_ProjectionPlanMetadata", (it) => {
  it.effect("adds plan intent and launch mode columns when upgrading from migration 021", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 21 });
      yield* runMigrations({ toMigrationInclusive: 22 });

      const proposedPlanColumns = yield* sql<{
        readonly cid: number;
        readonly name: string;
        readonly type: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
        readonly pk: number;
      }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
      const planIntentColumn = proposedPlanColumns.find((column) => column.name === "plan_intent");
      assert.ok(planIntentColumn);
      assert.deepStrictEqual(
        {
          name: planIntentColumn.name,
          type: planIntentColumn.type,
          notnull: planIntentColumn.notnull,
          dflt_value: planIntentColumn.dflt_value,
          pk: planIntentColumn.pk,
        },
        {
          name: "plan_intent",
          type: "TEXT",
          notnull: 1,
          dflt_value: "'code-implementation'",
          pk: 0,
        },
      );

      const launchColumns = yield* sql<{
        readonly cid: number;
        readonly name: string;
        readonly type: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
        readonly pk: number;
      }>`
        PRAGMA table_info(projection_plan_implementation_launches)
      `;
      const launchModeColumn = launchColumns.find((column) => column.name === "launch_mode");
      assert.ok(launchModeColumn);
      assert.deepStrictEqual(
        {
          name: launchModeColumn.name,
          type: launchModeColumn.type,
          notnull: launchModeColumn.notnull,
          dflt_value: launchModeColumn.dflt_value,
          pk: launchModeColumn.pk,
        },
        {
          name: "launch_mode",
          type: "TEXT",
          notnull: 1,
          dflt_value: "'worktree'",
          pk: 0,
        },
      );
    }),
  );
});
