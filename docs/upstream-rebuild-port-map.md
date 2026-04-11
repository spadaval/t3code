# Upstream Rebuild Port Map

This note is the execution map for `t3code-jec.2`.

## Inputs

- Shared merge-base: `afc392439345ef4f3056661cb21669da12efc233`
- Compressed source branch: `t3code/jec.1-compress-source`
- Current upstream target: `main` at `934037cb` (`upstream/main`)

Compressed source commits:

1. `b61c57a7` `feat(plan): add plan implementation workflow and proposed-plan follow-up outcomes`
2. `62517d13` `refactor(git): split git status queries and improve slow-rpc UX`
3. `c1c845db` `feat(issue-tracker): add beads-backed issue domain and issue management surfaces`
4. `a2d9ec58` `feat(epic-run-core): replace swarm orchestration with epic-run scheduler, persistence, contracts, and shared helpers`
5. `9be12b37` `feat(epic-run-ui): rebuild coordinator runtime, work graph, and client epic-run projections`
6. `e1ffe523` `docs(process): preserve planning docs, repo guidance, and non-runtime artifacts separately`

Path overlap from the merge-base:

- `166` source-only paths
- `72` direct path overlaps
- `297` upstream-only paths

Path-only counts are not enough by themselves. Some source-only files now target renamed upstream abstractions and still require manual ports.

## Hotspot Map

