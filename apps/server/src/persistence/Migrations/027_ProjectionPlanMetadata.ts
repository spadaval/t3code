import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_thread_proposed_plans
    ADD COLUMN plan_intent TEXT NOT NULL DEFAULT 'code-implementation'
  `;

  yield* sql`
    ALTER TABLE projection_plan_implementation_launches
    ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'worktree'
  `;
});
