# Architecture Review: Summary

**Date**: 2026-04-11
**Scope**: Comparative analysis of T3 Code against three reference orchestration systems.

## Reference Systems

| System           | Author        | Focus                                                  | Scale                              |
| ---------------- | ------------- | ------------------------------------------------------ | ---------------------------------- |
| **Symphony**     | OpenAI        | Issue-to-agent scheduler daemon                        | Fleet of 10+ single-agent sessions |
| **Gas Town**     | Steve Yegge   | Hierarchical multi-role agent orchestration            | 20-30+ concurrent agents           |
| **Hermes Agent** | Nous Research | Single-agent with memory, delegation, self-improvement | 1 agent + up to 3 subagents        |

## T3 Code's Strengths (Preserve)

1. **Event-sourced CQRS architecture** -- Pure decider/projector/reactor separation. Every state change produces a persistent, sequence-numbered event. Perfect auditability, client recovery via sequence-gap detection + replay. No other system has this level of formal state management.

2. **Clean provider abstraction** -- `ProviderAdapterShape` with 42 canonical `ProviderRuntimeEvent` types. Adding a provider means implementing one interface. Codex (child process, JSON-RPC) and Claude (in-process SDK) are cleanly normalized.

3. **Effect-based type safety** -- 16 branded entity IDs, Effect Schema validation at every boundary, typed error channels. Significantly more rigorous than any competitor.

4. **Plan mode and plan implementation workflow** -- The plan -> proposed plan -> worktree -> implementation pipeline directly supports "humans plan, agents execute." No other system has this end-to-end flow.

## Critical Gaps

1. **No parallel agent execution** -- Epic runs process issues sequentially. Every other system supports parallelism.
2. **No context management strategy** -- 24K char client-side text truncation. No structured summarization, no cross-session context.
3. **No persistent memory or learning** -- Every new thread starts from scratch. No cross-session knowledge accumulation.
4. **No quality gates** -- No automated verification of agent output (lint, test, build).
5. **No stall detection** -- No mechanism to detect or recover from hung agent sessions.
6. **No agent-orchestrator interface** -- Agents are blind to orchestration state. Can't schedule work, query progress, or write to shared memory.
7. **Blurry state ownership boundaries** -- Issue metadata duplicated between beads and orchestration with no sync mechanism.

## Key Architectural Decisions Made

### State ownership boundaries

- **Beads**: Authority on what work exists and its status. Issue lifecycle, dependencies, epics.
- **Orchestration**: Authority on execution state. Threads, sessions, turns, messages, scheduling.
- **Filesystem**: Authority on artifacts. Code, branches, worktrees, diffs.
- **Action**: Drop `OrchestrationThreadIssueLink` snapshots. Use thin references (just `issueId` + `repoRoot`), resolve live from beads at display time.

### Agent access to orchestrator

- Agents should be able to both read orchestration state and request write actions (scoped, validated through the decider).
- Agents should NOT be able to: stop other agents, modify other threads, change settings, bypass approval policies.

### CLI over MCP

- Expose orchestration to agents via `t3` CLI subcommands, not MCP.
- Rationale: token-efficient (one tool definition vs. many), provider-independent, composes naturally, follows the proven `bd` subprocess integration pattern.

### Context management strategy

- Within-session compaction is provider-owned (Codex/Claude manage their own context windows). We observe it but don't fight it.
- Cross-session context is where T3 Code adds value: structured turn-start injection, project memory, session search.

## Phased Implementation Plan

### Phase 1: Single-Agent Excellence

- Server-side context injection at turn start
- Stall detection and recovery
- Quality gate framework
- Project-level persistent memory
- Checkpoint and rollback with context undo

### Phase 2: Multi-Agent Reliability

- Parallel epic execution with isolated worktrees
- Merge queue / integration branch strategy
- Fleet-level health dashboard
- Cost budgets and aggregate tracking

### Phase 3: Self-Improving System

- Session search for cross-thread knowledge recall
- Skills / procedural memory
- Capability tracking
- Feedback loops from quality gates into planning

## Per-Concern Documents

| Document                                                                   | Concern                                 |
| -------------------------------------------------------------------------- | --------------------------------------- |
| [01-orchestration.md](./01-orchestration.md)                               | Orchestration and multi-agent execution |
| [02-context-management.md](./02-context-management.md)                     | Context management and compression      |
| [03-observability.md](./03-observability.md)                               | Observability and UX                    |
| [04-reliability.md](./04-reliability.md)                                   | Reliability and fault tolerance         |
| [05-memory-and-learning.md](./05-memory-and-learning.md)                   | Persistent memory and learning          |
| [06-quality-gates.md](./06-quality-gates.md)                               | Quality gates and verification          |
| [07-agent-orchestrator-interface.md](./07-agent-orchestrator-interface.md) | Agent-orchestrator interface (CLI)      |
| [08-state-ownership.md](./08-state-ownership.md)                           | State ownership and source of truth     |
| [09-planning.md](./09-planning.md)                                         | Planning and task decomposition         |

## Reference Architecture Profiles

| Document                             | System                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| [ref-symphony.md](./ref-symphony.md) | Symphony (OpenAI) -- Philosophy, core design decisions, key takeaways            |
| [ref-gastown.md](./ref-gastown.md)   | Gas Town (Steve Yegge) -- Philosophy, core design decisions, key takeaways       |
| [ref-hermes.md](./ref-hermes.md)     | Hermes Agent (Nous Research) -- Philosophy, core design decisions, key takeaways |