| Local surface on compressed branch                                                                                                                                                              | Upstream destination on `main`                                                                                                                                                                                                           | Port mode              | Notes                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/ipc.ts` `NativeApi`, `apps/web/src/wsNativeApi.ts`, `apps/web/src/wsRpcClient.ts`, `apps/web/src/wsTransport.ts`                                                        | `packages/contracts/src/ipc.ts` `LocalApi` + `EnvironmentApi`, `apps/web/src/localApi.ts`, `apps/web/src/environmentApi.ts`, `apps/web/src/rpc/wsRpcClient.ts`, `apps/web/src/rpc/wsTransport.ts`, `apps/web/src/environments/runtime/*` | Manual port            | Do not revive `NativeApi`, `nativeApi.ts`, or top-level `wsRpcClient.ts`/`wsTransport.ts`. Local shell/settings/persistence behavior belongs on `LocalApi`. Environment-bound terminal/project/git/orchestration behavior belongs on `EnvironmentApi`. Beads RPC should be added to the environment-bound surface, not pushed back into `LocalApi`. |
| `apps/web/src/store.ts`, `apps/web/src/storeSelectors.ts`                                                                                                                                       | `apps/web/src/store.ts`, `apps/web/src/storeSelectors.ts`, `apps/web/src/threadDerivation.ts`                                                                                                                                            | Manual port            | Upstream is environment-scoped: `activeEnvironmentId`, `environmentStateById`, `selectEnvironmentState`, and scoped selector factories. Local flat arrays (`projects`, `threads`, `threadIdsByProjectId`) need to be re-expressed inside `EnvironmentState`.                                                                                        |
| `apps/web/src/routes/_chat.$threadId.tsx`, thread lookup helpers, right-pane state                                                                                                              | `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`, `apps/web/src/threadRoutes.ts`, `apps/web/src/environments/primary/*`, `apps/web/src/routes/_chat.draft.$draftId.tsx`                                                          | Manual port            | Thread routes are now environment-aware. Port thread links and issue side-panel flows through `ScopedThreadRef`/`ScopedProjectRef` instead of bare `threadId`.                                                                                                                                                                                      |
| `apps/web/src/components/ChatView.tsx`, `ChatView.browser.tsx`, local composer/header/sidebar edits                                                                                             | `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/chat/ChatComposer.tsx`, `ComposerPrimaryActions.tsx`, `NoActiveThreadState.tsx`, `ThreadTerminalDrawer.tsx`, `ChatHeader.tsx`                                           | Manual port            | Upstream split ChatView responsibilities. Rebuild local behavior into current subcomponents instead of reapplying the old monolithic ChatView patch.                                                                                                                                                                                                |
| `apps/web/src/chatRouteSearch.ts`, `issuePaneStore.ts`, `IssueSidebar.tsx`                                                                                                                      | Current env-aware chat route plus upstream `diffRouteSearch.ts`                                                                                                                                                                          | Manual port            | Keep upstream diff-route handling. Layer the issue/right-pane search state onto the env-aware chat route instead of replaying the local route shape verbatim.                                                                                                                                                                                       |
| `packages/contracts/src/beads.ts`, `apps/server/src/beads/*`, `apps/web/src/components/issue/*`, `apps/web/src/lib/issue*`, `apps/web/src/lib/beadsReactQuery.ts`                               | Same paths on rebuilt branch, with environment/runtime wiring added where needed                                                                                                                                                         | Mostly additive replay | These are new domain surfaces and can mostly be copied. The main integration points are RPC registration, route wiring, `ChatHeader`, `IssueSidebar`, and coordinator screens.                                                                                                                                                                      |
| `apps/server/src/ws.ts`, `apps/server/src/server.ts`                                                                                                                                            | Same files on `main`, plus upstream auth/runtime support in `apps/server/src/auth/*`, `apps/server/src/environment/*`, `apps/server/src/orchestration/runtimeLayer.ts`                                                                   | Manual port            | Upstream `ws.ts` is now auth-aware and session-scoped. Replay beads/orchestration methods into the current layer; do not replace auth bootstrap, pairing, or runtime-layer wiring.                                                                                                                                                                  |
| `packages/contracts/src/rpc.ts`, `packages/contracts/src/orchestration.ts`, `packages/contracts/src/provider.ts`, `packages/contracts/src/providerRuntime.ts`                                   | Same files on `main`                                                                                                                                                                                                                     | Manual port            | Upstream added auth/environment/server surfaces while local adds plan, beads, and epic-run RPC/contracts. Merge both; avoid reverting upstream additions like auth streams and repository identity support.                                                                                                                                         |
| `apps/server/src/orchestration/PlanImplementationWorkflow*`, `packages/shared/src/plan.ts`, proposed-plan follow-up schemas                                                                     | Same workflow files plus current `packages/contracts/src/orchestration.ts`, `apps/server/src/persistence/*`, `apps/web/src/planImplementation.ts`                                                                                        | Manual/additive hybrid | The dedicated workflow files are additive, but orchestration RPCs, projector/decider changes, store state, and migrations still need manual ports.                                                                                                                                                                                                  |
| `apps/server/src/orchestration/EpicRun*`, `ExecutionReconciler.ts`, `FailurePolicy.ts`, `packages/shared/src/epicRun.ts`, `apps/server/src/persistence/ProjectionEpic*`, migrations `023`-`031` | Same epic-run files plus current projector/ingestion/persistence/runtime surfaces on `main`                                                                                                                                              | Manual/additive hybrid | Core epic-run files are new, but they land in a server that now has auth, repository identity resolution, provider refactors, and runtime-layer changes. Port onto those surfaces instead of replaying pre-auth assumptions.                                                                                                                        |
| `62517d13` git/runtime UX changes in `git/*`, `GitActionsControl*`, `WebSocketConnectionSurface*`, `lib/gitReactQuery.ts`, toast logic                                                          | Same files on `main`, plus current `apps/server/src/git/githubPullRequests.ts` and updated git broadcaster stack                                                                                                                         | Manual port            | Treat this as a behavior port, not a clean cherry-pick. Upstream already changed git and connection UX in overlapping places.                                                                                                                                                                                                                       |

## Replay Categories

### Additive replay candidates

These can usually be copied first and then wired into upstream entry points:

- `packages/contracts/src/beads.ts`
- `apps/server/src/beads/*`
- `apps/web/src/components/issue/*`
- `apps/web/src/components/shared/*`
- `apps/web/src/lib/beadsReactQuery.ts`
- `apps/web/src/lib/issueConstants.ts`
- `apps/web/src/lib/issueRelationships.ts`
- `apps/web/src/lib/issueTree.ts`
- `packages/shared/src/plan.ts`
- `packages/shared/src/epicRun.ts`
- `scripts/epic-run-terminology-guard.ts`

These still need normal review, but they are not blocked on a renamed upstream abstraction.

### Manual port hotspots

These should be edited directly on top of `main`:

- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/server.ts`
- `apps/server/src/codexAppServerManager.ts`
- `apps/server/src/orchestration/projector.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/web/src/store.ts`
- `apps/web/src/storeSelectors.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`
- `apps/web/src/localApi.ts`
- `apps/web/src/environmentApi.ts`
- `apps/web/src/rpc/wsRpcClient.ts`
- `apps/web/src/rpc/wsTransport.ts`

### Obsolete or drop

These should not be restored as-is on the rebuild branch:

- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/nativeApi.ts`
- `apps/web/src/wsRpcClient.ts`
- `apps/web/src/wsTransport.ts`
- `apps/web/src/routes/_chat.$threadId.tsx`
- Local-only `NativeApi` shape in `packages/contracts/src/ipc.ts`
- The compressed branch deletion of `apps/server/src/orchestration/Schemas.ts`

For `apps/web/src/diffRouteSearch.ts`, keep upstream’s current file and port the local issue-pane behavior around it. Do not replay the local deletion.

## Recommended Rebuild Order

1. Realign transport and contracts first.
   - Port `ipc.ts` from `NativeApi` to upstream `LocalApi` + `EnvironmentApi`.
   - Extend the current RPC stack in `packages/contracts/src/rpc.ts`.
   - Re-home local `wsNativeApi` behavior into `localApi.ts`, `environmentApi.ts`, and `rpc/*`.
2. Land plan/proposed-plan workflow next.
   - Replay `b61c57a7` into current orchestration, persistence, and store surfaces.
   - This establishes the newer proposed-plan shape used by later issue/coordinator flows.
3. Add the beads domain and issue tracker contracts/server pieces.
   - Replay `c1c845db` additive files.
   - Manually wire RPC registration and server handlers into the auth-aware `ws.ts`.
4. Port epic-run core on top of the current server runtime.
   - Replay additive epic-run files from `a2d9ec58`.
   - Manually merge projector, ingestion, persistence, and contract changes with upstream auth/runtime/provider changes.
5. Rebuild the web state and chat/coordinator UI.
   - Port store changes into environment-scoped slices.
   - Move ChatView/composer/issue sidebar behavior into the current ChatView decomposition.
   - Fold `62517d13` git/runtime UX changes into this pass rather than replaying it as an isolated cherry-pick.
6. Add coordinator and issue pages.
   - Replay issue/coordinator components and supporting libs.
   - Wire routes using env-aware thread/project refs.
7. Replay docs/process artifacts last.
   - `e1ffe523` is independent and can land after runtime work is stable.

## Source Commit Handling Notes

- `62517d13` should be split during replay. Its server git changes, toast changes, connection-surface changes, and ChatView edits no longer align cleanly as a single commit on `main`.
- `c1c845db` and `9be12b37` are only “mostly additive”. Their route/header/sidebar wiring touches files upstream has since reorganized.
- `a2d9ec58` replaces swarm-era concepts. Keep the epic-run intent, but port it into current upstream runtime/auth/provider structures instead of trying to preserve every pre-upstream table or control path literally.
