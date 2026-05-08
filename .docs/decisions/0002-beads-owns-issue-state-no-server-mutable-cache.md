# Decision: beads owns issue state and server does not cache mutable reads

## Status

Accepted on 2026-05-07.

## Context

Beads is the mutable source of truth for issue metadata and workflow state in
the rebuild branch. Agents can update beads directly outside the T3 Code server
process, so a long-lived server-side read cache for issue data would create
stale reads with no reliable invalidation path.

The UI still needs responsive issue views and prompt local updates after
T3-originated writes, but that does not require the server to serve mutable
issue data from cache after a read completes.

## Decision

- Beads remains the source of truth for issue metadata and status.
- The server must not keep a mutable read-through cache for beads issue data.
- Server-side in-flight coalescing or batching of identical issue reads is
  allowed when it only deduplicates concurrent work and does not serve stale
  results after the read completes.
- Client-side caching is allowed for perceived responsiveness as long as the UI
  refetches for freshness and updates or invalidates promptly after
  T3-originated writes.
- Any future server-side mutable issue cache proposal must document its
  eventual-consistency window and how it behaves when direct external `bd`
  writes happen outside the server.

## Consequences

- Rebuild work should read mutable issue state from beads rather than a
  server-owned snapshot cache.
- Tests may preserve in-flight read coalescing, but should not rely on
  post-read server cache reuse for mutable issue data.
- Architecture and product docs should describe live beads reads as the current
  behavior.
