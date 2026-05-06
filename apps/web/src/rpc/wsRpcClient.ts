import {
  BEADS_WS_METHODS,
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  type LocalApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./protocol";
import { resetWsReconnectBackoff } from "./wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<LocalApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<LocalApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<LocalApi["shell"]["openInEditor"]>;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  /**
   * Git-specific workflows. Local repository mechanics live under `vcs`.
   */
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    /**
     * Refresh provider snapshots. Pass `{ instanceId }` to refresh a single
     * configured instance; pass no argument (or `{}`) to refresh all.
     */
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly launchPlanImplementation: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.launchPlanImplementation
    >;
    readonly cancelPlanImplementationLaunch: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.cancelPlanImplementationLaunch
    >;
    readonly retryPlanImplementationLaunch: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.retryPlanImplementationLaunch
    >;
    readonly startEpicRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.startEpicRun>;
    readonly stopEpicRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.stopEpicRun>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
  readonly beads: {
    readonly queryIssues: RpcUnaryMethod<typeof BEADS_WS_METHODS.queryIssues>;
    readonly getIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.getIssue>;
    readonly getIssues: RpcUnaryMethod<typeof BEADS_WS_METHODS.getIssues>;
    readonly resolveIssueRefs: RpcUnaryMethod<typeof BEADS_WS_METHODS.resolveIssueRefs>;
    readonly createIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.createIssue>;
    readonly updateIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.updateIssue>;
    readonly commentIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.commentIssue>;
    readonly getContext: RpcUnaryMethod<typeof BEADS_WS_METHODS.getContext>;
    readonly getIssueGraph: RpcUnaryMethod<typeof BEADS_WS_METHODS.getIssueGraph>;
    readonly validateEpicCoordination: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.validateEpicCoordination
    >;
    readonly getEpicCoordinationStatus: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.getEpicCoordinationStatus
    >;
    readonly getProjectRunSummary: RpcUnaryMethod<typeof BEADS_WS_METHODS.getProjectRunSummary>;
    readonly getEpicIssueSummaries: RpcUnaryMethod<typeof BEADS_WS_METHODS.getEpicIssueSummaries>;
    readonly getEpicCoordinationDetail: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.getEpicCoordinationDetail
    >;
    readonly getSessionActivity: RpcUnaryMethod<typeof BEADS_WS_METHODS.getSessionActivity>;
    readonly startWorkflow: RpcUnaryMethod<typeof BEADS_WS_METHODS.startWorkflow>;
    readonly startBacklogGrooming: RpcUnaryMethod<typeof BEADS_WS_METHODS.startBacklogGrooming>;
    readonly startEpicQuickRefine: RpcUnaryMethod<typeof BEADS_WS_METHODS.startEpicQuickRefine>;
    readonly startEpicPlannedRefine: RpcUnaryMethod<typeof BEADS_WS_METHODS.startEpicPlannedRefine>;
    readonly startEpicCoordinationPrep: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.startEpicCoordinationPrep
    >;
  };
}

export function createWsRpcClient(transport: WsTransport): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeTerminalEvents]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeTerminalEvents,
        }),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          { ...options, tag: WS_METHODS.subscribeVcsStatus },
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      subscribeConfig: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerConfig]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerConfig,
        }),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeServerLifecycle]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeServerLifecycle,
        }),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe((client) => client[WS_METHODS.subscribeAuthAccess]({}), listener, {
          ...options,
          tag: WS_METHODS.subscribeAuthAccess,
        }),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeShell },
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          { ...options, tag: ORCHESTRATION_WS_METHODS.subscribeThread },
        ),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      launchPlanImplementation: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.launchPlanImplementation](input),
        ),
      cancelPlanImplementationLaunch: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.cancelPlanImplementationLaunch](input),
        ),
      retryPlanImplementationLaunch: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.retryPlanImplementationLaunch](input),
        ),
      startEpicRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.startEpicRun](input)),
      stopEpicRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.stopEpicRun](input)),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
    beads: {
      queryIssues: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.queryIssues](input)),
      getIssue: (input) => transport.request((client) => client[BEADS_WS_METHODS.getIssue](input)),
      getIssues: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getIssues](input)),
      resolveIssueRefs: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.resolveIssueRefs](input)),
      createIssue: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.createIssue](input)),
      updateIssue: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.updateIssue](input)),
      commentIssue: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.commentIssue](input)),
      getContext: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getContext](input)),
      getIssueGraph: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getIssueGraph](input)),
      validateEpicCoordination: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.validateEpicCoordination](input)),
      getEpicCoordinationStatus: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicCoordinationStatus](input)),
      getProjectRunSummary: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getProjectRunSummary](input)),
      getEpicIssueSummaries: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicIssueSummaries](input)),
      getEpicCoordinationDetail: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicCoordinationDetail](input)),
      getSessionActivity: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getSessionActivity](input)),
      startWorkflow: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startWorkflow](input)),
      startBacklogGrooming: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startBacklogGrooming](input)),
      startEpicQuickRefine: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicQuickRefine](input)),
      startEpicPlannedRefine: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicPlannedRefine](input)),
      startEpicCoordinationPrep: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicCoordinationPrep](input)),
    },
  };
}
