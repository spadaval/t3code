# Reliability & Fault Tolerance

## Our Current State

T3 Code has strong foundations in some areas (event sourcing, client recovery) but lacks active monitoring and recovery mechanisms.

### What works well

- **Event-sourced state**: Every state change is an immutable event in SQLite. State can be rebuilt from the event log. Command receipt deduplication prevents double-processing.
- **Client recovery state machine**: `orchestrationRecovery.ts` (211 lines) handles sequence-gap detection, replay recovery with exponential backoff, and full-snapshot fallback.
- **WebSocket reconnection**: `wsTransport.ts` runs an infinite retry loop on disconnect. 250ms retry delay. `onResubscribe` callback triggers orchestration recovery.
- **Typed domain errors**: Effect's typed error channel surfaces specific errors: `OrchestrationCommandInvariantError`, `ProviderServiceError`, `EpicRunSchedulerError`, etc. Error messages are preserved at every level per AGENTS.md policy.
- **Provider session runtime table**: `provider_session_runtime` (mutable CRUD) tracks provider process lifecycle independently from the event-sourced orchestration state, allowing reconciliation on restart.

### What's missing

- **No stall detection**: If a provider session hangs (no events for minutes), nothing detects or recovers from it. No timeout, no warning, no auto-interrupt.
- **No watchdog**: No process monitoring the health of active sessions. The server trusts that providers will eventually emit events.
- **No automatic retry**: Epic run executions that fail are not automatically retried. The run fails and stops.
- **No worktree validation**: If a worktree is removed externally, orchestration still holds stale path references. No startup or periodic check validates these.
- **No provider session reconciliation on restart**: If the server crashes between updating `provider_session_runtime` and dispatching a `thread.session.set` event, the two tables disagree. The 4-value provider status (`starting|running|stopped|error`) and 7-value orchestration session status (`idle|starting|running|ready|interrupted|stopped|error`) can diverge.

## How Each Tool Solves It

### Symphony

- **Stall detection**: `stall_timeout_ms` (default 5 minutes). If no Codex event arrives within the timeout, the worker is killed and retried.
- **Exponential backoff retries**: Failure retries use `delay = min(10000 * 2^(attempt-1), max_retry_backoff_ms)`. Normal completion retries use 1-second delay.
- **Five failure classes** with distinct recovery:
  1. Workflow/config failures: block dispatch, keep service alive
  2. Workspace failures: fail attempt, retry
  3. Agent session failures: fail attempt, retry
  4. Tracker failures: skip tick, try next tick, keep existing workers
  5. Observability failures: never crash the orchestrator
- **Reconciliation loop**: Every poll tick, re-checks tracker state for all running issues. Terminal issues get workers killed and workspaces cleaned.
- **Restart recovery without a database**: In-memory state is rebuilt by polling the tracker. No persistent queue needed.
- **Hard failure on user-input-required**: Prevents indefinite stalls in unattended sessions.
- **Invalid config reload safety**: Bad config keeps last-known-good config running.

### Gas Town

- **Watchdog chain**: Go daemon (heartbeat every 3 min) -> Boot (fresh AI agent per daemon tick, triages Deacon health) -> Deacon (continuous patrol, monitors Mayor + Witnesses) -> Witnesses (per-rig, monitor Polecats). Each tier monitors the tier below.
- **NDI (Nondeterministic Idempotence)**: Design goal that useful outcomes emerge even when individual operations fail or vary.
- **Circuit breaker**: 3 consecutive failures on a bead -> close the sling context (not the work bead). No automatic reset.
- **Dolt data durability**: Every write wraps `BEGIN/DOLT_COMMIT/COMMIT` atomically. Auto-restart on crash with exponential backoff. JSONL exports every 15 minutes.
- **Recovery mechanisms**: Polecat stall detection (Witness nudges then escalates), zombie detection (dead tmux sessions with open hooks), orphan process cleanup (Deacon patrol), hook persistence (work survives restarts because hooks are in Dolt).
- **Escalation protocol**: Three-tier severity (CRITICAL/HIGH/MEDIUM). Stale escalations auto-bump severity after 4 hours.

