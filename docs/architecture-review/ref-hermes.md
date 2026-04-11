# Reference Architecture: Hermes Agent (Nous Research)

## Core Philosophy

Hermes Agent treats agent orchestration as a **personal computing problem.** Where Symphony manages a fleet and Gas Town runs a factory, Hermes is a single, capable, long-lived assistant that accumulates knowledge, develops skills, and gets better at serving its user over time. The metaphor is not a scheduler or an engine -- it's a colleague who remembers everything and learns from experience.

The foundational insight is: **context is the bottleneck.** LLMs are capable enough to solve most coding problems if they have the right context. The hard problem isn't reasoning -- it's ensuring the agent has access to what it needs to know (project conventions, past decisions, user preferences, what was tried before) without blowing the context window budget. Hermes's architecture is organized around managing, compressing, persisting, and retrieving context.

## Worldview

Hermes sees agent orchestration through a **personal assistant** lens:

- **The user** is a single person (or small team) who works with the agent interactively. They provide goals, give feedback, correct mistakes, and approve dangerous operations.
- **The agent** is a persistent entity that accumulates knowledge across sessions. It remembers what the user likes, what the project conventions are, what failed before, and how to do recurring tasks.
- **Subagents** are disposable workers spawned for parallel research or isolated tasks. They get fresh context (no parent baggage), restricted toolsets, and short lifespans.
- **The system** is a single process that manages conversation state, tool dispatch, memory persistence, and context compression.

This is a depth-first model: one agent goes deep on a problem, with occasional parallel delegation for breadth. It's the opposite of Gas Town's breadth-first factory model.

## Most Important Architectural Choices

### 1. Frozen snapshot memory

MEMORY.md (2,200 chars) and USER.md (1,375 chars) are bounded markdown files that the agent reads and writes via the `memory` tool. The critical design decision: **writes update disk immediately but do NOT change the running system prompt.**

The system prompt is assembled at session start with the current memory contents, then frozen for the duration of the session. This preserves Anthropic prompt caching (~75% cost savings). Mid-session memory writes go to disk and take effect on the next session.

**Why this matters:** It decouples "what the agent remembers" from "what the agent saved." The agent can confidently write to memory without worrying about prompt cache invalidation. The user gets persistent knowledge accumulation without per-turn cost penalties.

**The capacity awareness pattern:** The system prompt shows memory usage percentage (e.g., `[67% -- 1,474/2,200 chars]`). This is a simple but powerful UX: the agent self-manages its own knowledge within constraints. When it's nearing capacity, it consolidates entries. No external garbage collection needed.

### 2. Dual compression with iterative re-compression

Two independent compression layers protect against context overflow:

| Layer             | Threshold | Purpose                                                                                                                      |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Gateway (Layer 1) | 85%       | Safety net before agent processes a message. Character-based estimation. Catches sessions that grew too large between turns. |
| Agent (Layer 2)   | 50%       | Primary compression. 4-phase algorithm with LLM summarization. Accurate, API-reported token counts.                          |

The 4-phase agent compression:

1. **Prune old tool results** (>200 chars, no LLM call) -- cheap mechanical cleanup
2. **Determine boundaries** (protect first 3 + last 20 messages, token-budget-based tail) -- never split tool_call/tool_result pairs
3. **Generate structured summary** via LLM (Goal/Constraints/Progress/Decisions/Files/Next Steps) -- the expensive step
4. **Assemble compressed messages** (head + summary + tail, clean up orphaned tool pairs)

**The iterative re-compression innovation:** On subsequent compressions, the previous summary is passed to the LLM with instructions to UPDATE it rather than starting fresh. Items move from "In Progress" to "Done," new progress is added, obsolete information removed. This preserves information across multiple compaction cycles that would otherwise be lossy.

**Why this matters:** Context management isn't a one-shot problem. Long sessions compress multiple times. Without iterative updating, each compression loses more information. With it, the summary evolves alongside the work.

### 3. Skills as procedural memory with self-improvement

After completing complex tasks (5+ tool calls), the agent autonomously creates skill files -- markdown documents following the `agentskills.io` open standard. Skills describe how to perform a specific task (e.g., "deploy to staging", "add a new API endpoint").

**The self-improvement loop:** Skills are loaded when relevant, and the agent patches them during use based on what it discovers. If a skill says "run `npm test`" but the project uses `bun run test`, the agent patches the skill. Next time, it gets the right command immediately.

**Why this matters:** This is genuine procedural memory. The agent learns not just facts (MEMORY.md) but procedures (skills). Combined with the `agentskills.io` standard, skills are portable, composable, and introspectable.

