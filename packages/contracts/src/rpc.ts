import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsError,
  BeadsEpicCoordinatorSnapshot,
  BeadsEpicCoordinatorSnapshotInput,
  BeadsEpicIssueInput,
  BeadsGetIssueInput,
  BeadsGetContextInput,
  BeadsGetSessionActivityInput,
  BeadsGetSessionActivityResult,
  BeadsGetSwarmSupportInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsListSwarmsInput,
  BeadsListSwarmsResult,
  BeadsProjectCoordinatorSnapshot,
  BeadsProjectCoordinatorSnapshotInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  BeadsUpdateIssueInput,
  BeadsCreateIssueInput,
  BEADS_WS_METHODS,
} from "./beads";
import { OpenError, OpenInEditorInput } from "./editor";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitCommandError,
  GitCurrentPullRequestInput,
  GitCurrentPullRequestResult,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
  GitStatusStreamEvent,
  GitWorkingTreeInput,
  GitWorkingTreeResult,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  OrchestrationCancelSwarmRunInput,
  ClientOrchestrationCommand,
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationPauseSwarmRunInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
  OrchestrationRetryPlanImplementationLaunchInput,
  OrchestrationResumePausedSwarmRunInput,
  OrchestrationRetrySwarmTaskExecutionInput,
  OrchestrationRunNextSwarmTaskInput,
  OrchestrationStartSwarmRunInput,
  OrchestrationSwarmRunControlResult,
} from "./orchestration";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitRefreshStatus: "git.refreshStatus",
  gitWorkingTree: "git.workingTree",
  gitCurrentPullRequest: "git.currentPullRequest",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",

  // Streaming subscriptions
  subscribeGitStatus: "subscribeGitStatus",
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitWorkingTreeRpc = Rpc.make(WS_METHODS.gitWorkingTree, {
  payload: GitWorkingTreeInput,
  success: GitWorkingTreeResult,
  error: GitCommandError,
});

