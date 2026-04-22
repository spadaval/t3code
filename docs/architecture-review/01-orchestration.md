# Orchestration & Multi-Agent Execution

## Our Current State

T3 Code uses an event-sourced CQRS architecture for orchestration. The core is a pure `Decider` function that validates commands against the current `OrchestrationReadModel` and produces events, a `Projector` that applies events to update the read model, and 6 `Reactor` layers that handle side effects.

**Key files:**

- `apps/server/src/orchestration/decider.ts` (1133 lines) -- Command validation and event production
- `apps/server/src/orchestration/projector.ts` (1150 lines) -- Event application to read model
- `apps/server/src/orchestration/Layers/EpicRunScheduler.ts` (1629 lines) -- Epic issue execution

**Current capabilities:**

- 16 client-dispatchable commands, 23 internal commands, 38 event types
- Thread lifecycle management (create, start, stop, interrupt, resume)
- Session state tracking (idle/starting/running/ready/interrupted/stopped/error)
- Plan implementation workflow (plan -> worktree -> thread -> execution)
- Epic runs: execute issues from a beads epic **sequentially** (one worker thread at a time)

**Critical limitation:** The `requireNoConflictingSharedWorkspaceRun` invariant in `commandInvariants.ts:347-363` enforces single-execution. The `EpicRunScheduler` dispatches one issue, waits for completion, then selects the next. There is no concurrent agent coordination.

## How Each Tool Solves It

### Symphony (OpenAI)

- **Model**: Single-authority scheduler with bounded concurrency. One agent per issue, but N issues run in parallel.
- **Concurrency control**: `max_concurrent_agents` (default 10), `max_concurrent_agents_by_state` (e.g., limit merging to 2 while allowing 10 in-progress).
- **Priority dispatch**: Issues sorted by priority then age. Higher priority work gets slots first.
- **No multi-agent collaboration per issue.** Each issue is fully isolated. No agent-to-agent communication.
- **Workspace isolation**: Each issue gets its own filesystem workspace. Workspaces persist across retries.
- **Multi-turn within session**: Up to `max_turns` (default 20) back-to-back turns per worker without returning to the scheduler, reducing dispatch overhead.

### Gas Town

- **Model**: Hierarchical role system with 8 distinct agent types. Mayor coordinates, Polecats execute, Witness monitors, Refinery merges.
- **Concurrency**: 20-30+ concurrent Polecats, each in their own git worktree (fast creation ~5s via worktree vs. 30s+ for full clone).
- **Dispatch**: Mayor creates beads and slings them to polecats. The `gt sling` command reuses idle polecats before spawning new ones.
- **Capacity governor**: Configurable `max_polecats`, `batch_size`, `spawn_delay`. Daemon heartbeat dispatches incrementally.
- **Merge coordination**: Dedicated Refinery role processes merge requests sequentially with rebase. Bors-style batch-then-bisect for test failures.
- **Integration branches**: Epic-scoped work batches all child MRs to an integration branch, then lands to main as a single commit.

### Hermes Agent

- **Model**: Single agent with up to 3 parallel subagents via `delegate_task`.
- **Delegation**: Completely fresh context per subagent (no parent conversation history). Only `goal` + `context` fields.
- **Restrictions**: Subagents cannot delegate recursively (max depth 2), cannot interact with user, cannot write to shared memory.
- **Budget**: Shared iteration budget across parent and children. Two-tier pressure warnings at 70% and 90%.

## Proposed Direction

### Parallel Epic Execution

Evolve the epic run scheduler to dispatch multiple issues concurrently:

1. **Replace the shared workspace invariant** with per-issue workspace isolation. Each concurrent execution gets its own git worktree (the `createTemporaryWorktree` infrastructure already exists).
2. **Add concurrency bounds**: `maxConcurrentExecutions` per epic run (configurable, default 3-5). Similar to Symphony's `max_concurrent_agents`.
3. **Dependency-aware scheduling**: Only dispatch issues whose beads dependencies are satisfied. The scheduler already queries `getEpicTrackerStatus` which returns `ready` issues -- filter out those with unresolved blockers.
4. **Independent execution lifecycles**: Each `EpicIssueExecution` runs its own worker thread. The reconciliation loop tracks N concurrent executions instead of 1.

### Merge Strategy

Parallel execution creates merge conflicts. Two options:

**Option A: Integration branch (Gas Town pattern)**

- Create an integration branch per epic run.
- Each worker's worktree branches from the integration branch.
- On completion, merge worker branch to integration branch (Refinery-like sequential merge).
- When epic run completes, land integration branch to main.
- Pro: Clean history. Con: Requires a merge coordinator.

**Option B: Independent branches with rebase-on-complete**

- Each worker branches from main independently.
- On completion, rebase onto main and fast-forward merge.
- Conflict detection: if rebase fails, mark execution as needing manual resolution.
- Pro: Simpler. Con: More conflicts, less clean history.

### Phase 1 recommendation: Start with Option B (simpler, unblocks parallelism), add Option A later when the volume of concurrent work justifies the complexity.

## Pros and Cons

### Parallel execution

| Pro                                                     | Con                                              |
| ------------------------------------------------------- | ------------------------------------------------ |
| Dramatically higher throughput (N issues vs. 1)         | Merge conflicts between concurrent workers       |
| Aligns with the stated product vision                   | More complex scheduler state machine             |
| Worktree infrastructure already exists                  | Cost multiplier (N concurrent provider sessions) |
| Event-sourced architecture handles N executions cleanly | Need a merge/conflict resolution strategy        |

### Integration branch approach

| Pro                                                               | Con                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Clean merge history                                               | Requires a dedicated merge coordinator (like Gas Town's Refinery) |
| Workers see each other's completed work (branch from integration) | More complex git operations                                       |
| Single landing point to main                                      | Integration branch itself can accumulate conflicts                |

### Independent branches approach

| Pro                           | Con                                           |
| ----------------------------- | --------------------------------------------- |
| Simple to implement           | More merge conflicts                          |
| Each worker is fully isolated | Workers can't see each other's completed work |
| No coordinator needed         | Rebase failures require manual intervention   |
