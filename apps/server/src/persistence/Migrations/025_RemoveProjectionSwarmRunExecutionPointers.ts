import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_swarm_runs_next (
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
      last_error TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      idled_at TEXT,
      paused_at TEXT,
      blocked_at TEXT,
      blocked_kind TEXT,
      blocked_execution_id TEXT,
      blocked_issue_id TEXT,
      blocked_worker_thread_id TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    INSERT INTO projection_swarm_runs_next (
      run_id,
      project_id,
      epic_issue_id,
      swarm_id,
      status,
      scheduler_mode,
      workspace_mode,
      provider,
      model,
      model_options_json,
      provider_options_json,
      assistant_delivery_mode,
      runtime_mode,
      last_error,
      requested_at,
      started_at,
      idled_at,
      paused_at,
      blocked_at,
      blocked_kind,
      blocked_execution_id,
      blocked_issue_id,
      blocked_worker_thread_id,
      failed_at,
      cancelled_at,
      completed_at,
      updated_at
    )
    SELECT
      run_id,
      project_id,
      epic_issue_id,
      swarm_id,
      status,
      scheduler_mode,
      workspace_mode,
      provider,
      model,
      model_options_json,
      provider_options_json,
      assistant_delivery_mode,
      runtime_mode,
      last_error,
      requested_at,
      started_at,
      idled_at,
      paused_at,
      blocked_at,
      blocked_kind,
      blocked_execution_id,
      blocked_issue_id,
      blocked_worker_thread_id,
      failed_at,
      cancelled_at,
      completed_at,
      updated_at
    FROM projection_swarm_runs
  `;

  yield* sql`
    DROP TABLE projection_swarm_runs
  `;

  yield* sql`
    ALTER TABLE projection_swarm_runs_next
    RENAME TO projection_swarm_runs
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_epic_requested
    ON projection_swarm_runs(epic_issue_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_status_updated
    ON projection_swarm_runs(status, updated_at)
  `;
});
