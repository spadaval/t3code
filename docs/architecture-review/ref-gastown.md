# Reference Architecture: Gas Town (Steve Yegge)

## Core Philosophy

Gas Town treats agent orchestration as a **mechanical engineering problem.** The central metaphor is a steam engine: agents are pistons, work is fuel, and the system's throughput depends on one thing -- when a piston finds fuel, it fires. Everything in Gas Town flows from this metaphor: the propulsion principle, the role hierarchy, the communication budget, the watchdog chain.

The foundational insight is: **agents are unreliable, so the system must be designed around that unreliability.** Individual agents will get confused, stall, crash, hallucinate, and produce bad output. The architecture compensates by layering oversight (Witness watches Polecats, Deacon watches Witnesses, Boot watches Deacon), enforcing behavioral contracts via role templates, and making all coordination state durable in Dolt so nothing is lost when sessions die.

## Worldview

Gas Town sees agent orchestration through a **factory floor** lens:

- **The Human (Overseer)** sets direction and handles exceptional situations. They don't operate the machines directly. They receive escalations when the system can't self-resolve.
- **The Mayor** is the foreman. It decomposes work, dispatches assignments, and makes strategic decisions. It's an AI agent, not a human, but it operates at a planning/coordination level rather than writing code.
- **Polecats** are the workers. They receive an assignment, execute it in isolation, and signal completion. They don't make strategic decisions, they don't communicate with each other, and they have extremely tight behavioral constraints.
- **Witnesses, Deacon, Refinery** are specialized oversight and infrastructure roles. Each exists to solve a specific class of failure mode (stalled workers, unhealthy infrastructure, merge conflicts).
- **The Go binary (`gt`)** is dumb transport. It makes zero decisions. All judgment routes to AI agents.

This is a deeply hierarchical model with clear chains of command, explicit escalation paths, and role-specific behavioral constraints that are more like military standing orders than guidelines.

## Most Important Architectural Choices

### 1. GUPP: The Gas Town Universal Propulsion Principle

**"If there is work on your Hook, YOU MUST RUN IT."**

This is the single most important design decision in Gas Town. It is the core behavioral rule enforced across ALL agents. There is no confirmation step. No "should I proceed?" No approval loop. The hook IS the assignment. The assignment IS the order to execute.

**Why this matters:** It eliminates the most common failure mode in agent systems: the agent that asks for permission instead of acting. Every role template begins with GUPP. The system's throughput is a direct function of how reliably agents follow it. GUPP turns agents from cautious assistants into autonomous workers.

**The enforcement mechanism:** GUPP is enforced through role templates (behavioral instruction), the capability ledger (permanent work record -- violations are visible), and the watchdog chain (stalled agents are nudged, then escalated, then killed).

### 2. Zero Framework Cognition (ZFC)

The Go binary makes zero decisions. It provides CLI commands, manages tmux sessions, and moves data. All judgment calls -- "is this agent stuck?", "should I escalate?", "is this merge conflict trivial?" -- route to AI agents.

**Why this matters:** It draws a clean boundary between deterministic infrastructure (process management, data storage, communication transport) and non-deterministic judgment (reasoning about code, deciding next steps, evaluating quality). Go handles the former perfectly. LLMs handle the latter imperfectly but adequately. Mixing them creates bugs in both domains.

**The exception:** The circuit breaker (3 consecutive failures -> stop retrying) is in Go, not AI. This is explicitly justified: "if failure would cause a Clown Show, it must be imperative Go." Safety mechanisms that must be reliable cannot depend on AI judgment.

### 3. Role hierarchy with behavioral templates

Eight distinct agent roles, each with a 300-500 line template that defines:

- Theory of operation (the propulsion principle adapted to their role)
- Startup protocol (exact sequence: check hook, check mail, execute)
- Capability ledger (all work permanently recorded)
- Directory discipline (which directory to work in)
- Communication hygiene (when to nudge vs. mail, explicit budgets)
- Anti-patterns (behaviors that break the system, explicitly called out)

**Why this matters:** LLMs are instruction-following machines. The more specific and structured the instructions, the more reliable the behavior. Gas Town's role templates are the most detailed agent behavioral specifications in any system we reviewed. They leave very little room for the agent to improvise in ways that break coordination.

**The key constraint philosophy:** Polecats have a mail budget of 0-1 messages per session. Dogs NEVER send mail. Witnesses may ONLY close wisps they created. The Refinery is FORBIDDEN from reading polecat code. These constraints are not suggestions -- they are load-bearing architectural decisions that prevent specific failure cascading patterns.

### 4. Three-layer Polecat architecture: Identity / Sandbox / Session

| Layer        | Lifecycle                     | Contains                                 |
| ------------ | ----------------------------- | ---------------------------------------- |
| **Identity** | Permanent                     | Agent bead, CV chain, work history, name |
| **Sandbox**  | Persistent across assignments | Git worktree, repaired on reuse          |
| **Session**  | Ephemeral (per assignment)    | Claude Code instance, context window     |

