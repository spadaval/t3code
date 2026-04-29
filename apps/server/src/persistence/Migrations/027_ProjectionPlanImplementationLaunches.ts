import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_plan_implementation_launches (
      launch_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL,
      source_plan_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      retry_of_launch_id TEXT,
      status TEXT NOT NULL,
      branch TEXT,
      worktree_path TEXT,
      failure_reason TEXT,
      cleanup_status TEXT NOT NULL,
      cleanup_error TEXT,
      title TEXT NOT NULL,
      setup_enabled INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      model_options_json TEXT,
      provider_options_json TEXT,
      assistant_delivery_mode TEXT,
      runtime_mode TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      prepared_at TEXT,
      started_at TEXT,
      failed_at TEXT,
      cancelled_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_plan_launches_source_plan
    ON projection_plan_implementation_launches(source_thread_id, source_plan_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_plan_launches_target_thread
    ON projection_plan_implementation_launches(target_thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_plan_launches_status_updated
    ON projection_plan_implementation_launches(status, updated_at)
  `;
});
