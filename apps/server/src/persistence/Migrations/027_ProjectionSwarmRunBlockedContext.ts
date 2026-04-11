import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_swarm_runs
    ADD COLUMN blocked_kind TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE projection_swarm_runs
    ADD COLUMN blocked_execution_id TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE projection_swarm_runs
    ADD COLUMN blocked_issue_id TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE projection_swarm_runs
    ADD COLUMN blocked_worker_thread_id TEXT
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));
});
