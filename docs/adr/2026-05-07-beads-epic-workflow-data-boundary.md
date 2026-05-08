# ADR: Separate pure beads tracker reads from T3 epic workflow runtime data

- Status: accepted
- Date: 2026-05-07
- Related beads: `t3code-ht0`, `t3code-ht0.1`, `t3code-ht0.2`, `t3code-ht0.3`, `t3code-ht0.5`, `t3code-ht0.8`, `t3code-61d`

## Context

The current beads + epic workflow implementation blurred two different data domains:

- **beads tracker state** from `bd`
- **T3 orchestration runtime state** from the orchestration read model and streams

That blending happened inside beads read APIs such as `beads.getProjectRunSummary` and `beads.getEpicCoordinationDetail`. Those APIs were then used by baseline UI surfaces like the sidebar and draft quick launch. In practice, this caused expensive cross-domain reads during startup-critical and interaction-critical paths.

Observed consequences:

- sidebar project expansion could trigger full or coordinator-style orchestration snapshot work
- draft quick-launch could fan out across full tracker reads plus per-epic workflow detail reads
- message submit / turn dispatch could end up contending with sidebar refresh work
- normal browsing paths paid orchestration hydration costs even when the UI only needed issue metadata

This violated the project priorities of performance first, reliability first, and predictable behavior under load.

## Decision

We split the boundary as follows.

### 1. `beads.*` read APIs are pure tracker APIs

Read-only `beads.*` endpoints must be backed by:

- `bd` / beads tracker data
- cheap in-memory metadata that is already owned by the beads service

They must **not** depend on orchestration SQLite snapshot hydration or `ProjectionSnapshotQuery` for baseline read flows.

### 2. T3 runtime state stays T3-owned

Live run, execution, provider-session, and orchestration lifecycle state belongs to T3 orchestration.

That data should come from:

- orchestration WebSocket streams such as `subscribeShell`
- narrow T3-owned server queries that read only the specific runtime tables needed

### 3. Cross-domain epic workflow data must be explicit

When a surface genuinely needs both beads tracker state and T3 runtime state, it must use one of these patterns:

- a clearly named scoped **epic workflow** API outside `beads.*`
- cheap frontend composition from:
  - streamed T3 run/execution state, and
  - batched beads metadata for the visible issue set

Cross-domain APIs must be:

- explicitly named as workflow/run APIs
- scoped to a project and, where possible, a single epic
- lazy, not baseline startup dependencies
- implemented without full orchestration snapshot hydration

### 4. Startup-critical orchestration subscriptions stay orchestration-only

Do not add `bd` reads into `subscribeShell` or other startup-critical orchestration queries.

The shell stream must remain focused on fast orchestration runtime recovery and live deltas. Tracker enrichment belongs in separate bounded reads.

## Accepted exceptions

The following remain acceptable:

- workflow mutation methods that intentionally bridge beads and T3 runtime state because they launch, reuse, or reconcile T3 execution threads
- explicitly named workflow-detail APIs that join bounded beads metadata with narrow run/execution reads for one selected epic
- diagnostics, tests, or compatibility paths that still need the upstream orchestration snapshot endpoint, as long as production browsing and submit flows do not depend on them

## Rejected alternatives

### Rejected: keep composed workflow reads under `beads.*`

Rejected because the name hides that the API is doing orchestration work and invites baseline UI usage in places that should stay tracker-only.

### Rejected: enrich `subscribeShell` with tracker state

Rejected because it pushes `bd` cost into startup/reconnect paths and makes orchestration recovery latency depend on tracker reads.

### Rejected: use full orchestration snapshots as the default read model for sidebar and quick launch

Rejected because the UI only needs a narrow subset of runtime state in those paths, while full snapshots increase latency, coupling, and failure surface area.

### Rejected: let each client surface compose ad hoc per-epic fan-out queries

Rejected because it recreates the same load problem through N+1 calls and makes performance regressions easy to reintroduce.

## Consequences

### Positive

- baseline beads browsing becomes cheaper and more predictable
- sidebar and quick-launch loads stop paying full orchestration snapshot costs
- submit/dispatch paths are less likely to be delayed by unrelated refresh work
- ownership becomes clearer: tracker data in beads, runtime data in orchestration, workflow composition in explicit workflow APIs

### Tradeoffs

- some existing contracts must move or be retired
- workflow surfaces may need one more explicit query instead of reusing generic beads reads
- frontend composition must be careful to batch metadata reads and avoid fan-out

## Implementation guidance

- `t3code-ht0.1`: sidebar uses streamed T3 state + batched issue metadata only
- `t3code-ht0.3`: introduce an explicit scoped epic workflow detail API outside `beads.*`
- `t3code-ht0.5`: replace quick-launch fan-out with a bounded query/composition path
- `t3code-ht0.2`: remove orchestration snapshot reads from pure beads read endpoints
- `t3code-ht0.8`: add regression guards for this boundary
- `t3code-61d`: audit remaining production snapshot endpoint usage outside this beads-specific cleanup

## Guardrails

Future changes should fail review if they do any of the following without a narrowly justified workflow API:

- add `ProjectionSnapshotQuery` to pure beads read endpoints
- add tracker reads to `subscribeShell`
- use full orchestration snapshots for sidebar, quick-launch, or message-submit-adjacent flows
- reintroduce per-epic detail fan-out for baseline UI rendering
