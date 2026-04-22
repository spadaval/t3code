# Milestone: Supervised Execution

## The Idea

A senior engineer should be able to delegate an epic to agents, stay informed without
babysitting, and make meaningful decisions at the right moments before anything lands.

Today, that is not possible. The operator can start an epic run and watch it. They cannot
leave, return to a structured review queue, make a judgment call on each result, and approve
or reject before the code touches the project branch. The autonomy exists but the supervision
does not. That makes "human-in-the-loop" a description of the architecture rather than a
meaningful product capability.

This milestone closes that gap.

## What Supervised Execution Means

The operator's workflow in this milestone looks like:

1. Open T3 Code and see the state of their active epics at a glance.
2. Check backlog health to confirm the epic is groomed enough to run safely.
3. Start the epic run and step away.
4. Return to a queue of execution results. Each result has a diff, a structured completion
   report from the agent, and quality gate results.
5. For each result: approve and integrate, request changes (the agent gets another pass with
   operator feedback), or discard.
6. Approved results integrate cleanly into the project branch through a deterministic,
   operator-driven integration flow.

The operator's attention goes to judgment -- is this correct, is this what I meant, is this
safe to land -- not to monitoring, status-chasing, or manually verifying that the code
compiles.

## Why This Is the Right First Milestone

The product vision is a cockpit for supervised autonomy. Most competitors bet that the agent
is good enough that oversight does not matter. T3 Code bets that it is not -- and that a
senior engineer with the right information and control surface will consistently produce better
outcomes than an unconstrained agent.

That bet only pays off if the oversight tooling is genuinely better, not just present. An
operator watching a progress bar is not supervision. An operator reviewing a structured
artifact -- diff, completion report, quality signals -- and making an explicit approval
decision before the code lands is supervision.

The PR review analogy is deliberate. PR review is a solved problem with twenty years of
tooling wisdom behind it. The insight is that each epic issue execution is a PR: the agent is
the author, the operator is the reviewer, CI is the quality gate, and merge happens only after
approval. T3 Code is not inventing a new process. It is applying a proven one to a new kind
of author.

This also establishes the foundation for everything that comes after: multi-agent planning
workflows, Dream mode self-improvement, and eventually higher concurrency all depend on having
a reliable single-execution review loop first.

## Competitive Read

This milestone should stay different from the reference systems in a few important ways.

**Unlike Symphony, T3 Code should keep execution state durable and first-class in the
product.** Symphony is right that the tracker should own work state, but its scheduler is
deliberately invisible. That is not enough for supervised execution. The operator needs a
durable review queue, restart-safe execution state, and a product surface that makes judgment
calls explicit rather than incidental.

**Unlike Gas Town, T3 Code should not require a role hierarchy to deliver value.** Gas Town's
factory model is powerful, but it assumes a much larger orchestration surface: mayor, witness,
refinery, watchdogs, convoys. The first milestone should get the single-worker review loop
right before introducing agent societies.

**Unlike Hermes, T3 Code should optimize for supervised project execution, not a personal
assistant that accumulates broad long-lived memory.** Persistent memory and delegation matter,
but they are follow-on multipliers. The immediate problem is making one execution easy to
trust, review, and integrate.

The reference systems also point to patterns we should adopt now:

- Beads remains the source of truth for issue metadata and status. T3 Code should store issue
  references, not stale issue snapshots.
- The system needs a problems-first operator view: what is running, what is stalled, what is
  blocked, and what is waiting for review.
- Stall detection must pair with reconciliation. Timeouts without restart-safe recovery are not
  enough.
- Quality gates should compare post-execution results against a baseline so new failures block
  while pre-existing failures are surfaced and tracked, not silently waived away.
- Execution policy should be versioned in the repo: required gates, timeout policy, cleanup
  rules, and approval defaults should be reviewed like code.

## What Changes

### Issue-First Navigation

The current UI surfaces threads as the primary execution concept. Running an epic requires
navigating through coordinator state and tab-based routing that was designed around a different
model of how work happens.

This milestone ships a navigation redesign where issues, epics, and runs are the primary
surfaces. Threads remain available as drill-down detail. The operator sees what is running,
what needs review, and what is blocked -- without hunting through thread history to reconstruct
execution state.

Issue metadata is resolved live from beads. T3 Code stores references to issues and executions;
it does not become a second issue tracker with stale copies of title, status, or priority.
That boundary keeps the UI trustworthy under long-running sessions and restarts.

This is the prerequisite surface for everything else in the milestone. The review queue has to
exist before the operator can use it.

### The Execution Review Surface

Each epic issue execution produces a reviewable artifact before any integration action is
available:

**Diff.** What the agent actually changed, scoped to the worker branch against its base
commit. Not the full thread history -- just the delta this execution produced. Large diffs
degrade gracefully with summary stats and expandable file sections.

