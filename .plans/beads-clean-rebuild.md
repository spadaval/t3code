# Beads Clean Rebuild Retained Behavior Inventory

This is the working inventory for rebuilding the `beads` branch on top of fresh
`upstream/main`. It is not a roadmap milestone and it does not complete, redefine, or
replace any existing milestone beads. Keep this file in the rebuild worktree as an execution
guide; omit it from the final rebuilt branch.

The work is split across two beads epics:

- `t3code-rch` prepares the current `beads` branch by creating this temporary guide and landing cleanup that should be replayed later.
- `t3code-ir7` performs the clean rebuild on top of fresh `upstream/main`.

The rebuild goal is to preserve current issue-tracking, plan-launch, epic-run, worktree,
backlog-grooming, and UI behavior while removing branch-only sprawl and noisy history.

## Rebuild Rules

- Treat `upstream/main` as correct by default.
- Rebuild from upstream and replay intentional branch value; do not cherry-pick old commits.
- Prefer upstream-first hunk replay for central orchestration, persistence, provider, and WebSocket files.
- Replay isolated new modules by path when they have low conflict cost.
- Regenerate generated outputs from source.
- Preserve specific underlying error messages.
- Run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` before considering the rebuild complete.
- Never use `bun test`.

## Current Behavior To Preserve

### Issue Tracking

T3 Code exposes beads-backed issues as the product's Issue surface. Beads remains the source
of truth for issue metadata and status because agents can update beads directly outside the
server process.

Required behavior:

- Query, list, create, update, and comment on Issues.
- Load Issue detail, comments, labels, status, priority, parent, children, dependencies, and dependents.
- Resolve issue references for chat smart links.
- Launch issue-scoped workflows from issue context.
- Launch backlog grooming as a tracker-only workflow prompt.
- Preserve specific bd failure messages, including spawn failures, nonzero exits, stdout/stderr details, and JSON parse failures.
- Preserve in-flight bd request coalescing or batching when it does not serve stale data after completion.
- Do not keep a server-side mutable issue read cache.
- Use client-side React Query caching/refetching for UI responsiveness and freshness.

Key paths:

- `apps/server/src/beads/**`
- `apps/server/src/ws.ts`
- `packages/contracts/src/beads.ts`
- `packages/contracts/src/rpc.ts`
- `apps/web/src/lib/beadsReactQuery.ts`
- `apps/web/src/components/issue/**`
- `apps/web/src/routes/issues.tsx`
- `apps/web/src/routes/projects.$projectId.issues.tsx`

Critical tests:

- Beads service query/create/update/comment/detail/graph tests.
- bd missing/spawn failure and nonzero-exit tests.
- Cache/freshness tests should assert no stale server-side mutable issue cache remains.
- Issue list/detail/relationships/workflow action tests.
- Issue route search tests.

### Plan Implementation Launch

Plan implementation launch behavior stays current. Launches default to worktree mode today,
and that default remains part of this rebuild. Future settings may make this configurable.

Required behavior:

- Launch a proposed plan into an implementation thread.
- Prepare and persist implementation worktree metadata.
- Retry and cancel plan implementation launches safely.
- Reconstruct plan launch state from projections after restart.
- Preserve worktree path and branch metadata in thread/provider context.
- Preserve specific launch failure messages.

Key paths:

- `apps/server/src/orchestration/Layers/PlanImplementationWorkflow.ts`
- `apps/server/src/orchestration/Services/PlanImplementationWorkflow.ts`
- `apps/server/src/orchestration/tempWorktree.ts`
- `apps/server/src/persistence/Layers/ProjectionPlanImplementationLaunches.ts`
- `apps/server/src/persistence/Services/ProjectionPlanImplementationLaunches.ts`
- `packages/contracts/src/orchestration.ts`

Critical tests:

- Plan implementation workflow tests.
- Projection replay and snapshot query tests for plan launches.
- Migration tests for plan launch tables and launch metadata.

### Epic Runs

Epic runs remain serial in this rebuild. Current code should not claim that T3 Code supports
parallel epic issue execution.

Required behavior:

- Start and stop epic runs.
- Select ready issues deterministically.
- Launch one worker issue execution at a time.
- Preserve Codex fast mode for automatic worker threads.
- Preserve worker settlement barrier so a run does not advance before authoritative completion.
- Keep current shared-worktree settlement behavior: when a worker closes its assigned issue and leaves dirty changes, T3 Code commits those changes before marking the issue execution complete and launching the next issue.
- Skip settlement commits when the worktree is clean.
- Fail the run and preserve/reopen issue state when settlement fails.
- Keep stop-after-failure idempotent.
- Classify failure contexts specifically: launch failure, issue incomplete, invariant violation, environment failure, worker failure.
- Reconstruct epic run and issue execution state from projections after restart.

Key paths:

- `apps/server/src/orchestration/Layers/EpicRunScheduler.ts`
- `apps/server/src/orchestration/Layers/EpicRunScheduler.testHarness.ts`
- `apps/server/src/orchestration/Layers/EpicTrackerSnapshotReader.ts`
- `apps/server/src/orchestration/Services/EpicRunScheduler.ts`
- `apps/server/src/orchestration/Services/EpicTrackerSnapshotReader.ts`
- `apps/server/src/orchestration/epicRunSchedulerPolicy.ts`
- `apps/server/src/orchestration/epicRunWorker.ts`
- `apps/server/src/orchestration/ExecutionReconciler.ts`
- `apps/server/src/orchestration/FailurePolicy.ts`
- `apps/server/src/orchestration/EpicRunAdmissionPolicy.ts`
- `packages/shared/src/epicRun.ts`
- `packages/shared/src/epicCoordination.ts`
- `packages/shared/src/dependencyOrder.ts`

Critical tests:

- Epic run admission tests.
- Scheduler launch, settlement, completion, and failure tests.
- Dirty shared-worktree settlement commit test.
- Clean shared-worktree settlement no-op test.
- Settlement failure and issue reopen test.
- Stop-after-failure idempotency test.
- Reconciler tests for stale and non-terminal execution state.
- Dependency ordering and epic run projection tests.

### Worktree And Background Execution Infrastructure

Worktree/background execution infrastructure remains in scope because it supports isolated
execution and future review/integration flows. Review artifacts, approval, and merge queues are
future milestone work, not current rebuild scope.

Required behavior:

- Preserve worktree branch/path metadata through provider, terminal, thread, checkpoint, and projection layers.
- Create temporary worktrees for plan implementation launches.
- Keep provider command/runtime behavior that uses worktree path as the execution cwd.
- Keep checkpoint capture behavior aware of worktree context.

Key paths:

- `apps/server/src/orchestration/tempWorktree.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/terminal/**`
- `apps/server/src/vcs/**`
- `apps/web/src/worktreeCleanup.ts`
- `packages/shared/src/projectScripts.ts`

### Web UI Surfaces

UI surfaces have lower merge-conflict cost than central orchestration. Preserve useful UI
behavior, but delete the unused Kanban view.

Required behavior:

- Issue-first routes: `/issues` and `/projects/$projectId/issues`.
- Issue list filtering, sorting, and visibility state.
- Issue detail display and edit flows.
- Issue comments, labels, priority, status, parent/children/dependency/dependent display.
- Create issue dialog.
- Issue workflow actions.
- Issue smart links in chat markdown.
- Issue sidebar and linked thread navigation.
- Sidebar issue context menus.
- Draft quick launch.
- Compact epic/coordinator state presentation.
- Graph view may remain if it directly supports issue relationship understanding and stays maintainable.
- Kanban view must be removed.

Key paths:

- `apps/web/src/components/issue/**`
- `apps/web/src/components/issues-page/**`
- `apps/web/src/components/chat/BeadsIssueSmartLink.tsx`
- `apps/web/src/components/IssueSidebar.tsx`
- `apps/web/src/components/DraftQuickLaunchPanel.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/lib/beadsIssueRefs.ts`
- `apps/web/src/lib/draftQuickLaunch.ts`
- `apps/web/src/lib/epicExecutionView.ts`
- `apps/web/src/lib/epicRunPresentation.ts`
- `apps/web/src/lib/coordinatorEventLog.ts`
- `apps/web/src/hooks/useEpicCoordinatorActionRunner.ts`
- `apps/web/src/hooks/useEpicSnapshot.ts`
- `apps/web/src/store/epicRunState.ts`
- `apps/web/src/issuesRouteSearch.ts`

Critical tests:

- Issue route search parse/stringify.
- Issue list sorting/filtering.
- Issue detail edit/comment/status/priority flows.
- Issue relationships/tree logic.
- Smart link parsing/rendering.
- Sidebar context menu tests.
- Draft quick launch tests.
- Epic run state and coordinator presentation tests.

## Current Behavior Not Promised

The rebuild should not claim or ship these as current capabilities:

- Parallel epic issue execution.
- Operator review/approval before code lands.
- Review artifacts for each issue execution.
- Deterministic merge/integration queue.
- Full supervised execution milestone completion.
- Backlog health scoring or guardrails beyond the existing backlog grooming prompt.
- Remote/SSH/hosted-static endpoint side quest.
- Kanban issue planning board.

## Prune List

Prune branch-added changes for:

- `REMOTE.md`
- `.plans/19-remote-endpoints-hosted-static.md`
- `apps/server/src/remoteSetup.ts`
- `apps/server/src/cli/remote.ts`
- unrelated desktop launcher churn tied only to remote setup
- `apps/web/src/components/issues-page/KanbanBoard.tsx`
- `TESTING_REPORT.md`

Do not remove upstream remote/SSH functionality that already exists on `upstream/main`.

## Replay Path Map

Use these broad commit/domain groups as a guide. Exact commit count should follow the code shape.

### Prep Epic: `t3code-rch`

1. Create and maintain this temporary rebuild guide in the current worktree.
2. Record durable `CONTEXT.md` and ADR decisions.
3. Make targeted architecture-review wording edits.
4. Remove mutable server-side beads read cache while preserving in-flight coalescing/batching.
5. Remove avoidable `as any` casts in kept current-branch surfaces.
6. Delete the unused Kanban issue view.
7. Validate current-branch cleanup.

### Rebuild Epic: `t3code-ir7`

1. Branch baseline and replay map.
2. Beads service foundation without server-side mutable read cache.
3. Contracts and shared helpers.
4. Persistence migrations and projections rebuilt against upstream.
5. Orchestration behavior for plan launches and serial epic runs.
6. WebSocket/provider/runtime wiring.
7. Issue-first web UI and chat/sidebar integrations.
8. Unsafe `as any` cleanup in touched surfaces.
9. Generated outputs.
10. Docs and ADRs.
11. Final validation and scoped diff comparison.

## Generated Outputs

Regenerate, do not copy blindly:

- `apps/web/src/routeTree.gen.ts`
- `packages/effect-codex-app-server/src/_generated/meta.gen.ts`
- `packages/effect-codex-app-server/src/_generated/namespaces.gen.ts`
- `packages/effect-codex-app-server/src/_generated/schema.gen.ts`

Generator script changes should be kept only when required for reproducibility.

## Documentation Rules

- Keep architecture-review docs mostly intact as brainstorming/planning space.
- Ensure current-state docs do not suggest T3 Code currently supports parallel epic execution.
- Distinguish current issue/epic execution from future Supervised Execution.
- Leave milestone beads alone; they describe future work and are not part of this rebuild.
- Preserve ADRs for source-of-truth/cache policy, serial epic runs with worktree infrastructure, and shared-worktree settlement commits.
- Keep `CONTEXT.md` and ADRs in the final rebuilt branch.
- Do not keep this `.plans/beads-clean-rebuild.md` working guide in the final rebuilt branch.

## Validation

Required final gates:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

Required final comparisons:

- `git diff --stat upstream/main...HEAD`
- `git diff --stat upstream/main...beads`
- `git log --merges upstream/main..HEAD`
- Check that old merge/checkpoint/stuff commits are not reachable from the rebuilt branch.
