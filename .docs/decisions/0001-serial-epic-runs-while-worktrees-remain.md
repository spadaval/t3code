# Decision: serial epic runs while worktree infrastructure remains

## Status

Accepted on 2026-05-07.

## Context

The clean rebuild keeps the issue-tracking and epic-run workflow, along with the
worktree and background-worker infrastructure that supports isolated execution,
worker lifecycle management, and future review or integration flows.

At the same time, the rebuilt branch should not present parallel epic execution
as current behavior. The scheduler and settlement path need to stay
deterministic while the shared-worktree execution model remains in place.

## Decision

- Epic runs execute assigned issues serially in the rebuilt branch.
- Shared-worktree settlement keeps the current auto-commit behavior after a
  worker closes its assigned issue and before the scheduler advances.
- Worktree paths, worktree metadata, and background execution infrastructure
  remain in scope and in the architecture.
- Architecture and planning docs may discuss future concurrency, but current
  product and architecture docs must describe serial epic execution as the
  shipped behavior.

## Consequences

- Current-state docs must not claim that parallel epic execution is available.
- Rebuild work should preserve deterministic scheduler policy.
- Rebuild work should preserve shared-worktree settlement auto-commit behavior
  until worker behavior becomes configurable.
- Future concurrency work can build on the retained worktree and background
  execution infrastructure instead of reintroducing it later.