export const WsGitCurrentPullRequestRpc = Rpc.make(WS_METHODS.gitCurrentPullRequest, {
  payload: GitCurrentPullRequestInput,
  success: GitCurrentPullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRefreshStatusRpc = Rpc.make(WS_METHODS.gitRefreshStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  success: GitCreateBranchResult,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  success: GitCheckoutResult,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsBeadsQueryIssuesRpc = Rpc.make(BEADS_WS_METHODS.queryIssues, {
  payload: BeadsQueryIssuesInput,
  success: BeadsQueryIssuesResult,
  error: BeadsError,
});

export const WsBeadsGetIssueRpc = Rpc.make(BEADS_WS_METHODS.getIssue, {
  payload: BeadsGetIssueInput,
  success: BeadsIssueDetail,
  error: BeadsError,
});

export const WsBeadsUpdateIssueRpc = Rpc.make(BEADS_WS_METHODS.updateIssue, {
  payload: BeadsUpdateIssueInput,
  success: BeadsIssueSummary,
  error: BeadsError,
});

export const WsBeadsCreateIssueRpc = Rpc.make(BEADS_WS_METHODS.createIssue, {
  payload: BeadsCreateIssueInput,
  success: BeadsIssueSummary,
  error: BeadsError,
});

export const WsBeadsCommentIssueRpc = Rpc.make(BEADS_WS_METHODS.commentIssue, {
  payload: BeadsCommentIssueInput,
  success: BeadsIssueDetail,
  error: BeadsError,
});

export const WsBeadsGetSessionActivityRpc = Rpc.make(BEADS_WS_METHODS.getSessionActivity, {
  payload: BeadsGetSessionActivityInput,
  success: BeadsGetSessionActivityResult,
  error: BeadsError,
});

export const WsBeadsStartWorkflowRpc = Rpc.make(BEADS_WS_METHODS.startWorkflow, {
  payload: BeadsStartWorkflowInput,
  success: BeadsStartWorkflowResult,
  error: BeadsError,
});

export const WsBeadsStartBacklogGroomingRpc = Rpc.make(BEADS_WS_METHODS.startBacklogGrooming, {
  payload: BeadsStartBacklogGroomingInput,
  success: BeadsStartWorkflowResult,
  error: BeadsError,
});

export const WsBeadsGetContextRpc = Rpc.make(BEADS_WS_METHODS.getContext, {
  payload: BeadsGetContextInput,
  success: BeadsContext,
  error: BeadsError,
});

export const WsBeadsGetSwarmSupportRpc = Rpc.make(BEADS_WS_METHODS.getSwarmSupport, {
  payload: BeadsGetSwarmSupportInput,
  success: BeadsSwarmSupport,
  error: BeadsError,
});

export const WsBeadsGetIssueGraphRpc = Rpc.make(BEADS_WS_METHODS.getIssueGraph, {
  payload: BeadsEpicIssueInput,
  success: BeadsIssueGraph,
  error: BeadsError,
});

export const WsBeadsGetEpicSwarmRpc = Rpc.make(BEADS_WS_METHODS.getEpicSwarm, {
  payload: BeadsEpicIssueInput,
  success: Schema.NullOr(BeadsSwarmSummary),
  error: BeadsError,
});

export const WsBeadsValidateEpicSwarmRpc = Rpc.make(BEADS_WS_METHODS.validateEpicSwarm, {
  payload: BeadsEpicIssueInput,
  success: BeadsSwarmValidation,
  error: BeadsError,
});

export const WsBeadsGetEpicSwarmStatusRpc = Rpc.make(BEADS_WS_METHODS.getEpicSwarmStatus, {
  payload: BeadsEpicIssueInput,
  success: BeadsSwarmStatus,
  error: BeadsError,
});

export const WsBeadsListSwarmsRpc = Rpc.make(BEADS_WS_METHODS.listSwarms, {
  payload: BeadsListSwarmsInput,
  success: BeadsListSwarmsResult,
  error: BeadsError,
});

export const WsBeadsGetProjectCoordinatorSnapshotRpc = Rpc.make(
  BEADS_WS_METHODS.getProjectCoordinatorSnapshot,
  {
    payload: BeadsProjectCoordinatorSnapshotInput,
    success: BeadsProjectCoordinatorSnapshot,
    error: BeadsError,
  },
);

export const WsBeadsGetEpicCoordinatorSnapshotRpc = Rpc.make(
  BEADS_WS_METHODS.getEpicCoordinatorSnapshot,
  {
    payload: BeadsEpicCoordinatorSnapshotInput,
    success: BeadsEpicCoordinatorSnapshot,
    error: BeadsError,
  },
);

export const WsBeadsStartEpicQuickRefineRpc = Rpc.make(BEADS_WS_METHODS.startEpicQuickRefine, {
  payload: BeadsStartEpicQuickRefineInput,
  success: BeadsStartWorkflowResult,
  error: BeadsError,
});

export const WsBeadsStartEpicPlannedRefineRpc = Rpc.make(BEADS_WS_METHODS.startEpicPlannedRefine, {
  payload: BeadsStartEpicPlannedRefineInput,
  success: BeadsStartWorkflowResult,
  error: BeadsError,
});

export const WsBeadsStartEpicCoordinationPrepRpc = Rpc.make(
  BEADS_WS_METHODS.startEpicCoordinationPrep,
  {
    payload: BeadsStartEpicCoordinationPrepInput,
    success: BeadsStartWorkflowResult,
    error: BeadsError,
  },
);

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsOrchestrationLaunchPlanImplementationRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.launchPlanImplementation,
  {
    payload: OrchestrationLaunchPlanImplementationInput,
    success: OrchestrationLaunchPlanImplementationResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationCancelPlanImplementationLaunchRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.cancelPlanImplementationLaunch,
  {
    payload: OrchestrationCancelPlanImplementationLaunchInput,
    success: OrchestrationCancelPlanImplementationLaunchResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationRetryPlanImplementationLaunchRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.retryPlanImplementationLaunch,
  {
    payload: OrchestrationRetryPlanImplementationLaunchInput,
    success: OrchestrationLaunchPlanImplementationResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationStartSwarmRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.startSwarmRun, {
  payload: OrchestrationStartSwarmRunInput,
  success: OrchestrationSwarmRunControlResult,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestrationPauseSwarmRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.pauseSwarmRun, {
  payload: OrchestrationPauseSwarmRunInput,
  success: OrchestrationSwarmRunControlResult,
  error: OrchestrationDispatchCommandError,
});

export const WsOrchestrationResumePausedSwarmRunRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.resumePausedSwarmRun,
  {
    payload: OrchestrationResumePausedSwarmRunInput,
    success: OrchestrationSwarmRunControlResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationRunNextSwarmTaskRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.runNextSwarmTask,
  {
    payload: OrchestrationRunNextSwarmTaskInput,
    success: OrchestrationSwarmRunControlResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationRetrySwarmTaskExecutionRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.retrySwarmTaskExecution,
  {
    payload: OrchestrationRetrySwarmTaskExecutionInput,
    success: OrchestrationSwarmRunControlResult,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationCancelSwarmRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.cancelSwarmRun, {
  payload: OrchestrationCancelSwarmRunInput,
  success: OrchestrationSwarmRunControlResult,
  error: OrchestrationDispatchCommandError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsSubscribeGitStatusRpc,
  WsGitWorkingTreeRpc,
  WsGitCurrentPullRequestRpc,
  WsGitPullRpc,
  WsGitRefreshStatusRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsBeadsQueryIssuesRpc,
  WsBeadsGetIssueRpc,
  WsBeadsUpdateIssueRpc,
  WsBeadsCreateIssueRpc,
  WsBeadsCommentIssueRpc,
  WsBeadsGetSessionActivityRpc,
  WsBeadsStartWorkflowRpc,
  WsBeadsStartBacklogGroomingRpc,
  WsBeadsGetContextRpc,
  WsBeadsGetSwarmSupportRpc,
  WsBeadsGetIssueGraphRpc,
  WsBeadsGetEpicSwarmRpc,
  WsBeadsValidateEpicSwarmRpc,
  WsBeadsGetEpicSwarmStatusRpc,
  WsBeadsListSwarmsRpc,
  WsBeadsGetProjectCoordinatorSnapshotRpc,
  WsBeadsGetEpicCoordinatorSnapshotRpc,
  WsBeadsStartEpicQuickRefineRpc,
  WsBeadsStartEpicPlannedRefineRpc,
  WsBeadsStartEpicCoordinationPrepRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationLaunchPlanImplementationRpc,
  WsOrchestrationCancelPlanImplementationLaunchRpc,
  WsOrchestrationRetryPlanImplementationLaunchRpc,
  WsOrchestrationStartSwarmRunRpc,
  WsOrchestrationPauseSwarmRunRpc,
  WsOrchestrationResumePausedSwarmRunRpc,
  WsOrchestrationRunNextSwarmTaskRpc,
  WsOrchestrationRetrySwarmTaskExecutionRpc,
  WsOrchestrationCancelSwarmRunRpc,
);
