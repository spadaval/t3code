# State Ownership & Source of Truth

## Our Current State

Three systems hold state with blurry boundaries between them.

### System 1: T3 Code Orchestration (SQLite event store + in-memory read model)

**Owns:** Thread lifecycle, sessions, messages, turns, activities, proposed plans, checkpoints, epic runs, epic issue executions, plan implementation launches.

**Key tables:**

- `orchestration_events` -- Append-only canonical event log (38 event types, 5 aggregate kinds)
- `provider_session_runtime` -- Mutable CRUD for provider process lifecycle (NOT event-sourced)
- 8 projection tables materializing the read model for fast queries
- `projection_epic_runs` / `projection_epic_issue_executions` for epic run state

**In-memory read model (`OrchestrationReadModel`):**

- `projects[]`, `threads[]` (with nested messages, activities, checkpoints, plans, session, latestTurn, issueLink), `planImplementationLaunches[]`, `epicRuns[]`, `epicIssueExecutions[]`
- Rebuilt from projection tables on startup, kept in sync by applying events through the projector

### System 2: Beads (Dolt database, accessed via `bd` CLI subprocess)

**Owns:** Issue identity, status, priority, type, labels, dependencies, parent-child relationships, comments, assignees, epic structure, tracker summaries.

**No beads data is persisted in T3 Code's SQLite.** Every query is a fresh subprocess call to `bd`.

### System 3: Filesystem (Git)

**Owns:** Code, branches, worktrees, git history, diffs.

**Referenced by orchestration:** `project.workspaceRoot`, `thread.branch`, `thread.worktreePath`, `launch.branch`, `launch.worktreePath`, `execution.workspacePath`, `checkpoint.checkpointRef`, `checkpoint.files[].path`.

## Where Data is Duplicated

### Issue metadata: Beads <-> Orchestration

**The problem:** `OrchestrationThreadIssueLink` (orchestration.ts:271-279) snapshots `issueId`, `title`, `status`, `priority`, `repoRoot`, `linkedAt` at thread creation time. **There is no automatic sync.** If the issue title, status, or priority changes in beads, the orchestration snapshot goes stale.

**Created by:** `buildEpicRunIssueLink()` at `epicRunWorker.ts:9-27`.

**Impact:** The browser displays stale issue metadata for linked threads. The `thread.meta.update` command can refresh `issueLink`, but nothing triggers this automatically.

### Branch/worktree paths: Filesystem <-> Orchestration

**The problem:** Orchestration stores `branch` and `worktreePath` as string fields. These are stale the instant the filesystem changes outside T3 Code's control. No filesystem watcher validates these references.

### Epic run issue IDs: Beads <-> Orchestration

**Not a problem:** `epicRun.epicIssueId` and `epicIssueExecution.issueId` are reference keys, not full copies. These are stable identifiers that don't go stale.

### Coordinator snapshots: Fusion read (not duplication)

`BeadsCoordinatorEpicSnapshot` merges beads data (issue, tracker summary, validation) with orchestration data (runs, executions, active run/execution IDs). Built fresh each time from live queries -- not cached, not persisted. This is the correct pattern.

## Data Flow Directions

```
Beads ──reads──> Orchestration (tracker status drives scheduling)
Beads ──reads──> Orchestration (issue closure signals execution completion)
Beads <──writes── Orchestration (comments on execution lifecycle)
Beads <──writes── Agent (bd close, bd create, bd show)

Filesystem ──reads──> Orchestration (branch/path stored in events)
Filesystem <──writes── Orchestration (worktree creation/cleanup)
Filesystem <──writes── Agent (code changes, commits)

Orchestration ──pushes──> Browser (domain events via WebSocket)
Browser ──commands──> Orchestration (dispatch via WebSocket RPC)
```

**Critical: Orchestration never writes to the beads database directly.** It calls `bd` CLI for comments only. The agent writes to beads (via `bd close` etc.). This matches Symphony's pattern: the orchestrator reads, agents write.

## How Each Tool Solves State Ownership

### Symphony