### Hermes Agent

- **Fallback model chain**: On 429/5xx/401/403, tries `fallback_providers` in order. Credential pools for same-provider key rotation.
- **Iteration budget**: 90-turn hard limit. Two-tier pressure warnings at 70% and 90%. Shared across parent/child agents.
- **Write contention handling**: SQLite 1-second timeout, application-level retry with random jitter (20-150ms, up to 15 retries), BEGIN IMMEDIATE transactions, periodic WAL checkpoints.
- **Checkpoint manager**: Shadow git repos for pre-edit snapshots. Rollback restores files AND undoes conversation turns.
- **Interruptible API calls**: Background thread execution with clean interrupt/abandon.
- **Non-fatal checkpoint errors**: All checkpoint errors logged at debug, tools continue.

## Proposed Direction

### 1. Stall detection and recovery

Add server-side timeout monitoring per active session:

- **Implementation**: The `ProviderRuntimeIngestion` reactor already processes all provider events. Track `lastEventTimestamp` per thread in the read model (or a lightweight in-memory map).
- **Detection**: A periodic check (every 30 seconds) compares `lastEventTimestamp` against a configurable `stallTimeoutMs` (default 5 minutes, like Symphony).
- **Response tiers**:
  1. Warning: Surface a stall indicator in the UI (health status in fleet dashboard).
  2. Auto-interrupt: If configured, automatically dispatch `thread.turn.interrupt` after timeout.
  3. Escalation: For epic runs, fail the execution and move to the next issue (with retry option).

### 2. Epic run retry policy

Add configurable retry behavior for failed epic issue executions:

- **Max retries per issue** (default 1): Retry once before giving up.
- **Backoff**: Short delay (5 seconds) between retries.
- **Exhaustion**: After max retries, mark execution as failed and continue to next issue (don't fail the entire run).
- **Failure classification**: Distinguish between "agent couldn't complete the issue" (retryable) and "infrastructure failure" (worktree creation failed, provider crashed -- different handling).

### 3. Provider session reconciliation on restart

On server startup, reconcile `provider_session_runtime` table against actual process state:

- Check if Codex/Claude child processes are still running.
- Mark any sessions with no live process as `stopped`.
- Dispatch `thread.session.set` events for any mismatched state.

### 4. Worktree validation on startup

On server startup, validate all `worktreePath` references in the read model:

- Check filesystem existence.
- For missing worktrees, clear the reference and emit a warning.
- For plan implementation launches in `prepared` or `started` state with missing worktrees, fail the launch.

### 5. Budget controls

Add configurable limits as guard rails:

- **Per-thread turn limit** (like Hermes's 90-turn budget): Prevent runaway sessions.
- **Per-epic-run cost limit**: Stop the run if cumulative cost exceeds threshold.
- **Per-thread cost limit**: Interrupt if a single thread exceeds cost threshold.

## Pros and Cons

### Stall detection

| Pro                                                | Con                                                |
| -------------------------------------------------- | -------------------------------------------------- |
| Prevents zombie sessions consuming resources       | False positives on slow but valid operations       |
| Essential for unattended epic runs                 | Timeout tuning is workload-dependent               |
| Low implementation cost (event timestamp tracking) | Auto-interrupt may disrupt valid long-running work |

### Epic run retry

| Pro                                         | Con                                                   |
| ------------------------------------------- | ----------------------------------------------------- |
| Improves completion rate for flaky failures | Retry on fundamentally broken issues wastes resources |
| Per-issue retry doesn't block other issues  | Need failure classification to be useful              |
| Configurable (can be disabled)              | Circuit breaker logic adds complexity                 |

### Budget controls

| Pro                                | Con                                                        |
| ---------------------------------- | ---------------------------------------------------------- |
| Prevents runaway cost              | Hard limits may interrupt valuable work                    |
| Users need spending guardrails     | Threshold tuning is task-dependent                         |
| Enables team-level cost management | Need graceful handling (warning -> soft stop -> hard stop) |
