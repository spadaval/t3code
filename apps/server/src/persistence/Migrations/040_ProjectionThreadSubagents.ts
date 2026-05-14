import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      parent_item_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      provider_run_id TEXT,
      title TEXT,
      description TEXT,
      prompt TEXT,
      agent_type TEXT,
      model TEXT,
      reasoning_effort TEXT,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_subagent_entries (
      entry_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_runs_thread_started
    ON projection_thread_subagent_runs(thread_id, started_at, run_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_entries_run_created
    ON projection_thread_subagent_entries(run_id, created_at, entry_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_subagent_runs_thread_turn
    ON projection_thread_subagent_runs(thread_id, turn_id)
  `;
});