- **Tracker is THE source of truth**: Linear owns all work state. Symphony polls it, never writes to it. Agents write to it via MCP tools.
- **No persistent orchestrator state**: In-memory only. On restart, re-poll the tracker and re-derive everything.
- **Workspace as filesystem state**: Each issue gets a persistent workspace directory. The filesystem is authoritative for artifacts.
- **No duplication**: Symphony doesn't snapshot tracker data. It reads fresh every tick.

### Gas Town

- **Dolt is the shared data layer**: All agents read and write to the same Dolt database. Beads issues, memories, CV entries, sling contexts -- all in Dolt.
- **Hooks as coordination state**: Work assignment lives in Dolt (hooked issues). Any agent can query any other agent's hook state.
- **Git for artifacts**: Code lives in git. Mayor maintains the canonical clone; polecats get worktrees.
- **Tight coupling but clear ownership**: Dolt owns coordination + tracking state. Git owns code. Filesystem owns worktree layout.

### Hermes Agent

- **SQLite for everything agent-side**: Sessions, messages, FTS index, schema migrations -- all in `hermes_state.py`.
- **No external tracker integration**: Hermes doesn't connect to issue trackers. All state is local.
- **Git for checkpoints**: Shadow git repos for file snapshots. Separate from the project's own git.

## Proposed Direction

### Principle: Each system is authoritative for its domain. No snapshots, only references.

| Domain                                          | Authority               | Others hold                     |
| ----------------------------------------------- | ----------------------- | ------------------------------- |
| Issue lifecycle, status, priority, dependencies | **Beads**               | Reference IDs only              |
| Thread lifecycle, sessions, turns, messages     | **Orchestration**       | Nothing (opaque to others)      |
| Code, branches, worktrees, diffs                | **Filesystem**          | Path references                 |
| Project memory                                  | **Orchestration** (new) | Injected into prompts           |
| Execution scheduling                            | **Orchestration**       | Beads provides candidate issues |

### Action 1: Replace issue link snapshots with thin references

Change `OrchestrationThreadIssueLink` from:

```typescript
{
  (issueId, title, status, priority, repoRoot, linkedAt);
}
```

to:

```typescript
{
  (issueId, repoRoot, linkedAt);
}
```

When the UI needs to display issue metadata (title, status, priority), resolve it live from beads via the existing `getIssue` RPC. The coordinator snapshot pattern already does this -- extend it to thread views.

**Cost:** One additional `bd` subprocess call when rendering a thread with an issue link. Mitigatable with short-lived caching (TTL 30 seconds).

### Action 2: Worktree validation on startup

On server startup, validate all `worktreePath` references:

- Check filesystem existence.
- Clear stale references.
- Fail plan implementation launches with missing worktrees.

### Action 3: Provider session reconciliation on restart

On startup, cross-reference `provider_session_runtime` against actual child processes:

- Sessions with no live process -> mark as `stopped`.
- Dispatch `thread.session.set` events for any mismatched state.

### Action 4: Formalize the data flow contract

Document and enforce:

- **Orchestration reads from beads** (tracker status, issue details). Never writes to beads DB.
- **Agents write to beads** (via `bd` CLI in sandbox). The agent is the actor, not the orchestrator.
- **Orchestration writes to filesystem** (worktrees only). Agents write code.
- **Orchestration owns execution state**. Beads owns work state. Neither duplicates the other.

## Pros and Cons

### Thin references (drop issue link snapshots)

| Pro                                                    | Con                                       |
| ------------------------------------------------------ | ----------------------------------------- |
| Eliminates staleness problem entirely                  | Extra subprocess call per render          |
| Single source of truth for issue data                  | Beads must be available for display       |
| Simpler orchestration schema                           | Need short-lived cache for UI performance |
| Coordinator snapshot pattern already proves this works |                                           |

### Worktree validation

| Pro                        | Con                                           |
| -------------------------- | --------------------------------------------- |
| Prevents stale path errors | Adds startup latency                          |
| Low implementation cost    | Only catches problems at startup, not runtime |

### Provider session reconciliation

| Pro                                            | Con                                           |
| ---------------------------------------------- | --------------------------------------------- |
| Prevents stuck "starting" sessions after crash | Requires process existence checking           |
| Closes the status mismatch window              | Edge case: process exists but is unresponsive |
