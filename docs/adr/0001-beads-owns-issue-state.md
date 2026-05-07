# Beads Owns Issue State

Beads is the source of truth for issue metadata and status because agents can update the beads database outside T3 Code's process, and there is no reliable change notification channel back to T3 Code. T3 Code may use client-side React Query caching and optimistic updates for responsiveness, but server-side issue read caches should be avoided unless a specific UI need justifies a short, explicit eventual-consistency window.