**Conditional activation:** Skills can specify `requires_toolsets` (only load when specific tools are available), `fallback_for_toolsets` (load when preferred tools aren't available), and platform restrictions. This prevents skill bloat in the system prompt.

### 4. Delegation with fresh context

`delegate_task` spawns isolated child AIAgent instances with completely fresh context. No parent conversation history. Only `goal` + `context` fields. Max 3 parallel, max depth 2.

**Restricted toolsets for children:**

- No `delegate_task` (no recursive delegation)
- No `clarify` (no user interaction)
- No `memory` (no writes to shared MEMORY.md)
- No `send_message` (no cross-platform side effects)

**Why this matters:** Fresh context is a feature, not a limitation. A child agent doing code review doesn't carry the parent's implementation bias. A child doing research doesn't waste tokens on the parent's conversation history. Isolation makes subagents more focused and cheaper.

**The budget sharing model:** Parent and child agents share a single iteration budget (default 90 turns). Two-tier pressure warnings at 70% and 90%. This prevents runaway delegation -- spawning 3 children that each spawn more work.

### 5. Checkpoint manager with context undo

Shadow git repos under `~/.hermes/checkpoints/<hash>/` capture file snapshots before destructive operations (write_file, patch, rm, mv, sed -i, git reset, etc.).

**The key innovation:** `/rollback` doesn't just restore files -- it also undoes the corresponding conversation turns so the agent's context matches the filesystem state. Without context undo, a rollback leaves the agent confused: it remembers making changes that no longer exist.

**Pre-rollback snapshots:** Before rolling back, the system automatically saves a snapshot of the current state. This enables "undo the undo."

**Why this matters:** Agents make mistakes. The ability to cleanly revert both the filesystem and the conversation state to a known-good point is a powerful safety net. It's the agent equivalent of `git reset --hard` for both code and memory.

### 6. 15+ platform gateway with unified session model

A single Hermes process connects to Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, SMS, DingTalk, Feishu, WeCom, Weixin, iMessage (via BlueBubbles), Home Assistant, webhooks, and an API server.

**Why this matters for architecture:** The gateway forced Hermes to design a session model that is truly platform-independent. The unified session key format (`agent:main:{platform}:{chat_type}:{chat_id}`) and two-level message guard system work identically across all platforms. This means the core agent logic has zero platform-specific code -- a clean separation that most systems don't achieve.

### 7. Pluggable context engine and memory providers

Both context compression and memory are pluggable via abstract base classes:

- **ContextEngine ABC**: `update_from_response()`, `should_compress()`, `compress()`. Plugins can implement knowledge DAGs, lossless context management, or any other strategy. Plugins can expose their own tools to the agent.
- **MemoryProvider ABC**: `initialize()`, `system_prompt_block()`, `prefetch()`, `sync_turn()`, `on_session_end()`, `shutdown()`. 8 provider plugins available.

**Why this matters:** Hermes doesn't bet on one context management or memory strategy. It provides a stable interface and lets the ecosystem evolve. If someone builds a better context compressor or a vector-search memory backend, it plugs in without touching the core agent loop.

### 8. RL training integration with same-sandbox reward functions

`ToolContext` gives reward functions access to the exact same sandbox the model used during rollout. The reward function can run `pytest -v` in the model's terminal, check if files were created, download artifacts for local verification. The same tools the agent used are available to the reward function.

**Why this matters:** It bridges the gap between "agent evaluation" and "agent training." Most RL for agents uses synthetic benchmarks. Hermes can train on real tasks in real environments because the reward function operates in the same context as the agent.

## Key Metrics

| Metric                   | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| Core agent class         | ~9,200 lines (single `AIAgent` class)                     |
| CLI                      | ~8,500 lines                                              |
| Gateway                  | ~7,500 lines                                              |
| Tools                    | 48 across 40 toolsets                                     |
| API modes                | 3 (chat_completions, codex_responses, anthropic_messages) |
| Memory capacity          | 2,200 chars (MEMORY.md) + 1,375 chars (USER.md)           |
| Max parallel subagents   | 3                                                         |
| Max delegation depth     | 2                                                         |
| Default iteration budget | 90 turns                                                  |
| Terminal backends        | 6 (local, docker, ssh, singularity, modal, daytona)       |
| Platform adapters        | 15+                                                       |
| Memory provider plugins  | 8                                                         |
| RL benchmarks            | 3 (TerminalBench2, TBLite, YC-Bench)                      |

## What T3 Code Should Take From Hermes

1. **Frozen snapshot memory pattern.** Write to disk immediately, inject into prompt at session start only. Preserves prompt caching while enabling persistent knowledge. Directly applicable to project memory.
2. **Structured compression summaries.** The Goal/Constraints/Progress/Decisions/Files/Next Steps template produces consistently useful summaries. Use this for handoff context between epic run issues.
3. **Iterative re-compression.** When context must be compressed multiple times, update the previous summary rather than starting fresh. Preserves information across compaction cycles.
4. **Capacity awareness in the prompt.** Showing `[67% -- 1,474/2,200 chars]` in the memory section lets the agent self-manage. Simple, effective, no external infrastructure needed.
5. **Checkpoint + conversation undo.** File rollback without context rollback leaves the agent confused. The two must be atomic. Build this into the checkpoint system.
6. **Bounded delegation with shared budget.** If T3 Code adds subagent spawning via the CLI, use a shared turn/cost budget to prevent runaway delegation.
7. **Pluggable interfaces for context and memory.** Even if the initial implementation is simple (markdown files, FTS5 search), design the interface to be replaceable. The ecosystem will evolve.
