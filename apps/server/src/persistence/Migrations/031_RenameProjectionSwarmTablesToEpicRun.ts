import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_swarm_runs
    RENAME TO projection_epic_runs
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    ALTER TABLE projection_swarm_task_executions
    RENAME TO projection_epic_issue_executions
  `.pipe(Effect.catchTag("SqlError", () => Effect.void));

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_swarm_runs_epic_requested
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_swarm_runs_status_updated
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_swarm_task_executions_run_sequence
  `;

  yield* sql`
    DROP INDEX IF EXISTS idx_projection_swarm_task_executions_worker_thread
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_epic_runs_epic_requested
    ON projection_epic_runs(epic_issue_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_epic_runs_status_updated
    ON projection_epic_runs(status, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_epic_issue_executions_run_sequence
    ON projection_epic_issue_executions(run_id, sequence_number)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_epic_issue_executions_worker_thread
    ON projection_epic_issue_executions(worker_thread_id)
  `;
});
