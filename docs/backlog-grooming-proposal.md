# Backlog Grooming Proposal

## Problem

T3 Code already has good epic-level swarmability checks, but it does not have a project-level
backlog quality loop.

That leaves a dangerous gap:

- the coordinator can tell us whether one epic is structurally launchable
- the issue tracker UI can show raw issues
- neither surface answers "is this backlog safe to hand to an automated swarm right now?"

If we point automated execution at a vague or mis-sequenced backlog, the system will do exactly
what we asked, not what we meant.

## What Exists Today

The current implementation already has useful building blocks:

- `beads.validateEpicSwarm` and `beads.getIssueGraph` expose epic-specific structure and dependency
  state
- the coordinator UI surfaces validation errors, warnings, ready wavefronts, and blocked work per
  epic
- epic quick refine, planned refine, and coordination prep workflows already exist and can drive
  tracker-only cleanup work through Codex

Those are good execution-time tools. They are not a backlog grooming system.

## Current Repo Findings

The current backlog is not a disaster, but it is not automation-safe either.

Observed on 2026-04-09:

- `bd lint` reports 3 template warnings
- `bd blocked` reports 9 blocked issues out of 25 open issues
- `bd doctor --check=conventions` cannot provide db-backed lint/stale checks in this environment
- `bd preflight` is generic and not useful as a T3 Code backlog-quality gate

Concrete examples from the current backlog:

- `t3code-a2k` is ready work, but its description is a single paragraph and it is missing
  acceptance criteria
- `t3code-uhn` is a decision-shaped issue; it was improved, but it still represents "decide the
  intended behavior" rather than directly executable implementation work
- `t3code-o5d` is an open swarm/molecule issue with very little actionable content and should not be
  treated as normal execution inventory

This is the important pattern: some of the data needed to detect backlog risk already exists, but
it is spread across `bd` commands, tracker conventions, and operator intuition.

## Goals

We should add a regular backlog grooming loop with two outputs:

1. machine-usable backlog health signals
2. operator-facing explanations and next actions

The system should help answer:

- which issues are too vague to execute safely
- which open issues are really unresolved decisions
- which dependencies are suspicious, missing, or overly serializing the queue
- which blocked issues matter most
- whether the project backlog should be groomed before swarm execution continues

## Proposed Changes

### 1. Add a Project-Level Backlog Health Snapshot

Add a first-class server-side snapshot, separate from epic swarm validation.

Suggested contents:

- summary counts: open, ready, blocked, stale, lint warnings, decision-shaped issues
- findings grouped by severity: `error`, `warning`, `info`
- per-finding issue references plus a concrete reason
- derived recommendations such as:
  - "rewrite issue before execution"
  - "resolve decision and close or convert to implementation issue"
  - "fix dependency graph before swarm launch"
  - "run grooming workflow"

Suggested inputs:

- `bd list --status=open --json --limit 0`
- `bd ready --json`
- `bd blocked --json`
- `bd lint --json`
- `bd stale --json`
- `bd orphans`

Suggested first-pass heuristics:

- missing required sections from `bd lint`
- issue descriptions that are too short or are single-paragraph "why/what" blobs
- decision-shaped titles such as `decide`, `investigate`, `revisit`, `replan`, `proposal`
- molecule/swarm tracker artifacts presented as normal open work
- high blocked count concentrated behind one prerequisite

Important constraint:

- findings must stay specific; do not collapse to vague labels like "bad backlog quality"

### 2. Surface Backlog Health in the UI

Add a project-level backlog health panel to the issues/coordinator experience.

The operator should be able to see:

- a top-line status such as `healthy`, `needs grooming`, or `unsafe for automation`
- the highest-severity findings first
- which issues need rewriting, closure, dependency repair, or reclassification
- whether the project is safe to launch new swarm work without cleanup

This should be a project-level surface, not something buried inside one epic detail view.

### 3. Add a Backlog Grooming Workflow

Add an explicit "Open backlog grooming thread" action that starts a project-level thread seeded with
the latest backlog health findings.

The workflow should instruct the model to:

- use `bd` directly
- rewrite vague issues into executable issues
- split or supersede decision issues
- repair dependency edges when the intended order is clear
- file follow-up issues when the ambiguity cannot be resolved safely
- avoid code changes; this is tracker-only work

This turns backlog grooming into a repeatable operation instead of a manual ritual.

### 4. Add Automation Guardrails

Backlog health should not just be informational.

Recommended policy:

- soft gate swarm start when project-level backlog health is red
- warn before starting runs if unresolved backlog-health errors exist
- show "groom first" as the primary action when the backlog is unsafe
- allow override, but make the risk explicit

This keeps automation aligned with operator intent without making the system brittle.

## Rollout Plan

### Phase 1

- ship the backlog health snapshot in the server/contracts layer
- compute concrete findings from existing `bd` commands

### Phase 2

- surface the snapshot in the issues/coordinator UI
- make the highest-severity findings obvious and actionable

### Phase 3

- add the project-level backlog grooming workflow thread
- seed the prompt with findings and recommended tracker actions

### Phase 4

- add swarm-launch guardrails driven by backlog health severity
- tune heuristics based on real backlog false positives and misses

## Non-Goals

- fully automatic dependency repair without operator visibility
- replacing epic coordination validation
- inventing opaque scores that hide the underlying reasons

## Recommendation

Do not treat backlog grooming as a docs-only process.

The right model is:

- server computes backlog health
- UI makes the risks visible
- workflow makes grooming cheap
- swarm launch respects the result

That gives us a regular loop instead of periodic cleanup bursts after the backlog has already
degraded.
