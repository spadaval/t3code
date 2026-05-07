import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_epic_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      epic_issue_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      model_options_json TEXT,
      provider_options_json TEXT,
      assistant_delivery_mode TEXT,
      runtime_mode TEXT NOT NULL,
      failure_context_json TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      stop_requested_at TEXT,
      stopped_at TEXT,
      failed_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_epic_issue_executions (
      execution_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      worker_thread_id TEXT,
      sequence_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      workspace_key TEXT NOT NULL,
      workspace_path TEXT,
      failure_kind TEXT,
      failure_message TEXT,
      failure_issue_id TEXT,
      failure_execution_id TEXT,
      failure_worker_thread_id TEXT,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      stop_requested_at TEXT,
      stopped_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id, sequence_number)
    )
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
