import type {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsCreateIssueInput,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueSummariesInput,
  BeadsEpicIssueInput,
  BeadsEpicTrackerDetail,
  BeadsEpicTrackerDetailInput,
  BeadsEpicRunSupport,
  BeadsEpicRunValidation,
  BeadsEpicTrackerStatus,
  BeadsEpicTrackerSummary,
  BeadsGetContextInput,
  BeadsGetEpicRunSupportInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetIssuesResult,
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
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsUpdateIssueInput,
} from "./beads";
import type { EnvironmentId } from "./baseSchemas";
import { EditorId } from "./editor";
import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import type {
  ClientOrchestrationCommand,
  OrchestrationCancelPlanImplementationLaunchInput,
  OrchestrationCancelPlanImplementationLaunchResult,
  OrchestrationEpicRunControlResult,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationLaunchPlanImplementationInput,
  OrchestrationLaunchPlanImplementationResult,
  OrchestrationReadModel,
  OrchestrationRetryPlanImplementationLaunchInput,
  OrchestrationStartEpicRunInput,
  OrchestrationStopEpicRunInput,
} from "./orchestration";
import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ClientSettings, ServerSettings, ServerSettingsPatch } from "./settings";
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

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export interface PersistedSavedEnvironmentRecord {
  environmentId: EnvironmentId;
  label: string;
  wsBaseUrl: string;
  httpBaseUrl: string;
  createdAt: string;
  lastConnectedAt: string | null;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export interface DesktopBridge {
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
  removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
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

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<string | null>;
    setSavedEnvironmentSecret: (environmentId: EnvironmentId, secret: string) => Promise<boolean>;
    removeSavedEnvironmentSecret: (environmentId: EnvironmentId) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, git, and beads operations. In multi-environment mode, each
 * environment gets its own instance of this surface, and callers should resolve
 * it by `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
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
  git: {
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
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
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
    startEpicRun: (
      input: OrchestrationStartEpicRunInput,
    ) => Promise<OrchestrationEpicRunControlResult>;
    stopEpicRun: (
      input: OrchestrationStopEpicRunInput,
    ) => Promise<OrchestrationEpicRunControlResult>;
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
    getIssues: (input: BeadsGetIssuesInput) => Promise<BeadsGetIssuesResult>;
    createIssue: (input: BeadsCreateIssueInput) => Promise<BeadsIssueSummary>;
    updateIssue: (input: BeadsUpdateIssueInput) => Promise<BeadsIssueSummary>;
    commentIssue: (input: BeadsCommentIssueInput) => Promise<BeadsIssueDetail>;
    getContext: (input: BeadsGetContextInput) => Promise<BeadsContext>;
    getEpicRunSupport: (input: BeadsGetEpicRunSupportInput) => Promise<BeadsEpicRunSupport>;
    getIssueGraph: (input: BeadsEpicIssueInput) => Promise<BeadsIssueGraph>;
    getEpicTrackerSummary: (input: BeadsEpicIssueInput) => Promise<BeadsEpicTrackerSummary | null>;
    validateEpicRun: (input: BeadsEpicIssueInput) => Promise<BeadsEpicRunValidation>;
    getEpicTrackerStatus: (input: BeadsEpicIssueInput) => Promise<BeadsEpicTrackerStatus>;
    getProjectRunSummary: (input: BeadsProjectRunSummaryInput) => Promise<BeadsProjectRunSummary>;
    getEpicIssueSummaries: (
      input: BeadsEpicIssueSummariesInput,
    ) => Promise<BeadsEpicIssueSummaries>;
    getEpicTrackerDetail: (input: BeadsEpicTrackerDetailInput) => Promise<BeadsEpicTrackerDetail>;
    getSessionActivity: (
      input: BeadsGetSessionActivityInput,
    ) => Promise<BeadsGetSessionActivityResult>;
    startWorkflow: (input: BeadsStartWorkflowInput) => Promise<BeadsStartWorkflowResult>;
    startBacklogGrooming: (
      input: BeadsStartBacklogGroomingInput,
    ) => Promise<BeadsStartWorkflowResult>;
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
