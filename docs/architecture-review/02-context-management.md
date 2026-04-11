# Context Management

## Our Current State

T3 Code has two layers of context management, neither of which it fully controls.

### Within-session (provider-owned)

Both Codex and Claude manage their own context windows internally:

- **Codex**: Emits `thread/compacted` JSON-RPC notifications. T3 Code observes the event (`CodexAdapter.ts:730`, `compactsAutomatically: true` at line 160) but has no influence over what Codex keeps or drops.
- **Claude**: Emits `compact_boundary` events and reports `compacting` status (`ClaudeAdapter.ts:1958-1972`). Similarly opaque.

This is a black box behind the provider boundary. We cannot inject structured summaries, protect specific messages, or implement custom compression algorithms without abandoning the app-server's thread management.

### Cross-session (T3 Code-owned, weak)

`historyBootstrap.ts` (139 lines) constructs context when resuming a session or starting a new turn. It is pure text truncation:

- Walk backwards from newest messages
- Include as many as fit within `maxChars` budget
- Drop the rest with `[N earlier message(s) omitted]`
- No summarization, no semantic selection, no structure

**Key limits:**

- `PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120,000` (per-turn input limit, `orchestration.ts:94`)
- `MAX_BUFFERED_ASSISTANT_CHARS = 24,000` (server-side message buffer)
- `MAX_THREAD_MESSAGES = 2,000` (in-memory thread message cap)

**No cross-thread context sharing exists.** Each thread is fully isolated. Epic run issue N gets no context from issues 1 through N-1 beyond what the agent happened to write to beads.

## How Each Tool Solves It

### Symphony

- **Workspace isolation**: Each issue gets its own persistent filesystem workspace. Context persists across retries via the workspace.
- **Multi-turn threading**: Up to `max_turns` back-to-back turns on the same `threadId`. First turn gets full prompt; continuation turns get only continuation guidance (avoids context duplication).
- **Workpad pattern**: A single persistent comment on the Linear issue serves as cross-session shared state (structured: plan, acceptance criteria, validation, notes). If a session dies and restarts, the new session reads the workpad.
- **No cross-issue context.** Issues are fully isolated. There is no mechanism for one agent to read another's workspace.

### Gas Town

- **Ephemeral context injection (`gt prime`)**: No persistent CLAUDE.md per directory. Full context is assembled at session start: role template (300-500 lines), role directives (operator policy), formula steps as checklist, memories from Dolt, handoff context from predecessor.
- **Session cycling with handoff**: Sessions cycle frequently. On handoff, the current session writes structured handoff mail to itself; the next session reads it at prime time. This is a deliberate context refresh mechanism.
- **Seance (session archaeology)**: `gt seance` discovers previous agent sessions via `.events.jsonl` logs. Agents can query predecessors: "What did you find?"
- **Shared memory (`gt remember`)**: Stores memories in Dolt, shared across all agents, injected at prime time. Replaces Claude's built-in filesystem memory.
- **Communication budgets**: Nudges (ephemeral, zero cost) for routine; mail (persistent Dolt commit) only when message must survive session death.

### Hermes Agent

- **Dual compression system**:
  - Layer 1 (gateway, 85% threshold): Safety net before agent processes a message. Character-based estimation.
  - Layer 2 (agent, 50% threshold): Primary compression with 4-phase algorithm:
    1. Prune old tool results (>200 chars, no LLM call)
    2. Determine boundaries (protect first 3 + last 20 messages, token-budget-based tail)
    3. Generate structured summary via LLM (Goal/Constraints/Progress/Decisions/Files/Next Steps)
    4. Assemble compressed messages (head + summary + tail)
- **Iterative re-compression**: On subsequent compressions, the previous summary is passed to the LLM with instructions to UPDATE it rather than restart from scratch. Preserves information across multiple compactions.
- **Frozen snapshot pattern**: Memory writes update disk immediately but do NOT change the running system prompt. Preserves Anthropic prompt caching (~75% cost savings). Fresh snapshot on next session start.
- **Session search**: FTS5 full-text search over all past sessions in SQLite. LLM summarization of results.
- **Pluggable context engine**: Abstract `ContextEngine` base class. Plugins can replace the built-in compressor entirely.

## Proposed Direction

### Accept the within-session constraint

Provider-owned compaction is a fact of the architecture. Fighting it (injecting summaries that get re-compacted, or abandoning app-server thread management) is worse than accepting it. Both Codex and Claude produce reasonable compaction for free.

### Invest in cross-session and orchestration-layer context

**1. Structured turn-start context injection**
When starting a turn (especially in epic runs), build a structured context block and inject it into the prompt. This is Gas Town's `gt prime` pattern adapted for T3 Code.

For epic run workers:

```markdown
## Execution Context

- Epic: "User Auth Overhaul" (7 issues)
- This issue: #3 "Implement OAuth2 flow" (P1)
- Completed: #1 "Add auth schema", #2 "Create token service"
- Key findings from prior issues: [structured summaries]
- Remaining: #4, #5, #6, #7
- Blocked: #5 (blocked by #4)
```

For regular threads:

```markdown
## Thread Context

- Project: t3code (~/Projects/t3code)
- Branch: fix/auth-bug (worktree)
- Project memory: [persistent notes]
```

**2. Project memory**
A bounded, per-project markdown file (similar to Hermes's 2,200-char MEMORY.md). Agents read and write via `t3 memory read/write`. Injected at turn start. Survives across threads.

**3. Session search**
FTS5 indexing over thread messages in the existing SQLite projections. Exposed via `t3 threads search`. Agent can query on demand rather than having everything stuffed into the prompt.

**4. Smarter `historyBootstrap`**
Replace text truncation with LLM-generated structured summaries for older messages. One-time cost at session resume. Produces much better context than `[47 earlier messages omitted]`.

## Pros and Cons

### Structured turn-start injection

| Pro                                             | Con                                |
| ----------------------------------------------- | ---------------------------------- |
| Zero latency (computed server-side before turn) | Consumes context window budget     |
| Works with every provider                       | Can't be updated mid-session       |
| Agent always has essential context              | Server must decide what's relevant |
| Cheap to implement (prompt construction)        |                                    |

### Project memory

| Pro                                   | Con                                       |
| ------------------------------------- | ----------------------------------------- |
| Cross-session knowledge accumulation  | Bounded size forces curation (also a pro) |
| Agent self-manages within constraints | Agent may write low-value entries         |
| Simple implementation (markdown file) | No semantic search (just full text)       |

### Session search

| Pro                                       | Con                                   |
| ----------------------------------------- | ------------------------------------- |
| Agent pulls context on demand (efficient) | Adds latency per query                |
| Leverages existing SQLite data            | Requires FTS5 indexing infrastructure |
| No context window cost until used         | Agent may over-query or under-query   |

### Smarter historyBootstrap

| Pro                                      | Con                                     |
| ---------------------------------------- | --------------------------------------- |
| Much better context than text truncation | LLM call adds latency at session resume |
| Structured summaries preserve key info   | Cost per resume                         |
| One-time cost, not per-turn              | Lossy by nature                         |