**Why this matters:** Polecats are like employees who clock in and out. The session (Claude Code instance) is disposable -- if it crashes, a new one starts. The sandbox (worktree) persists uncommitted work across session restarts. The identity (CV, history) persists across everything and enables capability-based routing.

This separation means the system recovers from Claude Code crashes without losing work (sandbox persists) and tracks agent performance across sessions (identity persists). No other system has this clean separation.

### 5. Dolt as the shared coordination layer

All coordination state lives in Dolt (a SQL database with git semantics). Beads issues, hooks, memories, sling contexts, CV entries, mail, escalations -- everything is in Dolt with atomic commits and full version history.

**Why this matters:** Every write is a Dolt commit. The entire coordination history is versioned and recoverable. Cross-agent visibility is trivial (query the database). Federation between Gas Town instances is native (DoltHub remote push/pull). There is no message bus, no event stream, no eventual consistency -- just a SQL database that happens to have git semantics.

**The cost:** Dolt is heavier than SQLite. It requires a running SQL server process (port 3307). Write contention under high agent concurrency is a real concern (hence spawn delays, communication budgets, and the nudge-vs-mail distinction to minimize Dolt commits).

### 6. Communication budget enforcement

| Channel        | Cost                                 | Budget                                  |
| -------------- | ------------------------------------ | --------------------------------------- |
| `gt nudge`     | Zero (ephemeral, injected into tmux) | Unlimited                               |
| `gt mail send` | 1 permanent Dolt commit              | Polecats: 0-1 per session. Dogs: never. |

**Why this matters:** At 20-30 concurrent agents, unconstrained communication would generate hundreds of Dolt commits per hour, creating lock contention and bloating the database. The budget system is an economic constraint that shapes agent behavior: agents learn to prefer nudges (free) over mail (expensive) naturally.

**The litmus test (from the role templates):** "If the recipient dies and restarts, do they need this message?" If yes, mail. If no, nudge. This is a clean heuristic that agents can follow reliably.

### 7. Watchdog chain with AI-based triage

```
Go Daemon (deterministic, heartbeat every 3 min)
  -> Boot (AI agent, fresh per tick, triages Deacon health)
    -> Deacon (AI agent, continuous patrol, 25 steps)
      -> Witnesses (AI agents, per-rig, monitor Polecats)
```

**Why this matters:** Each tier monitors the tier below using AI judgment (is this agent stuck? is this behavior normal?). The Go daemon provides the deterministic heartbeat that ensures the chain keeps running even if AI agents at every level crash. Boot is spawned fresh every tick specifically because it's the "watchdog of the watchdog" -- it must never have stale state.

### 8. Capability ledger and desire paths

Every agent's work is permanently recorded: git commits attributed to the agent, beads records with `created_by`, CV chains tracking success/failure rates and skills demonstrated. This enables capability-based routing (send Go work to polecats with Go track records) and model A/B testing.

**Desire paths** are a feedback mechanism: when an agent guesses a CLI command that's reasonable but wrong, they file a bead with `desire-path` label. This feeds back into CLI ergonomics improvements. The system literally learns from agent mistakes.

## Key Metrics

| Metric                     | Value                                    |
| -------------------------- | ---------------------------------------- |
| Agent roles                | 8 distinct types                         |
| Role template size         | 300-500 lines each (~2,860 total)        |
| Embedded formulas          | 47 TOML workflow definitions             |
| Designed concurrent agents | 20-30+, theoretically 50+                |
| CLI commands               | 50+ subcommands                          |
| Deacon patrol steps        | 25 (all mandatory, audited)              |
| Communication channels     | 2 (nudge: free, mail: 1 Dolt commit)     |
| Supported agent runtimes   | 10 (Claude, Codex, Gemini, Cursor, etc.) |
| Data storage               | Dolt SQL Server (MySQL protocol)         |
| Watchdog layers            | 4 (Daemon -> Boot -> Deacon -> Witness)  |

## What T3 Code Should Take From Gas Town

1. **The propulsion principle.** When work is assigned, agents execute immediately. No confirmation loops. The decider validates; the agent acts.
2. **Behavioral templates with explicit constraints and anti-patterns.** Not just "what to do" but "what you must NEVER do" and why. Gas Town's role templates are the gold standard.
3. **Communication budgets.** As T3 Code scales to multiple concurrent agents, unconstrained inter-agent communication will become a problem. Design the budget system before it's needed.
4. **The watchdog chain concept.** Stall detection isn't just a timeout -- it's a hierarchy of progressively more authoritative oversight. Start with simple timeout detection, but design the architecture to support richer monitoring later.
5. **Identity / Sandbox / Session separation.** Agent threads should have persistent identity (work history, capability tracking) separate from their ephemeral sessions.
6. **ZFC as a boundary principle.** The server should transport data and enforce invariants. Judgment calls (is this work done? should we retry? what went wrong?) should route to AI agents, not hardcoded server logic.
7. **Fleet-level observability.** The `gt feed --problems` view -- showing all agents with health status, surfacing the ones that need attention -- is the right UX for a human-in-the-loop orchestrator.
