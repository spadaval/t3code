# Product Vision

## What T3 Code Is

T3 Code is a cockpit for self-driving codebases.

It is built for senior engineers and product-minded technical operators who want to manage multiple projects, shape work at a high level, and delegate large portions of execution to agents without losing visibility or control.

The product is not just a chat UI for coding models. It is a planning, execution, and oversight system for software development work.

The core job of T3 Code is to help a strong human operator do three things well:

1. understand the state of their projects
2. turn that understanding into executable plans
3. supervise agents as those plans are carried out

## The User We Are Building For

We are building for a highly skilled senior engineer who is also capable in product thinking.

This user:

- owns or influences multiple projects at once
- can reason about product, architecture, scope, and delivery tradeoffs
- wants deep visibility, not abstraction for its own sake
- wants leverage, not hand-holding
- is comfortable making high-consequence decisions when the system presents the right information

This is not a beginner tool.
This is not optimized for "vibe coding."
This is not designed to hide complexity.
It is designed to make complex systems legible and operable.

## The Core Product Vision

T3 Code should feel like a cockpit.

A good cockpit does not remove detail. It organizes detail so the operator can understand the system quickly, make precise decisions, and intervene when necessary. It also automates routine execution so the operator spends time on judgment, not mechanical work.

In the ideal workflow, the user spends focused time in T3 Code doing high-value work:

- exploring project state
- reviewing architecture and codebase context
- shaping PRDs, epics, and issues
- making prioritization and sequencing decisions
- reviewing plans and execution quality
- approving or redirecting work

Then T3 Code takes that input and executes for hours if needed:

- opening and managing work streams
- dispatching agents against bounded tasks
- tracking progress and failures
- surfacing blockers, ambiguity, and quality risks
- bringing the human back in only when judgment is required

The product should create a tight loop between human judgment and agent execution.

Humans should spend their time on:

- deciding what matters
- defining constraints
- reviewing plans
- approving tradeoffs
- handling ambiguity
- judging quality

Agents should spend their time on:

- carrying out bounded work
- decomposing routine implementation tasks
- updating execution state
- gathering evidence
- running validations
- surfacing concrete failures
- proposing next actions

## Product Pillars

### 1. Multi-Project Control

T3 Code should provide the best possible UX for managing all active projects at once.

This means:

- clear portfolio-level visibility across repos and initiatives
- fast understanding of what is active, blocked, risky, or waiting
- the ability to move between strategy, backlog, execution, and code without losing context
- views that help the operator decide where attention is needed right now

The unit of value is not a single chat thread.
The unit of value is an entire project system.

### 2. Planning As A First-Class Surface

Planning is not a side feature. It is one of the main products.

T3 Code should provide the best possible UX for turning intent into executable work:

- product ideas into plans
- plans into epics
- epics into issues
- issues into validated execution queues

This planning loop should be interactive and iterative.
The human should be able to refine, challenge, and reshape plans before execution begins.
The system should help produce plans that are automation-safe, not just plausible on paper.

A good plan in T3 Code is:

- clear
- decomposed
- sequenced
- constrained
- observable
- ready for execution

### 3. Automated Execution With High Observability

T3 Code should automatically implement plans, but never as a black box.

Execution should be highly visible:

- what the system is doing
- why it is doing it
- what it believes is true
- what is blocked
- what failed
- what it will do next
- where human input is needed

Observability in this product is primarily for the operator, not just for backend debugging.

The standard is not merely "logs exist."
The standard is "a strong operator can understand and control the system under load, during failures, and across long-running work."

## The Autonomy Boundary

T3 Code should be ambitious about automation, but conservative about agency boundaries.

We are not trying to build an unconstrained autonomous software company in a box.
We are trying to build a system that can reliably execute meaningful software work under informed human supervision.

The default model is supervised autonomy:

- the human shapes goals, plans, and constraints
- the system executes for extended periods
- the system surfaces decisions instead of hiding them
- the operator can inspect, redirect, pause, or stop work at any point

We care much more about reliable issue-sized and epic-sized autonomy than about ultra-long-horizon unsupervised runs.

If forced to choose, we should prefer:

- correctness over speed
- clarity over magic
- explicit control over hidden heuristics
- durable execution over flashy demos

## Product Principles

### Operator First

The operator is strong and should be treated that way.
Do not over-simplify the system to the point that it becomes opaque.

### Planning And Execution Must Stay Connected

Planning that does not cleanly turn into execution is waste.
Execution without planning discipline is dangerous.

### Explainability Is A Feature

Every important system action should be understandable by a human operator.
The product should make decisions legible.

### Bounded Work Beats Vague Automation

Agents perform best when work is shaped, scoped, and validated.
The system should push toward executable units of work.

### Reliability Is A Product Requirement

Restarts, reconnects, partial streams, stale state, and agent failures are not edge cases.
They are normal operating conditions.

### Human Attention Is Precious

The system should preserve the operator's attention for judgment and direction, not status chasing or repetitive coordination.

### The Product Identity Is Above Any One Model Or Tracker

Codex, Claude, and future providers are execution engines.
Beads and future trackers are planning substrates.
Neither is the product itself.

T3 Code should own the operator experience that sits above both.

## What T3 Code Is Not

T3 Code is not:

- a thin wrapper around one coding model
- a generic chat playground
- a beginner-first IDE assistant
- an attempt to replace engineering leadership with full autonomy
- a backlog vacuum that continuously pulls work with no meaningful supervision
- a tracker-specific product disguised as a general system

## Product Implications

This vision implies several concrete product directions.

### Project Views Must Become More Important Than Thread Views

Threads matter, but they are not the top-level product concept.
The operator needs project and portfolio surfaces first.

### Planning UX Must Be Deep

Plan generation alone is not enough.
The product needs refinement loops, decomposition workflows, plan-to-tracker workflows, and clear approval boundaries.

### Backlog Quality Must Be Visible

The system should help determine whether a plan or backlog is safe to automate.
Vague or decision-shaped work should be surfaced before execution starts.

### Execution Must Be Stateful And Inspectable

Long-running work should feel supervised, not mysterious.
The operator should be able to inspect progress, reasoning, failures, retries, and decision points.

### Observability Must Serve Control

Backend tracing matters, but product observability should focus first on operator explainability:

- current state
- recent actions
- next actions
- blockers
- confidence
- intervention points

### Provider And Tracker Layers Must Stay Replaceable

We should leverage Codex, Claude, beads, and other tools aggressively, but the long-term product should not be defined by any one of them.

## Near-Term Standard For Good Product Decisions

A feature is aligned with the vision if it improves one or more of these:

- understanding the real state of multiple projects
- turning ambiguous intent into executable plans
- safely handing bounded work to agents
- supervising execution without constant babysitting
- making system behavior clearer under stress or failure

A feature is misaligned if it primarily adds:

- shallow chat convenience
- provider-specific surface area that does not improve operator control
- automation that hides state or weakens approval boundaries
- planning flows that do not translate into reliable execution

## Guiding Question

When making product decisions, ask:

Does this make T3 Code a better cockpit for a senior operator running multiple software projects with agents?

If not, it is probably not core.
