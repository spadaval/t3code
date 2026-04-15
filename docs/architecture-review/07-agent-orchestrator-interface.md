# Agent-Orchestrator Interface

## Our Current State

Agents running inside T3 Code are **completely blind to the orchestration layer**. They can access the filesystem (code, git) and beads (issues), but they have zero visibility into:

- What thread they're in, or what other threads exist
- The plan they're implementing (beyond injected prompt text)
- Epic run progress (which issues are done, blocked, pending)
- What previous threads found or decided
- Checkpoints, diffs, or turn history
- Project memory (doesn't exist yet)

The agent also cannot drive the orchestrator. It can't schedule new work, spawn sibling threads, submit plans, or signal completion to T3 Code -- it can only signal completion to beads via `bd close`.

### Existing CLI infrastructure

- **Binary**: `t3` (`apps/server/package.json` bin field, entry at `apps/server/src/bin.ts`)
- **Framework**: `effect/unstable/cli` (Command, Flag, Argument, GlobalFlag)
- **Current commands**: Exactly one -- the root command starts the server. No subcommands.
- **Subcommand support**: The framework fully supports `Command.withSubcommands()`. The build scripts demonstrate the pattern.
- **Process runner**: `processRunner.ts` (270 lines) handles subprocess spawning with buffer limits, timeouts, JSON parsing. Used by `BeadsService` for `bd` calls. Proven pattern.

### The `bd` integration as reference pattern

The beads CLI integration is the gold standard for how a CLI tool integration works:

- `runBdProcess()` / `runBdRaw()` / `runBdJson()` helpers in `BeadsService`
- `--json` flag for structured output, parsed into typed schemas
- Concurrency control via Effect `Semaphore`
- Full metrics and tracing instrumentation
- Error handling with specific messages

## How Each Tool Solves It

### Symphony

- **Agents write to tracker**: The orchestrator never writes to Linear. State transitions, comments, PR links -- all done by the agent via `linear_graphql` MCP. The agent has full write access to the coordination layer.
- **Orchestrator reads from tracker**: Symphony polls Linear for state changes and reacts. The agent controls the system by changing issue states.
- **No direct orchestrator API**: Agents don't call Symphony. They communicate via the tracker as an intermediary.

### Gas Town

- **Rich CLI surface**: `gt` binary with 50+ subcommands. Agents call `gt sling`, `gt done`, `gt mail send`, `gt nudge`, `gt remember`, `gt prime`, `gt handoff`, `gt seance`, etc.
- **ZFC principle**: The Go binary makes zero decisions. All judgment routes to AI. Go is "dumb transport."
- **Role-scoped access**: Each role template defines which commands are appropriate. Polecats use `gt done` and `bd` commands. Witnesses use `gt nudge` and `gt mail`. Mayor uses `gt sling`.
- **Communication channels**: `gt nudge` (ephemeral, zero cost) for routine; `gt mail send` (persistent Dolt commit) for durable messages.
- **Bidirectional**: Agents read system state (`gt prime` for context, `gt seance` for history) and write actions (`gt sling` for dispatch, `gt done` for completion).

### Hermes Agent

- **Built-in tools**: 4 agent-level tools intercepted before registry dispatch: `todo` (task state), `memory` (persistent files), `session_search` (FTS history), `delegate_task` (subagent spawning).
- **48 total tools**: Including terminal, file ops, web, vision, code execution, skills management.
- **No external CLI**: Everything is in-process Python. No subprocess orchestrator interface.
- **Delegation model**: `delegate_task` spawns isolated child `AIAgent` instances. Max 3 parallel, max depth 2. Fresh context, restricted toolsets.

## Proposed Direction

### CLI over MCP

Expose orchestration to agents via `t3` CLI subcommands rather than MCP:

**Rationale:**

- **Token efficiency**: MCP tool schemas burn 2,000-3,000 tokens on definitions every turn. A CLI is one tool definition (`terminal`/`shell`) the agent already has. Help text requested on demand.
- **Provider independence**: CLI works identically for Codex and Claude. MCP support varies by provider and version.
- **Composability**: CLI tools pipe naturally (`t3 threads list --json | jq ...`). MCP tools are isolated function calls.
- **Proven pattern**: The `bd` subprocess integration already works well. `processRunner.ts` handles spawning, output capture, timeouts, JSON parsing.
- **The one MCP advantage lost**: Structured input validation at the protocol level. Mitigated by the decider's command validation -- invalid commands produce specific error messages.

### Command surface

The `t3` binary gains subcommands. The root command (server start) remains the default. New subcommands connect to the running server via WebSocket (same transport as the browser).

#### Read operations (any agent can use)

```
t3 threads list [--project ID] [--json]     # List threads in project
t3 threads show <thread-id> [--json]         # Thread details + recent messages
t3 threads search <query> [--project ID]     # FTS search across thread messages
t3 epic status <epic-id> [--json]            # Epic run progress summary
t3 memory read [--project ID]                # Read project memory
t3 diff <thread-id> [--json]                 # Get cumulative diff for a thread
t3 quality check [--project ID]              # Run quality gates
```

#### Write operations (scoped, validated through decider)

```
t3 threads create <project-id> [--json]      # Create a new thread
t3 turn start <thread-id> <message>          # Send a message / start a turn
t3 epic start <epic-id> [--json]             # Start an epic run
t3 epic stop <run-id>                        # Stop an epic run
t3 plan submit <thread-id> <file>            # Submit a plan for implementation
t3 memory write <content>                    # Write to project memory
t3 memory replace <old> <new>                # Replace content in project memory
t3 memory remove <substring>                 # Remove content from project memory
```

All commands support `--json` for structured output. Without `--json`, produce compact, agent-friendly text.

### Implementation path

1. **Add `ClientCommand` base in `cli.ts`**: Establishes WebSocket connection to running server (resolve port from config/lockfile/env var).
2. **Add subcommands via `Command.withSubcommands()`**: Each maps to an existing RPC method in `WsRpcGroup`.
3. **Output formatting**: `--json` returns raw RPC response; default returns compact text.
4. **Error formatting**: Specific messages per AGENTS.md policy.
5. **Discovery**: Agents run `t3 --help` once at session start to learn the interface.

### Agent write access -- scoping rules

Agents should be able to request orchestration actions, but with clear boundaries:

**Allowed:**

- Schedule work (start epic runs, create threads)
- Signal completion
- Write to project memory
- Submit plans for implementation
- Query any orchestration state

**Not allowed:**

- Stop or interrupt other agents' sessions
- Modify another thread's state
- Change server settings or provider configuration
- Bypass approval policies
- Delete projects or threads

The event-sourced decider already validates every command regardless of source. Agent commands flow through the same pipeline as UI commands. The scoping is enforced by which commands the CLI subcommands expose, not by a separate permission system.

## Pros and Cons

### CLI approach

| Pro                                   | Con                                            |
| ------------------------------------- | ---------------------------------------------- |
| Token efficient (one tool definition) | Extra subprocess per call (latency)            |
| Provider independent                  | No structured schema validation at call site   |
| Composable with pipes and jq          | Agent must learn CLI interface (one-time cost) |
| Proven `bd` pattern to follow         | Need server discovery mechanism (port/socket)  |
| Works in any terminal sandbox         |                                                |

### MCP approach (rejected)

| Pro                             | Con                                              |
| ------------------------------- | ------------------------------------------------ |
| Structured input/output schemas | 2,000-3,000 tokens on schemas every turn         |
| Native provider integration     | Provider-dependent (Codex vs Claude differences) |
| No subprocess overhead          | No composability between tools                   |
|                                 | New integration surface to maintain              |

### Agent write access

| Pro                                         | Con                                            |
| ------------------------------------------- | ---------------------------------------------- |
| Enables "agents as first responders" vision | Risk of agents scheduling unnecessary work     |
| Decider validates all commands (safety)     | Need clear documentation of allowed operations |
| Natural extension of the `bd` pattern       | Additional command surface to maintain         |
| Unblocks agent-driven planning workflows    |                                                |
