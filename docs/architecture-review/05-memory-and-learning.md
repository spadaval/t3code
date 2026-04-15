# Persistent Memory & Learning

## Our Current State

T3 Code has **no persistent memory or learning mechanisms.** Every new thread starts from scratch with no knowledge of what previous threads discovered, decided, or produced.

### What exists as proxies

- **Server settings persistence**: Model selection, thread env mode, streaming preference persisted in `settings.json`. User-configured, not agent-learned.
- **Beads issue tracking**: Issues create a persistent record of work. But this is external task tracking, not agent memory.
- **Proposed plans**: Plans persisted per-thread in the event store. Not reused across threads.
- **Conversation history**: `historyBootstrap.ts` can include prior messages when resuming, but this is session-scoped text truncation, not learning.
- **AGENTS.md / CLAUDE.md**: Static instruction files. Not dynamically updated by the system.

### Impact of this gap

- Agents rediscover the same project facts every session (build commands, file locations, naming conventions).
- Agents repeat mistakes that previous threads already encountered and resolved.
- Epic run issue N has no benefit from what issues 1 through N-1 learned.
- User preferences and corrections are forgotten between sessions.

## How Each Tool Solves It

### Symphony

- **No persistent memory.** Symphony is a scheduler, not a learning system.
- **Workpad pattern**: A structured comment on the Linear issue (`## Codex Workpad`) serves as cross-session shared state for a single issue. If a session dies and a new one starts, it picks up the workpad. But this is per-issue, not cross-issue.
- **WORKFLOW.md**: A version-controlled behavioral contract. Changed by humans, not by agents. Not a learning mechanism.

### Gas Town

- **`gt remember`**: Stores memories in Dolt. Shared across ALL agents. Injected at prime time (session start). Types: `feedback`, `project`, `user`, `reference`, `general`.
- **CV / Capability ledger**: Every agent has a permanent, auditable work history. Git commits attributed to agent identity. Enables capability-based routing, model A/B testing, and portable reputation. This is a career record, not just logging.
- **Seance (session archaeology)**: `gt seance` discovers previous agent sessions via `.events.jsonl` logs. Agents can query predecessors for context and decisions.
- **Desire paths**: When an agent's CLI command guess is wrong, they file a bead with `desire-path` label. This feeds back into CLI ergonomics. The system improves from agent mistakes.
- **Communication as memory**: Mail (persistent Dolt commits) and nudges (ephemeral) form a communication history that new sessions can access.

### Hermes Agent

- **Three-tier memory system**:
  - **Tier 1: MEMORY.md + USER.md**: Bounded markdown files (2,200 + 1,375 chars). Agent reads/writes via `memory` tool. Actions: `add`, `replace`, `remove`. Duplicate prevention, security scanning, capacity-aware (usage % in system prompt). Frozen snapshot pattern: writes update disk immediately but don't change the running system prompt (preserves prompt caching).
  - **Tier 2: Session search**: FTS5 full-text search over all past sessions in SQLite. Boolean operators, phrase matching, prefix matching. LLM summarization of search results. Filtered by source and role.
  - **Tier 3: External memory providers**: 8 plugins (Honcho, Hindsight, Mem0, etc.). Pluggable via abstract base class. Single-select alongside always-on built-in memory.
- **Skills as procedural memory**: After complex tasks (5+ tool calls), the agent autonomously creates skill files (markdown, agentskills.io standard). Skills self-improve during use via `patch` action. Conditional activation, platform restrictions.
- **RL training integration**: Full Atropos pipeline with trajectory generation, SFT data in ShareGPT format, reward functions with tool access.

## Proposed Direction

### 1. Project memory (Phase 1 -- high priority)

A bounded, per-project markdown file that agents read and write:

- **Storage**: `~/.t3/userdata/projects/<project-id>/memory.md`
- **Size limit**: ~2,500 characters (~1,000 tokens). Forces curation.
- **Agent interface**: `t3 memory read` / `t3 memory write <content>` / `t3 memory replace <old> <new>` / `t3 memory remove <substring>`
- **Injection**: Contents injected into every turn-start prompt as a `## Project Memory` section.
- **Frozen snapshot**: Like Hermes -- inject at turn start, don't update mid-session. Writes update disk for next session.
- **Capacity awareness**: Show usage percentage in the injected block so the agent self-manages.

Expected content: build commands, key file locations, naming conventions, architectural decisions, known gotchas, library versions, test patterns.

### 2. Session search (Phase 2 -- medium priority)

FTS5 indexing over thread messages in the existing SQLite projection tables:

- **Indexing**: Add FTS5 virtual table over `projection_thread_messages.text`.
- **Agent interface**: `t3 threads search <query> [--project ID] [--limit N]`
- **Output**: Matching messages with thread title, timestamp, and surrounding context.
- **Use case**: Agent needs to recall a decision, find how a problem was solved before, or check what was tried.

### 3. Structured handoff context for epic runs (Phase 1 -- high priority)

When epic run issue N completes, capture a structured summary for issue N+1:

- What was done (files changed, commands run)
- Key decisions made
- Problems encountered and how they were resolved
- Relevant file paths

Inject this into the next issue's turn-start prompt. This is a targeted, low-cost form of cross-session context that doesn't require general-purpose memory infrastructure.

### 4. Skills / procedural memory (Phase 3 -- future)

Agent-created markdown files describing how to perform specific tasks in the project. Self-improving via edit/patch. Loaded on demand. This is a natural extension of project memory but requires more infrastructure (skill discovery, activation, quality management).

## Pros and Cons

### Project memory

| Pro                                              | Con                                                             |
| ------------------------------------------------ | --------------------------------------------------------------- |
| High-value, low-effort                           | Agent may write low-value entries                               |
| Proven pattern (Hermes, Gas Town both do this)   | Bounded size forces tradeoffs                                   |
| Directly addresses the "rediscovery" problem     | Need conflict resolution if multiple threads write concurrently |
| Works with every provider (injected into prompt) |                                                                 |

### Session search

| Pro                                       | Con                                          |
| ----------------------------------------- | -------------------------------------------- |
| Leverages existing SQLite data            | FTS5 indexing infrastructure required        |
| Agent decides what's relevant (on-demand) | Query quality depends on agent judgment      |
| No context window cost until used         | Search latency (subprocess + query + format) |
| Scales to thousands of sessions           | May surface irrelevant old context           |

### Structured handoff

| Pro                                      | Con                                   |
| ---------------------------------------- | ------------------------------------- |
| Directly addresses epic run context gap  | Requires LLM call to generate summary |
| Compact (few hundred tokens)             | Summary quality depends on model      |
| No new infrastructure (prompt injection) | Only helps sequential epic run flow   |

### Skills / procedural memory

| Pro                                 | Con                                                 |
| ----------------------------------- | --------------------------------------------------- |
| System genuinely improves over time | Complex to manage (quality, activation, dedup)      |
| Reduces repeat work                 | Agent-written skills may be wrong or outdated       |
| Composable with project memory      | Requires skill discovery and loading infrastructure |
