// @ts-nocheck
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("031_ProposedPlanFollowUpOutcome", (it) => {
  it.effect("adds and backfills follow-up outcome JSON from legacy implementation columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          created_at,
          updated_at,
          implemented_at,
          implementation_thread_id,
          plan_intent
        ) VALUES (
          'plan-1',
          'thread-1',
          'turn-1',
          '# Plan',
          '2026-01-01T00:00:00.000Z',
          '2026-01-02T00:00:00.000Z',
          '2026-01-02T00:00:00.000Z',
          'thread-2',
          'code-implementation'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 31 });

      const proposedPlanColumns = yield* sql<{
        readonly name: string;
      }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
      assert.ok(proposedPlanColumns.some((column) => column.name === "follow_up_outcome_json"));

      const rows = yield* sql<{
        readonly followUpOutcomeJson: string | null;
      }>`
        SELECT follow_up_outcome_json AS "followUpOutcomeJson"
        FROM projection_thread_proposed_plans
        WHERE plan_id = 'plan-1'
      `;

      assert.strictEqual(
        rows[0]?.followUpOutcomeJson,
        JSON.stringify({
          kind: "implement-code",
          completedAt: "2026-01-02T00:00:00.000Z",
          targetThreadId: "thread-2",
        }),
      );
    }),
  );
});
