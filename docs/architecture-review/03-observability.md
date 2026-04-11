# Observability

## Our Current State

T3 Code has solid observability foundations but is missing fleet-level views that a human-in-the-loop orchestration tool needs.

### Server-side

- **Logs**: Pretty console output to stdout (`Logger.consolePretty()`). Not persisted.
- **Traces**: NDJSON trace file at `serverTracePath` (default `~/.t3/userdata/logs/server.trace.ndjson`). Completed spans with name, traceId, spanId, durationMs, attributes, events, exit status.
- **OTLP export**: Optional traces + metrics to Grafana/Tempo/Prometheus. Configurable via `T3CODE_OTLP_TRACES_URL` and `T3CODE_OTLP_METRICS_URL`.
- **Provider event logging**: Both native and canonical events logged to NDJSON via `EventNdjsonLogger` at `~/.t3/userdata/logs/provider/events.log`.
- **RPC instrumentation**: `observeRpcEffect`, `observeRpcStream`, `observeRpcStreamEffect` in `ws.ts`.

**Key file:** `docs/observability.md` (519 lines) -- comprehensive docs for the existing observability system.

### Client-side

- **Activity timeline**: Combines chat messages, work log entries, proposed plans, turn diff summaries, pending approvals, user inputs, plan steps, token usage, and session status into a per-thread timeline.
- **Streaming**: Assistant text streamed via `content.delta` events. Token usage snapshots include detailed breakdowns.
- **Cost tracking**: `totalCostUsd` per turn in `turn.completed` events.
- **Client tracing**: `observability/clientTracing.ts` for client-side spans.

### What's missing

- **No fleet-level view**: Can't see all active threads/agents at once with health status.
- **No stall/problem detection surface**: No equivalent to Gas Town's "problems" view.
- **No aggregate cost dashboard**: Cost is tracked per-turn but not aggregated per-thread, project, or epic.
- **No agent capability/performance tracking**: No record of which models produce better outcomes.

## How Each Tool Solves It

### Symphony

- **Structured logging**: All issue-related logs include `issue_id` and `issue_identifier`. Session logs include `session_id`. Key=value formatting.
- **Token accounting**: Input/output/total tokens per session and aggregated across the service. Prefers absolute thread totals over deltas. Tracks rate-limit payloads.
- **Runtime snapshot API**: JSON API (`/api/v1/state`) exposes running sessions, retry queues, aggregate token/runtime totals, and rate limits. Per-issue detail at `/api/v1/<identifier>`.
- **Phoenix LiveView dashboard**: Real-time dashboard showing active sessions, retry delays, token consumption.
- **Humanized event summaries**: Optional layer translating raw Codex events into human-readable status lines.

### Gas Town

- **TUI feed (`gt feed`)**: Three-panel interactive terminal dashboard:
  - Agent Tree: hierarchical view of all agents by rig and role
  - Convoy Panel: in-progress and recently-landed work batches
  - Event Stream: chronological feed of creates, completions, slings, nudges
- **Problems view (`gt feed --problems`)**: Surfaces agents needing intervention by health state: GUPP Violation (hooked work, no progress), Stalled, Zombie (dead session, open hook), Working, Idle.
- **Web dashboard (`gt dashboard`)**: htmx-based dashboard with command palette.
- **OpenTelemetry**: Structured logs and metrics (session starts, bd calls, polecat spawns, convoy creates).
- **Patrol step banners**: Deacon and Refinery print structured banners at each patrol step for visibility.
- **Capability ledger**: Every agent's work permanently recorded. Git commits with `GIT_AUTHOR_NAME` set to agent identity. Enables performance tracking, capability-based routing, model A/B testing.
- **Model evaluation harness**: `gt-model-eval/` directory with promptfoo for A/B testing models.

### Hermes Agent

- **KawaiiSpinner**: Animated CLI progress with tool-specific emojis and activity feed.
- **Tool preview in spinner**: Shows tool name and args as they're parsed from streaming.
- **`/usage` command**: Token counts, estimated cost, cache hit rates per session.
- **`/insights` command**: Usage statistics over configurable time periods.
- **Trajectory saving**: ShareGPT-compatible JSONL format with tool statistics per trajectory.
- **Streaming token display**: Real-time response rendering with reasoning display.

## Proposed Direction

### 1. Fleet-level health dashboard

A new panel (or route) showing all active threads/sessions across all projects:

| Thread       | Status  | Provider      | Duration | Tokens | Cost  | Health  |
| ------------ | ------- | ------------- | -------- | ------ | ----- | ------- |
| Fix auth bug | running | codex/gpt-5.4 | 3m       | 45K    | $0.12 | healthy |
| Add tests    | stalled | claude/sonnet | 8m       | 0      | $0.00 | stalled |
| OAuth flow   | ready   | codex/gpt-5.4 | --       | 120K   | $0.34 | idle    |

Health states derived from provider event recency:

- **Working**: Recent provider events within expected interval
- **Stalled**: No events within configurable timeout
- **Blocked**: Pending approval request unanswered
- **Error**: Session in error state
- **Idle**: Session ready, no active turn

This is directly inspired by Gas Town's `gt feed --problems` view. The data already exists in the orchestration read model -- this is purely a projection + UI concern.

### 2. Aggregate cost tracking

Roll up `totalCostUsd` from turn completions into:

- Per-thread cumulative cost
- Per-project cumulative cost
- Per-epic-run cumulative cost
- Global session cost

Surface in the fleet dashboard and per-thread views. The turn-level data is already produced by providers -- this is aggregation and display.

### 3. Epic run progress visualization

For active epic runs, a purpose-built view showing:

- Issue dependency graph with completion status
- Which issues are in progress, completed, blocked, pending
- Per-issue cost and duration
- Failure history and retry counts

### 4. Agent activity attribution

Track which models/configurations produce which outcomes:

- Completion rate per model
- Average turns to completion
- Cost per completed issue
- Error/retry rates

This is a lighter version of Gas Town's capability ledger. Store as aggregated metrics (not per-event attribution -- too expensive). Surface in settings or a dedicated analytics view.

## Pros and Cons

### Fleet-level dashboard

| Pro                                      | Con                                   |
| ---------------------------------------- | ------------------------------------- |
| Essential for human-in-the-loop at scale | UI development effort                 |
| Data already exists in read model        | Need to define "health" heuristics    |
| Differentiating feature for product      | Additional real-time event processing |

### Aggregate cost tracking

| Pro                                        | Con                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| Low effort (data exists, need aggregation) | Cost calculation accuracy depends on provider reporting |
| Enables budget controls later              |                                                         |
| Users need to understand spend             |                                                         |

### Agent activity attribution

| Pro                                       | Con                                                  |
| ----------------------------------------- | ---------------------------------------------------- |
| Enables data-driven model selection       | Harder to attribute quality (not just completion)    |
| Low-cost metrics aggregation              | Meaningful comparison requires controlled conditions |
| Feeds into capability-based routing later |                                                      |
