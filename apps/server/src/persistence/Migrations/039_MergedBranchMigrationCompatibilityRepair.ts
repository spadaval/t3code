import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

interface TableColumn {
  readonly name: string;
}

const hasColumn = (columns: ReadonlyArray<TableColumn>, name: string) =>
  columns.some((column) => column.name === name);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_active
    ON projection_threads(deleted_at, archived_at, project_id, created_at, thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_archived
    ON projection_threads(deleted_at, archived_at, project_id, thread_id)
  `;

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

  const planLaunchColumns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_plan_implementation_launches)
  `;
  if (!hasColumn(planLaunchColumns, "launch_mode")) {
    yield* sql`
      ALTER TABLE projection_plan_implementation_launches
      ADD COLUMN launch_mode TEXT NOT NULL DEFAULT 'worktree'
    `;
  }

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

  const threadColumns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_threads)
  `;
  if (!hasColumn(threadColumns, "issue_link_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN issue_link_json TEXT
    `;
  }

  const proposedPlanColumns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_thread_proposed_plans)
  `;
  if (!hasColumn(proposedPlanColumns, "plan_intent")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN plan_intent TEXT NOT NULL DEFAULT 'code-implementation'
    `;
  }
  if (!hasColumn(proposedPlanColumns, "follow_up_outcome_json")) {
    yield* sql`
      ALTER TABLE projection_thread_proposed_plans
      ADD COLUMN follow_up_outcome_json TEXT
    `;

    yield* sql`
      UPDATE projection_thread_proposed_plans
      SET follow_up_outcome_json = json_object(
        'kind',
        'implement-code',
        'completedAt',
        implemented_at,
        'targetThreadId',
        implementation_thread_id
      )
      WHERE implemented_at IS NOT NULL
    `;
  }

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

  const turnColumns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_turns)
  `;
  if (!hasColumn(turnColumns, "terminal_source")) {
    yield* sql`
      ALTER TABLE projection_turns
      ADD COLUMN terminal_source TEXT
    `;
  }

  const runtimeColumns = yield* sql<TableColumn>`
    PRAGMA table_info(provider_session_runtime)
  `;
  if (!hasColumn(runtimeColumns, "provider_instance_id")) {
    yield* sql`
      ALTER TABLE provider_session_runtime
      ADD COLUMN provider_instance_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_instance
    ON provider_session_runtime(provider_instance_id)
  `;

  const threadSessionColumns = yield* sql<TableColumn>`
    PRAGMA table_info(projection_thread_sessions)
  `;
  if (!hasColumn(threadSessionColumns, "provider_instance_id")) {
    yield* sql`
      ALTER TABLE projection_thread_sessions
      ADD COLUMN provider_instance_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_instance
    ON projection_thread_sessions(provider_instance_id)
  `;
});
