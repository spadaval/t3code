import {
  BEADS_WS_METHODS,
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type GitStatusResult,
  type GitStatusStreamEvent,
  type NativeApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./rpc/protocol";
import { resetWsReconnectBackoff } from "./rpc/wsConnectionState";
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
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<NativeApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<NativeApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<NativeApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.gitRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeGitStatus>,
      listener: (status: GitStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly workingTree: RpcUnaryMethod<typeof WS_METHODS.gitWorkingTree>;
    readonly currentPullRequest: RpcUnaryMethod<typeof WS_METHODS.gitCurrentPullRequest>;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
  };
  readonly beads: {
    readonly queryIssues: RpcUnaryMethod<typeof BEADS_WS_METHODS.queryIssues>;
    readonly getIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.getIssue>;
    readonly updateIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.updateIssue>;
    readonly commentIssue: RpcUnaryMethod<typeof BEADS_WS_METHODS.commentIssue>;
    readonly getContext: RpcUnaryMethod<typeof BEADS_WS_METHODS.getContext>;
    readonly getSwarmSupport: RpcUnaryMethod<typeof BEADS_WS_METHODS.getSwarmSupport>;
    readonly getIssueGraph: RpcUnaryMethod<typeof BEADS_WS_METHODS.getIssueGraph>;
    readonly getEpicSwarm: RpcUnaryMethod<typeof BEADS_WS_METHODS.getEpicSwarm>;
    readonly validateEpicSwarm: RpcUnaryMethod<typeof BEADS_WS_METHODS.validateEpicSwarm>;
    readonly getEpicSwarmStatus: RpcUnaryMethod<typeof BEADS_WS_METHODS.getEpicSwarmStatus>;
    readonly listSwarms: RpcUnaryMethod<typeof BEADS_WS_METHODS.listSwarms>;
    readonly getProjectCoordinatorSnapshot: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.getProjectCoordinatorSnapshot
    >;
    readonly getEpicCoordinatorSnapshot: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.getEpicCoordinatorSnapshot
    >;
    readonly getSessionActivity: RpcUnaryMethod<typeof BEADS_WS_METHODS.getSessionActivity>;
    readonly startWorkflow: RpcUnaryMethod<typeof BEADS_WS_METHODS.startWorkflow>;
    readonly startEpicQuickRefine: RpcUnaryMethod<typeof BEADS_WS_METHODS.startEpicQuickRefine>;
    readonly startEpicPlannedRefine: RpcUnaryMethod<typeof BEADS_WS_METHODS.startEpicPlannedRefine>;
    readonly startEpicCoordinationPrep: RpcUnaryMethod<
      typeof BEADS_WS_METHODS.startEpicCoordinationPrep
    >;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
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
    readonly startSwarmRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.startSwarmRun>;
    readonly continueSwarmRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.continueSwarmRun>;
    readonly pauseSwarmRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.pauseSwarmRun>;
    readonly resumeSwarmRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.resumeSwarmRun>;
    readonly cancelSwarmRun: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.cancelSwarmRun>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
}

let sharedWsRpcClient: WsRpcClient | null = null;

export function getWsRpcClient(): WsRpcClient {
  if (sharedWsRpcClient) {
    return sharedWsRpcClient;
  }
  sharedWsRpcClient = createWsRpcClient();
  return sharedWsRpcClient;
}

export async function __resetWsRpcClientForTests() {
  await sharedWsRpcClient?.dispose();
  sharedWsRpcClient = null;
}

export function createWsRpcClient(transport = new WsTransport()): WsRpcClient {
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
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.gitRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: GitStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeGitStatus](input),
          (event: GitStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          options,
        );
      },
      workingTree: (input) =>
        transport.request((client) => client[WS_METHODS.gitWorkingTree](input)),
      currentPullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitCurrentPullRequest](input)),
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
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
    },
    beads: {
      queryIssues: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.queryIssues](input)),
      getIssue: (input) => transport.request((client) => client[BEADS_WS_METHODS.getIssue](input)),
      updateIssue: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.updateIssue](input)),
      commentIssue: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.commentIssue](input)),
      getContext: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getContext](input)),
      getSwarmSupport: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getSwarmSupport](input)),
      getIssueGraph: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getIssueGraph](input)),
      getEpicSwarm: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicSwarm](input)),
      validateEpicSwarm: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.validateEpicSwarm](input)),
      getEpicSwarmStatus: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicSwarmStatus](input)),
      listSwarms: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.listSwarms](input)),
      getProjectCoordinatorSnapshot: (input) =>
        transport.request((client) =>
          client[BEADS_WS_METHODS.getProjectCoordinatorSnapshot](input),
        ),
      getEpicCoordinatorSnapshot: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getEpicCoordinatorSnapshot](input)),
      getSessionActivity: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.getSessionActivity](input)),
      startWorkflow: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startWorkflow](input)),
      startEpicQuickRefine: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicQuickRefine](input)),
      startEpicPlannedRefine: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicPlannedRefine](input)),
      startEpicCoordinationPrep: (input) =>
        transport.request((client) => client[BEADS_WS_METHODS.startEpicCoordinationPrep](input)),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
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
      startSwarmRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.startSwarmRun](input)),
      continueSwarmRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.continueSwarmRun](input)),
      pauseSwarmRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.pauseSwarmRun](input)),
      resumeSwarmRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.resumeSwarmRun](input)),
      cancelSwarmRun: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.cancelSwarmRun](input)),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
  };
}
