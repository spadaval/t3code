import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_swarm_runs_next (
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
    INSERT INTO projection_swarm_runs_next (
      run_id,
      project_id,
      epic_issue_id,
      status,
      provider,
      model,
      model_options_json,
      provider_options_json,
      assistant_delivery_mode,
      runtime_mode,
      failure_context_json,
      requested_at,
      started_at,
      stop_requested_at,
      stopped_at,
      failed_at,
      completed_at,
      updated_at
    )
    SELECT
      run_id,
      project_id,
      epic_issue_id,
      CASE
        WHEN status = 'requested' THEN 'pending'
        WHEN status IN ('running', 'idle') THEN 'running'
        WHEN status = 'paused' THEN 'stopped'
        WHEN status = 'blocked' AND blocked_kind = 'tracker_waiting' THEN 'running'
        WHEN status = 'blocked' THEN 'failed'
        WHEN status = 'cancelled' THEN 'stopped'
        ELSE status
      END AS status,
      provider,
      model,
      model_options_json,
      provider_options_json,
      assistant_delivery_mode,
      runtime_mode,
      CASE
        WHEN status = 'failed' THEN json_object(
          'kind',
          CASE
            WHEN lower(last_error) LIKE '%launch%' THEN 'launch_failure'
            WHEN lower(last_error) LIKE '%invariant%' THEN 'invariant_violation'
            WHEN lower(last_error) LIKE '%still open%' OR lower(last_error) LIKE '%not closed%' THEN 'issue_incomplete'
            WHEN lower(last_error) LIKE '%stop%' OR lower(last_error) LIKE '%shutdown%' OR lower(last_error) LIKE '%interrupt%' THEN 'environment_failure'
            ELSE 'worker_failure'
          END,
          'message', last_error,
          'issueId', NULL,
          'executionId', NULL,
          'workerThreadId', NULL
        )
        WHEN status = 'blocked' AND blocked_kind != 'tracker_waiting' AND last_error IS NOT NULL THEN json_object(
          'kind',
          CASE
            WHEN lower(last_error) LIKE '%launch%' THEN 'launch_failure'
            WHEN lower(last_error) LIKE '%invariant%' THEN 'invariant_violation'
            WHEN lower(last_error) LIKE '%still open%' OR lower(last_error) LIKE '%not closed%' THEN 'issue_incomplete'
            WHEN lower(last_error) LIKE '%stop%' OR lower(last_error) LIKE '%shutdown%' OR lower(last_error) LIKE '%interrupt%' THEN 'environment_failure'
            ELSE 'worker_failure'
          END,
          'message', last_error,
          'issueId', blocked_issue_id,
          'executionId', blocked_execution_id,
          'workerThreadId', blocked_worker_thread_id
        )
        ELSE NULL
      END AS failure_context_json,
      requested_at,
      started_at,
      CASE
        WHEN status IN ('paused', 'cancelled') THEN COALESCE(paused_at, cancelled_at, updated_at)
        ELSE NULL
      END AS stop_requested_at,
      CASE
        WHEN status = 'paused' THEN COALESCE(paused_at, updated_at)
        WHEN status = 'cancelled' THEN COALESCE(cancelled_at, updated_at)
        ELSE NULL
      END AS stopped_at,
      CASE
        WHEN status = 'blocked' AND blocked_kind != 'tracker_waiting' THEN COALESCE(blocked_at, updated_at)
        ELSE failed_at
      END AS failed_at,
      completed_at,
      updated_at
    FROM projection_swarm_runs
  `;

  yield* sql`DROP TABLE projection_swarm_runs`;
  yield* sql`ALTER TABLE projection_swarm_runs_next RENAME TO projection_swarm_runs`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_epic_requested
    ON projection_swarm_runs(epic_issue_id, requested_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_swarm_runs_status_updated
    ON projection_swarm_runs(status, updated_at)
  `;

  yield* sql`
    CREATE TABLE projection_swarm_task_executions_next (
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
    INSERT INTO projection_swarm_task_executions_next (
      execution_id,
      run_id,
      issue_id,
      worker_thread_id,
      sequence_number,
      status,
      workspace_key,
      workspace_path,
      failure_kind,
      failure_message,
      failure_issue_id,
      failure_execution_id,
      failure_worker_thread_id,
      requested_at,
      started_at,
      stop_requested_at,
      stopped_at,
      completed_at,
      failed_at,
      updated_at
    )
    SELECT
      execution_id,
      run_id,
      issue_id,
      worker_thread_id,
      sequence_number,
      CASE
        WHEN status = 'requested' THEN 'launching'
        WHEN status = 'active' THEN 'running'
        WHEN status = 'cancelled' THEN 'stopped'
        ELSE status
      END AS status,
      'shared' AS workspace_key,
      NULL AS workspace_path,
      CASE
        WHEN status = 'failed' AND last_error IS NOT NULL THEN
          CASE
            WHEN lower(last_error) LIKE '%launch%' THEN 'launch_failure'
            WHEN lower(last_error) LIKE '%invariant%' THEN 'invariant_violation'
            WHEN lower(last_error) LIKE '%still open%' OR lower(last_error) LIKE '%not closed%' THEN 'issue_incomplete'
            WHEN lower(last_error) LIKE '%stop%' OR lower(last_error) LIKE '%shutdown%' OR lower(last_error) LIKE '%interrupt%' THEN 'environment_failure'
            ELSE 'worker_failure'
          END
        ELSE NULL
      END AS failure_kind,
      CASE
        WHEN status = 'failed' THEN last_error
        ELSE NULL
      END AS failure_message,
      CASE
        WHEN status = 'failed' THEN issue_id
        ELSE NULL
      END AS failure_issue_id,
      CASE
        WHEN status = 'failed' THEN execution_id
        ELSE NULL
      END AS failure_execution_id,
      CASE
        WHEN status = 'failed' THEN worker_thread_id
        ELSE NULL
      END AS failure_worker_thread_id,
      requested_at,
      started_at,
      CASE
        WHEN status = 'cancelled' THEN COALESCE(cancelled_at, updated_at)
        ELSE NULL
      END AS stop_requested_at,
      CASE
        WHEN status = 'cancelled' THEN COALESCE(cancelled_at, updated_at)
        ELSE NULL
      END AS stopped_at,
      completed_at,
      failed_at,
      updated_at
    FROM projection_swarm_task_executions
  `;

  yield* sql`DROP TABLE projection_swarm_task_executions`;
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
