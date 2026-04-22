import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { OpenError, OpenInEditorInput } from "./editor.ts";
import { AuthAccessStreamEvent } from "./auth.ts";
import {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemBrowseError,
} from "./filesystem.ts";
import {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsError,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueSummariesInput,
  BeadsEpicIssueInput,
  BeadsEpicCoordinationDetail,
  BeadsEpicCoordinationDetailInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetIssuesResult,
  BeadsGetContextInput,
  BeadsGetSessionActivityInput,
  BeadsGetSessionActivityResult,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsProjectRunSummary,
  BeadsProjectRunSummaryInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsUpdateIssueInput,
  BeadsCreateIssueInput,
  BEADS_WS_METHODS,
} from "./beads.ts";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCheckoutResult,
  GitCommandError,
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
} from "./git.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import {
  OrchestrationStopEpicRunInput,
  ClientOrchestrationCommand,
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
  OrchestrationRetryPlanImplementationLaunchInput,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRunControlResult,
} from "./orchestration.ts";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
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
} from "./terminal.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings.ts";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Filesystem methods
  filesystemBrowse: "filesystem.browse",

  // Git methods
  gitPull: "git.pull",
  gitRefreshStatus: "git.refreshStatus",
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
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeAuthAccess: "subscribeAuthAccess",
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
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

export const WsFilesystemBrowseRpc = Rpc.make(WS_METHODS.filesystemBrowse, {
  payload: FilesystemBrowseInput,
  success: FilesystemBrowseResult,
  error: FilesystemBrowseError,
});

export const WsSubscribeGitStatusRpc = Rpc.make(WS_METHODS.subscribeGitStatus, {
  payload: GitStatusInput,
  success: GitStatusStreamEvent,
  error: GitManagerServiceError,
  stream: true,
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

export const WsBeadsGetIssuesRpc = Rpc.make(BEADS_WS_METHODS.getIssues, {
  payload: BeadsGetIssuesInput,
  success: BeadsGetIssuesResult,
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

export const WsBeadsGetIssueGraphRpc = Rpc.make(BEADS_WS_METHODS.getIssueGraph, {
  payload: BeadsEpicIssueInput,
  success: BeadsIssueGraph,
  error: BeadsError,
});

export const WsBeadsValidateEpicCoordinationRpc = Rpc.make(
  BEADS_WS_METHODS.validateEpicCoordination,
  {
    payload: BeadsEpicIssueInput,
    success: BeadsEpicCoordinationValidation,
    error: BeadsError,
  },
);

export const WsBeadsGetEpicCoordinationStatusRpc = Rpc.make(
  BEADS_WS_METHODS.getEpicCoordinationStatus,
  {
    payload: BeadsEpicIssueInput,
    success: BeadsEpicCoordinationStatus,
    error: BeadsError,
  },
);

export const WsBeadsGetProjectRunSummaryRpc = Rpc.make(BEADS_WS_METHODS.getProjectRunSummary, {
  payload: BeadsProjectRunSummaryInput,
  success: BeadsProjectRunSummary,
  error: BeadsError,
});

export const WsBeadsGetEpicIssueSummariesRpc = Rpc.make(BEADS_WS_METHODS.getEpicIssueSummaries, {
  payload: BeadsEpicIssueSummariesInput,
  success: BeadsEpicIssueSummaries,
  error: BeadsError,
});

export const WsBeadsGetEpicCoordinationDetailRpc = Rpc.make(
  BEADS_WS_METHODS.getEpicCoordinationDetail,
  {
    payload: BeadsEpicCoordinationDetailInput,
    success: BeadsEpicCoordinationDetail,
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

export const WsOrchestrationSubscribeShellRpc = Rpc.make(ORCHESTRATION_WS_METHODS.subscribeShell, {
  payload: OrchestrationRpcSchemas.subscribeShell.input,
  success: OrchestrationRpcSchemas.subscribeShell.output,
  error: OrchestrationGetSnapshotError,
  stream: true,
});

export const WsOrchestrationSubscribeThreadRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.subscribeThread,
  {
    payload: OrchestrationRpcSchemas.subscribeThread.input,
    success: OrchestrationRpcSchemas.subscribeThread.output,
    error: OrchestrationGetSnapshotError,
    stream: true,
  },
);

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

export const WsOrchestrationStartEpicRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.startEpicRun, {
  payload: OrchestrationStartEpicRunInput,
  success: OrchestrationEpicRunControlResult,
  error: OrchestrationDispatchCommandError,
});
export const WsOrchestrationStopEpicRunRpc = Rpc.make(ORCHESTRATION_WS_METHODS.stopEpicRun, {
  payload: OrchestrationStopEpicRunInput,
  success: OrchestrationEpicRunControlResult,
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

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
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
  WsFilesystemBrowseRpc,
  WsSubscribeGitStatusRpc,
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
  WsBeadsGetIssuesRpc,
  WsBeadsUpdateIssueRpc,
  WsBeadsCreateIssueRpc,
  WsBeadsCommentIssueRpc,
  WsBeadsGetSessionActivityRpc,
  WsBeadsStartWorkflowRpc,
  WsBeadsStartBacklogGroomingRpc,
  WsBeadsGetContextRpc,
  WsBeadsGetIssueGraphRpc,
  WsBeadsValidateEpicCoordinationRpc,
  WsBeadsGetEpicCoordinationStatusRpc,
  WsBeadsGetProjectRunSummaryRpc,
  WsBeadsGetEpicIssueSummariesRpc,
  WsBeadsGetEpicCoordinationDetailRpc,
  WsBeadsStartEpicQuickRefineRpc,
  WsBeadsStartEpicPlannedRefineRpc,
  WsBeadsStartEpicCoordinationPrepRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsSubscribeAuthAccessRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  WsOrchestrationSubscribeShellRpc,
  WsOrchestrationSubscribeThreadRpc,
  WsOrchestrationLaunchPlanImplementationRpc,
  WsOrchestrationCancelPlanImplementationLaunchRpc,
  WsOrchestrationRetryPlanImplementationLaunchRpc,
  WsOrchestrationStartEpicRunRpc,
  WsOrchestrationStopEpicRunRpc,
);