**Completion report.** A structured summary the agent produces before signaling done: what
was changed, what was verified, what acceptance criteria were addressed, and what was
explicitly not addressed and why. This is the PR description equivalent. It gives the operator
a review entry point without reading the diff cold.

**Quality gate results.** Configurable per-project commands -- typecheck, lint, tests --
run automatically against the worker branch after the agent signals completion. Results are
surfaced alongside the diff and completion report. Required gates that fail block approval by
default. The system also captures a baseline before execution so it can distinguish new failures
from pre-existing ones. New failures block. Pre-existing failures stay visible and must be
tracked, not ignored.

These three artifacts together answer the question the operator actually needs answered: did
the agent do what the issue asked, and is the result correct?

### Worktree Isolation

Each epic issue execution runs in its own git worktree on its own branch. Workers do not share
a mutable project workspace. This is the prerequisite for the review surface: without an
isolated branch, there is no clean diff boundary and no safe integration gate.

The worktree lifecycle is explicit and restart-safe. Each execution gets a deterministic
branch name and worktree path, persisted ownership metadata, and defined cleanup rules for
every outcome: successful completion (preserve for integration), failure (preserve for
inspection and retry), stop before useful output (remove promptly), discard (remove
explicitly).

Restart safety includes reconciliation. On startup and periodically, the system validates that
the worktree still exists, the provider session is still real, and the execution state still
matches reality. Broken references become explicit review states, not silent corruption.

The system supports serial execution now and concurrent execution later without architectural
rework. Concurrency is not the goal of this milestone.

### Operator Approval and Integration

The operator has three actions on any completed execution:

**Approve and integrate.** The result enters the integration queue. Integration is
operator-driven and serialized: one active integration attempt per run, deterministic ordering
by sequence number. The project branch is never mutated without an explicit operator action.

**Request changes.** The operator provides structured feedback. The agent receives it as a
new turn in the worker thread and makes another pass. The execution returns to in-progress.
Round trips are tracked and capped.

**Discard.** The execution is abandoned. The worker branch is preserved for inspection but
does not integrate. The worktree is cleaned up.

Phase-one supervised execution assumes `require-approval` by default and does not depend on
auto-integrate modes for success. Automation policies can come later, once the review surface,
quality gates, and integration flow are trusted.

### Stall Detection

A hung worker session occupies a worktree slot and gives the operator no signal. Stall
detection tracks the last event timestamp per active execution, fires a configurable timeout
(default five minutes), and surfaces the stall status in the operator queue. If auto-interrupt
is enabled, the session is interrupted and the execution moves to review with stall status. A
reconciliation loop re-checks active executions against live provider and tracker state so
stalls, dead sessions, and externally changed work do not remain ambiguous.

Stalled executions do not block the integration queue.

### Backlog Health

The review surface is only as good as the issues that feed it. Vague acceptance criteria
produce vague completion reports. Decision-shaped issues produce agent confusion. Backlog
health makes this visible before execution starts.

The system computes a project-level backlog health snapshot from existing tracker signals:
open, ready, blocked, stale, lint warnings, decision-shaped issues. Findings are grouped by
severity with specific per-issue reasons and recommended actions. The operator sees a top-line
status and the highest-severity findings before launching a run.

This is the pre-flight check. It closes the loop: plan, groom, execute, review, integrate.

### Versioned Execution Contract

Every project needs a reviewed execution contract in the repository. This is where required
quality gates, timeout policy, cleanup behavior, and approval defaults live. The point is not
to create another settings screen. The point is that operator expectations and agent execution
rules should be visible, reviewable, and change-controlled alongside the code they govern.

## What This Milestone Is Not

This milestone is not about concurrency. Running multiple issues in parallel is an extension
of the isolated execution model that this milestone builds. It is not the goal.

This milestone is not about autonomous execution. The approval gate is real and the default
policy requires it. The system should make review easy and fast, not bypass it.

This milestone is not about AI planning or decomposition. Humans, or T3 Code's existing plan
mode, define the work. Supervised execution starts once the backlog is ready.

This milestone is not about multi-agent planning or Dream mode self-improvement. Both depend
on accumulated execution history with structured quality signals that this milestone generates.
They are the right next investments after this one ships.

## The Standard for Done

The milestone is complete when a senior engineer can:

- See their active epics and execution state without navigating coordinator tab state.
- See running, stalled, blocked, failed, and needs-review executions from a single operator
  surface.
- Confirm a backlog is groomed enough to run.
- Start an epic run, step away, and return to a meaningful review queue.
- Review each execution result -- diff, completion report, quality gates -- and make an
  approval decision from a single surface.
- Trust that issue metadata reflects the live tracker state rather than stale orchestration
  snapshots.
- Restart the server and still recover the correct execution, worktree, and review state.
- Trust that nothing lands on the project branch without their explicit action.

If all of that works end-to-end, T3 Code is no longer a tool that requires the operator to
watch agents work. It is a tool that lets agents work and brings the operator back in when
judgment is required.

That is what supervised execution means.
