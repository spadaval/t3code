import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_pending_checkpoint_captures (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      checkpoint_turn_count INTEGER NOT NULL,
      assistant_message_id TEXT,
      requested_at TEXT NOT NULL,
      UNIQUE (thread_id, turn_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_pending_checkpoint_captures_thread_requested
    ON projection_pending_checkpoint_captures(thread_id, requested_at)
  `;
});
