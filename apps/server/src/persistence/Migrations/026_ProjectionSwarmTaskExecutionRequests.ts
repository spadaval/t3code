import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_swarm_task_executions_next (
      execution_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      worker_thread_id TEXT,
      sequence_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      original_status TEXT NOT NULL,
      original_assignee TEXT,
      last_error TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id, sequence_number)
    )
  `;

  yield* sql`
    INSERT INTO projection_swarm_task_executions_next (
      execution_id,
      run_id,
      issue_id,
      worker_thread_id,
      sequence_number,
      status,
      original_status,
      original_assignee,
      last_error,
      requested_at,
      started_at,
      completed_at,
      failed_at,
      cancelled_at,
      updated_at
    )
    SELECT
      execution_id,
      run_id,
      issue_id,
      worker_thread_id,
      sequence_number,
      status,
      CASE
        WHEN status = 'completed' THEN 'closed'
        ELSE 'open'
      END AS original_status,
      NULL AS original_assignee,
      last_error,
      COALESCE(started_at, completed_at, failed_at, cancelled_at, updated_at) AS requested_at,
      started_at,
      completed_at,
      failed_at,
      cancelled_at,
      updated_at
    FROM projection_swarm_task_executions
  `;

  yield* sql`
    DROP TABLE projection_swarm_task_executions
  `;

  yield* sql`
    ALTER TABLE projection_swarm_task_executions_next
    RENAME TO projection_swarm_task_executions
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_task_executions_run_sequence
    ON projection_swarm_task_executions(run_id, sequence_number)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_task_executions_worker_thread
    ON projection_swarm_task_executions(worker_thread_id)
  `;
});
