import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_proposed_plans)
  `;

  if (!columns.some((column) => column.name === "follow_up_outcome_json")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN follow_up_outcome_json TEXT
    `;
  }

  yield* sql`
    UPDATE projection_thread_proposed_plans
    SET follow_up_outcome_json = json_object(
      'kind',
      'implement-code',
      'completedAt',
      implemented_at,
      'targetThreadId',
      implementation_thread_id
    )
    WHERE implemented_at IS NOT NULL
  `;
});
