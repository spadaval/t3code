import type {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsEpicCoordinatorSnapshot,
  BeadsEpicCoordinatorSnapshotInput,
  BeadsEpicIssueInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
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
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  BeadsUpdateIssueInput,
} from "./beads";
import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCurrentPullRequestInput,
  GitCurrentPullRequestResult,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
  GitWorkingTreeInput,
  GitWorkingTreeResult,
} from "./git";
import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from "./server";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import type { ServerUpsertKeybindingInput } from "./server";
import type {
  OrchestrationCancelSwarmRunInput,
  ClientOrchestrationCommand,
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationContinueSwarmRunInput,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationPauseSwarmRunInput,
  OrchestrationReadModel,
  OrchestrationRetryPlanImplementationLaunchInput,
  OrchestrationResumeSwarmRunInput,
  OrchestrationStartSwarmRunInput,
  OrchestrationSwarmRunControlResult,
} from "./orchestration";
import { EditorId } from "./editor";
import { ServerSettings, ServerSettingsPatch } from "./settings";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopBridge {
  getWsUrl: () => string | null;
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  git: {
    // Existing branch/worktree API
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    workingTree: (input: GitWorkingTreeInput) => Promise<GitWorkingTreeResult>;
    currentPullRequest: (input: GitCurrentPullRequestInput) => Promise<GitCurrentPullRequestResult>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    launchPlanImplementation: (
      input: OrchestrationLaunchPlanImplementationInput,
    ) => Promise<OrchestrationLaunchPlanImplementationResult>;
    cancelPlanImplementationLaunch: (
      input: OrchestrationCancelPlanImplementationLaunchInput,
    ) => Promise<OrchestrationCancelPlanImplementationLaunchResult>;
    retryPlanImplementationLaunch: (
      input: OrchestrationRetryPlanImplementationLaunchInput,
    ) => Promise<OrchestrationLaunchPlanImplementationResult>;
    startSwarmRun: (
      input: OrchestrationStartSwarmRunInput,
    ) => Promise<OrchestrationSwarmRunControlResult>;
    continueSwarmRun: (
      input: OrchestrationContinueSwarmRunInput,
    ) => Promise<OrchestrationSwarmRunControlResult>;
    pauseSwarmRun: (
      input: OrchestrationPauseSwarmRunInput,
    ) => Promise<OrchestrationSwarmRunControlResult>;
    resumeSwarmRun: (
      input: OrchestrationResumeSwarmRunInput,
    ) => Promise<OrchestrationSwarmRunControlResult>;
    cancelSwarmRun: (
      input: OrchestrationCancelSwarmRunInput,
    ) => Promise<OrchestrationSwarmRunControlResult>;
    onDomainEvent: (
      callback: (event: OrchestrationEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  beads: {
    queryIssues: (input: BeadsQueryIssuesInput) => Promise<BeadsQueryIssuesResult>;
    getIssue: (input: BeadsGetIssueInput) => Promise<BeadsIssueDetail>;
    updateIssue: (input: BeadsUpdateIssueInput) => Promise<BeadsIssueSummary>;
    commentIssue: (input: BeadsCommentIssueInput) => Promise<BeadsIssueDetail>;
    getContext: (input: BeadsGetContextInput) => Promise<BeadsContext>;
    getSwarmSupport: (input: BeadsGetSwarmSupportInput) => Promise<BeadsSwarmSupport>;
    getIssueGraph: (input: BeadsEpicIssueInput) => Promise<BeadsIssueGraph>;
    getEpicSwarm: (input: BeadsEpicIssueInput) => Promise<BeadsSwarmSummary | null>;
    validateEpicSwarm: (input: BeadsEpicIssueInput) => Promise<BeadsSwarmValidation>;
    getEpicSwarmStatus: (input: BeadsEpicIssueInput) => Promise<BeadsSwarmStatus>;
    listSwarms: (input: BeadsListSwarmsInput) => Promise<BeadsListSwarmsResult>;
    getProjectCoordinatorSnapshot: (
      input: BeadsProjectCoordinatorSnapshotInput,
    ) => Promise<BeadsProjectCoordinatorSnapshot>;
    getEpicCoordinatorSnapshot: (
      input: BeadsEpicCoordinatorSnapshotInput,
    ) => Promise<BeadsEpicCoordinatorSnapshot>;
    getSessionActivity: (
      input: BeadsGetSessionActivityInput,
    ) => Promise<BeadsGetSessionActivityResult>;
    startWorkflow: (input: BeadsStartWorkflowInput) => Promise<BeadsStartWorkflowResult>;
    startEpicQuickRefine: (
      input: BeadsStartEpicQuickRefineInput,
    ) => Promise<BeadsStartWorkflowResult>;
    startEpicPlannedRefine: (
      input: BeadsStartEpicPlannedRefineInput,
    ) => Promise<BeadsStartWorkflowResult>;
    startEpicCoordinationPrep: (
      input: BeadsStartEpicCoordinationPrepInput,
    ) => Promise<BeadsStartWorkflowResult>;
  };
}
