# Reference Architecture: Symphony (OpenAI)

## Core Philosophy

Symphony treats agent orchestration as a **scheduling problem, not an intelligence problem.** The system's job is to keep a fleet of coding agents busy on well-defined tasks. It deliberately does not plan, decompose, or make judgment calls. It reads work from an issue tracker, dispatches it to agents, and monitors completion.

The foundational insight is: **the issue tracker is the coordination layer.** There is no custom protocol for agent coordination, no message bus, no shared state database. Linear (the issue tracker) is the single source of truth. Agents read from it and write to it. Humans control agents by moving tickets between states. Symphony observes state changes and reacts.

This produces a system that is operationally trivial to reason about. If you understand the ticket board, you understand the system.

## Worldview

Symphony sees the agent orchestration problem through three distinct roles:

- **Humans plan.** They create issues with descriptions and acceptance criteria. They review PRs and approve merges. They control the system by manipulating ticket states.
- **Agents execute.** They receive a single issue, work on it autonomously, and produce a PR. They report status via tracker comments and state transitions.
- **Symphony schedules.** It reads the tracker, dispatches eligible work to agents, monitors for completion and failure, and retries when things go wrong.

These roles never bleed into each other. Symphony never decomposes a task. Agents never decide what to work on next. Humans never directly interact with running agent sessions.

## Most Important Architectural Choices

### 1. No persistent state

Symphony runs entirely in-memory. There is no database, no message queue, no persistent scheduler state. On restart, it polls the tracker and re-derives everything.

**Why this matters:** It eliminates an entire class of bugs (stale state, schema migrations, backup/restore, replication). The cost is that retry timers and session metadata are lost on restart, but since the tracker is authoritative, work is never lost -- just re-dispatched.

**The bet:** Issue trackers are reliable enough to be the only durable store. If the tracker is down, nothing works anyway. Doubling the persistence layer adds complexity without improving resilience for the failure modes that actually matter.

### 2. WORKFLOW.md as a complete behavioral contract

A single Markdown file with YAML front matter defines everything: the agent prompt, runtime settings (concurrency, timeouts, retries, polling intervals), workspace lifecycle hooks, and tracker configuration. It lives in the repo and goes through code review.

**Why this matters:** The system's behavior is version-controlled, auditable, and changeable without redeployment. There is no separate config file, no environment variable sprawl, no admin UI. One file, one truth.

**The design:** YAML front matter for machine-readable config. Markdown body for agent-facing prompt. Liquid-compatible template variables for dynamic issue context injection. Auto-reloaded on change (new dispatches use the new config; running sessions continue with their original config).

### 3. One agent per issue, no collaboration

Each issue gets exactly one agent session. There is no multi-agent collaboration, no agent-to-agent messaging, no shared context between issues. Issues are fully isolated.

**Why this matters:** It makes the system embarrassingly parallel. There are no coordination bugs, no deadlocks, no message ordering problems. Scaling is linear -- add more concurrency slots.

**The tradeoff:** Complex tasks that naturally decompose into collaborating subtasks must be broken down by humans into independent issues. The system can't handle tasks where agents need to coordinate within a single problem. This is deliberate: Symphony bets that most coding work can be expressed as independent units.

### 4. Tracker-driven control plane

Humans control the system entirely through ticket state transitions:

| Human action           | System response                     |
| ---------------------- | ----------------------------------- |
| Create issue in Todo   | Agent is dispatched                 |
| Move to In Progress    | Agent continues working             |
| Move to Human Review   | Agent stops, PR is ready for review |
| Move to Rework         | Agent picks up rework instructions  |
| Move to Merging        | Agent executes merge                |
| Move to Done/Cancelled | Agent stops, workspace cleaned up   |

**Why this matters:** There is no Symphony-specific UI to learn. Teams use their existing issue tracker workflow. The orchestrator is invisible -- it's just something that makes tickets move.

### 5. Workspace lifecycle hooks

Workspaces are created, populated, and cleaned up via configurable hooks (`after_create`, `before_run`, `after_run`, `before_remove`). The spec deliberately does not assume Git or any VCS.

**Why this matters:** The system is decoupled from any specific project setup. A workspace might be a git clone, a docker container, a remote SSH directory, or anything else. The hooks abstract away the environment.

### 6. Multi-turn continuation within sessions

Rather than treating each agent invocation as atomic, Symphony keeps the Codex app-server subprocess alive across multiple turns on the same thread (up to `max_turns`, default 20). After each turn, the worker checks tracker state and decides whether to continue.

**Why this matters:** Agent context is preserved across turns without serialization overhead. The agent can work iteratively (write code, run tests, fix issues) without losing its train of thought. The scheduler's dispatch loop is bypassed for continuation, reducing overhead.

### 7. The spec-as-distribution model

Symphony's primary artifact is SPEC.md (2,175 lines), not code. The Elixir reference implementation is explicitly labeled a prototype. The intended distribution model is: "tell your coding agent to build Symphony from the spec."

**Why this matters:** It's a meta-statement about the maturity of coding agents. If agents are good enough to build from well-written specs, then the spec IS the product. The implementation is disposable. This also means Symphony can be implemented in any language/framework that suits the team.

## Key Metrics

| Metric                        | Value                   |
| ----------------------------- | ----------------------- |
| Spec length                   | 2,175 lines             |
| Components                    | 8 main, cleanly layered |
| Default concurrency           | 10 agents               |
| Default poll interval         | 30 seconds              |
| Default stall timeout         | 5 minutes               |
| Default max turns per session | 20                      |
| Persistent state              | None                    |
| Supported trackers            | Linear (extensible)     |
| Reference implementation      | Elixir/OTP              |

## What T3 Code Should Take From Symphony

1. **The tracker-as-truth principle.** T3 Code already has beads integration. Lean into it harder -- let beads be the authoritative work state and orchestration be the execution layer.
2. **Bounded concurrency with priority dispatch.** The `max_concurrent_agents` + `max_concurrent_agents_by_state` model is simple and effective for fleet management.
3. **Stall detection with hard timeouts.** The 5-minute stall timeout with auto-kill is essential for unattended operation.
4. **Reconciliation loop pattern.** Every tick, re-check external state for all running work. Terminal work gets cleaned up promptly.
5. **Version-controlled behavioral contracts.** The WORKFLOW.md concept -- agent behavior defined in a reviewable, version-controlled file.
