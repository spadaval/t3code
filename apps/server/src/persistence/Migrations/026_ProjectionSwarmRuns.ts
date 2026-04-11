import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_swarm_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      epic_issue_id TEXT NOT NULL,
      swarm_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scheduler_mode TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      model_options_json TEXT,
      provider_options_json TEXT,
      assistant_delivery_mode TEXT,
      runtime_mode TEXT NOT NULL,
      active_task_execution_id TEXT,
      latest_task_execution_id TEXT,
      last_error TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      idled_at TEXT,
      paused_at TEXT,
      blocked_at TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_swarm_task_executions (
      execution_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      worker_thread_id TEXT,
      sequence_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id, sequence_number)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_epic_requested
    ON projection_swarm_runs(epic_issue_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_status_updated
    ON projection_swarm_runs(status, updated_at)
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
