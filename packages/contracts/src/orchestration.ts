import { Option, Schema, SchemaIssue, Struct } from "effect";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  ProviderModelOptions,
  ProviderStartOptions,
} from "./model";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PlanImplementationLaunchId,
  ProjectId,
  ProviderItemId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";

export const ORCHESTRATION_WS_METHODS = {
  getSnapshot: "orchestration.getSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  launchPlanImplementation: "orchestration.launchPlanImplementation",
  cancelPlanImplementationLaunch: "orchestration.cancelPlanImplementationLaunch",
  retryPlanImplementationLaunch: "orchestration.retryPlanImplementationLaunch",
  startSwarmRun: "orchestration.startSwarmRun",
  continueSwarmRun: "orchestration.continueSwarmRun",
  pauseSwarmRun: "orchestration.pauseSwarmRun",
  resumeSwarmRun: "orchestration.resumeSwarmRun",
  cancelSwarmRun: "orchestration.cancelSwarmRun",
} as const;

export const ProviderKind = Schema.Literals(["codex", "claudeAgent"]);
export type ProviderKind = typeof ProviderKind.Type;
export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

export const DEFAULT_PROVIDER_KIND: ProviderKind = "codex";

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(CodexModelOptions),
});
export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ClaudeModelOptions),
});
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const ModelSelection = Schema.Union([CodexModelSelection, ClaudeModelSelection]);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals(["approval-required", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlanIntent = Schema.Literals([
  "code-implementation",
  "tracker-refinement",
]);
export type OrchestrationProposedPlanIntent = typeof OrchestrationProposedPlanIntent.Type;
export const DEFAULT_ORCHESTRATION_PROPOSED_PLAN_INTENT: OrchestrationProposedPlanIntent =
  "code-implementation";

export const OrchestrationPlanImplementationLaunchMode = Schema.Literals([
  "worktree",
  "tracker-only",
]);
export type OrchestrationPlanImplementationLaunchMode =
  typeof OrchestrationPlanImplementationLaunchMode.Type;
export const DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE: OrchestrationPlanImplementationLaunchMode =
  "worktree";

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  planIntent: OrchestrationProposedPlanIntent.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_PROPOSED_PLAN_INTENT),
  ),
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationThreadIssueLink = Schema.Struct({
  issueId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  priority: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(() => null)),
  repoRoot: TrimmedNonEmptyString,
  linkedAt: IsoDateTime,
});
export type OrchestrationThreadIssueLink = typeof OrchestrationThreadIssueLink.Type;

export const OrchestrationPlanImplementationLaunchStatus = Schema.Literals([
  "requested",
  "prepared",
  "started",
  "failed",
  "cancelled",
]);
export type OrchestrationPlanImplementationLaunchStatus =
  typeof OrchestrationPlanImplementationLaunchStatus.Type;

export const OrchestrationPlanImplementationLaunchCleanupStatus = Schema.Literals([
  "not-required",
  "pending",
  "succeeded",
  "failed",
]);
export type OrchestrationPlanImplementationLaunchCleanupStatus =
  typeof OrchestrationPlanImplementationLaunchCleanupStatus.Type;

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issueLink: Schema.NullOr(OrchestrationThreadIssueLink).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationPlanImplementationLaunch = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  sourceThreadId: ThreadId,
  sourcePlanId: OrchestrationProposedPlanId,
  projectId: ProjectId,
  targetThreadId: ThreadId,
  retryOfLaunchId: Schema.NullOr(PlanImplementationLaunchId),
  status: OrchestrationPlanImplementationLaunchStatus,
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  failureReason: Schema.NullOr(TrimmedNonEmptyString),
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.NullOr(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  setupEnabled: Schema.Boolean,
  requestedAt: IsoDateTime,
  preparedAt: Schema.NullOr(IsoDateTime),
  startedAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  cancelledAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type OrchestrationPlanImplementationLaunch =
  typeof OrchestrationPlanImplementationLaunch.Type;

export const OrchestrationSwarmSchedulerMode = Schema.Literals(["automatic", "semi-automatic"]);
export type OrchestrationSwarmSchedulerMode = typeof OrchestrationSwarmSchedulerMode.Type;
export const DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE: OrchestrationSwarmSchedulerMode =
  "automatic";

export const OrchestrationSwarmWorkspaceMode = Schema.Literals(["shared"]);
export type OrchestrationSwarmWorkspaceMode = typeof OrchestrationSwarmWorkspaceMode.Type;
export const DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE: OrchestrationSwarmWorkspaceMode = "shared";

export const OrchestrationSwarmRunStatus = Schema.Literals([
  "requested",
  "running",
  "idle",
  "paused",
  "blocked",
  "failed",
  "cancelled",
  "completed",
]);
export type OrchestrationSwarmRunStatus = typeof OrchestrationSwarmRunStatus.Type;

export const OrchestrationSwarmTaskExecutionStatus = Schema.Literals([
  "requested",
  "active",
  "completed",
  "failed",
  "cancelled",
]);
export type OrchestrationSwarmTaskExecutionStatus =
  typeof OrchestrationSwarmTaskExecutionStatus.Type;

export const OrchestrationSwarmRun = Schema.Struct({
  runId: SwarmRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  swarmId: TrimmedNonEmptyString,
  status: OrchestrationSwarmRunStatus,
  schedulerMode: OrchestrationSwarmSchedulerMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE),
  ),
  workspaceMode: OrchestrationSwarmWorkspaceMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE),
  ),
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderModelOptions),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTaskExecutionId: Schema.NullOr(SwarmTaskExecutionId).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  latestTaskExecutionId: Schema.NullOr(SwarmTaskExecutionId).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastError: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  idledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  pausedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  blockedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  failedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  cancelledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  updatedAt: IsoDateTime,
});
export type OrchestrationSwarmRun = typeof OrchestrationSwarmRun.Type;

export const OrchestrationSwarmTaskExecution = Schema.Struct({
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  sequenceNumber: NonNegativeInt,
  status: OrchestrationSwarmTaskExecutionStatus,
  lastError: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  failedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  cancelledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  updatedAt: IsoDateTime,
});
export type OrchestrationSwarmTaskExecution = typeof OrchestrationSwarmTaskExecution.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  planImplementationLaunches: Schema.Array(OrchestrationPlanImplementationLaunch).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  swarmRuns: Schema.Array(OrchestrationSwarmRun).pipe(Schema.withDecodingDefault(() => [])),
  swarmTaskExecutions: Schema.Array(OrchestrationSwarmTaskExecution).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issueLink: Schema.optional(Schema.NullOr(OrchestrationThreadIssueLink)),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  issueLink: Schema.optional(Schema.NullOr(OrchestrationThreadIssueLink)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const PlanImplementationLaunchRequestCommand = Schema.Struct({
  type: Schema.Literal("plan-implementation-launch.request"),
  commandId: CommandId,
  launchId: PlanImplementationLaunchId,
  sourceThreadId: ThreadId,
  sourcePlanId: OrchestrationProposedPlanId,
  projectId: ProjectId,
  targetThreadId: ThreadId,
  retryOfLaunchId: Schema.optional(PlanImplementationLaunchId),
  title: TrimmedNonEmptyString,
  setupEnabled: Schema.Boolean,
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
  ),
  promptText: Schema.String,
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderModelOptions),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  createdAt: IsoDateTime,
});

const PlanImplementationLaunchMarkWorktreePreparedCommand = Schema.Struct({
  type: Schema.Literal("plan-implementation-launch.mark-worktree-prepared"),
  commandId: CommandId,
  launchId: PlanImplementationLaunchId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const PlanImplementationLaunchMarkStartedCommand = Schema.Struct({
  type: Schema.Literal("plan-implementation-launch.mark-started"),
  commandId: CommandId,
  launchId: PlanImplementationLaunchId,
  createdAt: IsoDateTime,
});

const PlanImplementationLaunchFailCommand = Schema.Struct({
  type: Schema.Literal("plan-implementation-launch.fail"),
  commandId: CommandId,
  launchId: PlanImplementationLaunchId,
  failureReason: TrimmedNonEmptyString,
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const PlanImplementationLaunchCancelCommand = Schema.Struct({
  type: Schema.Literal("plan-implementation-launch.cancel"),
  commandId: CommandId,
  launchId: PlanImplementationLaunchId,
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const SwarmRunRequestCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.request"),
  commandId: CommandId,
  runId: SwarmRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  swarmId: TrimmedNonEmptyString,
  schedulerMode: OrchestrationSwarmSchedulerMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE),
  ),
  workspaceMode: OrchestrationSwarmWorkspaceMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE),
  ),
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderModelOptions),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  createdAt: IsoDateTime,
});

const SwarmRunMarkStartedCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.mark-started"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmRunMarkIdleCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.mark-idle"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmRunPauseCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.pause"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmRunResumeCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.resume"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmRunBlockCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.block"),
  commandId: CommandId,
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const SwarmRunFailCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.fail"),
  commandId: CommandId,
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const SwarmRunCancelCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.cancel"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmRunCompleteCommand = Schema.Struct({
  type: Schema.Literal("swarm-run.complete"),
  commandId: CommandId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmTaskExecutionStartCommand = Schema.Struct({
  type: Schema.Literal("swarm-task-execution.start"),
  commandId: CommandId,
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.optional(ThreadId),
  sequenceNumber: NonNegativeInt,
  createdAt: IsoDateTime,
});

const SwarmTaskExecutionCompleteCommand = Schema.Struct({
  type: Schema.Literal("swarm-task-execution.complete"),
  commandId: CommandId,
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const SwarmTaskExecutionFailCommand = Schema.Struct({
  type: Schema.Literal("swarm-task-execution.fail"),
  commandId: CommandId,
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const SwarmTaskExecutionCancelCommand = Schema.Struct({
  type: Schema.Literal("swarm-task-execution.cancel"),
  commandId: CommandId,
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  PlanImplementationLaunchRequestCommand,
  PlanImplementationLaunchMarkWorktreePreparedCommand,
  PlanImplementationLaunchMarkStartedCommand,
  PlanImplementationLaunchFailCommand,
  PlanImplementationLaunchCancelCommand,
  SwarmRunRequestCommand,
  SwarmRunMarkStartedCommand,
  SwarmRunMarkIdleCommand,
  SwarmRunPauseCommand,
  SwarmRunResumeCommand,
  SwarmRunBlockCommand,
  SwarmRunFailCommand,
  SwarmRunCancelCommand,
  SwarmRunCompleteCommand,
  SwarmTaskExecutionStartCommand,
  SwarmTaskExecutionCompleteCommand,
  SwarmTaskExecutionFailCommand,
  SwarmTaskExecutionCancelCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "plan-implementation-launch.requested",
  "plan-implementation-launch.worktree-prepared",
  "plan-implementation-launch.started",
  "plan-implementation-launch.failed",
  "plan-implementation-launch.cancelled",
  "swarm-run.requested",
  "swarm-run.started",
  "swarm-run.idled",
  "swarm-run.paused",
  "swarm-run.resumed",
  "swarm-run.blocked",
  "swarm-run.failed",
  "swarm-run.cancelled",
  "swarm-run.completed",
  "swarm-task-execution.started",
  "swarm-task-execution.completed",
  "swarm-task-execution.failed",
  "swarm-task-execution.cancelled",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals([
  "project",
  "thread",
  "planImplementationLaunch",
  "swarmRun",
  "swarmTaskExecution",
]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issueLink: Schema.NullOr(OrchestrationThreadIssueLink).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  issueLink: Schema.optional(Schema.NullOr(OrchestrationThreadIssueLink)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const PlanImplementationLaunchRequestedPayload = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  sourceThreadId: ThreadId,
  sourcePlanId: OrchestrationProposedPlanId,
  projectId: ProjectId,
  targetThreadId: ThreadId,
  retryOfLaunchId: Schema.NullOr(PlanImplementationLaunchId),
  title: TrimmedNonEmptyString,
  setupEnabled: Schema.Boolean,
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
  ),
  promptText: Schema.String,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderModelOptions),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const PlanImplementationLaunchWorktreePreparedPayload = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  preparedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const PlanImplementationLaunchStartedPayload = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const PlanImplementationLaunchFailedPayload = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  failureReason: TrimmedNonEmptyString,
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.NullOr(TrimmedNonEmptyString),
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const PlanImplementationLaunchCancelledPayload = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  cleanupStatus: OrchestrationPlanImplementationLaunchCleanupStatus,
  cleanupError: Schema.NullOr(TrimmedNonEmptyString),
  cancelledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunRequestedPayload = Schema.Struct({
  runId: SwarmRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  swarmId: TrimmedNonEmptyString,
  schedulerMode: OrchestrationSwarmSchedulerMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE),
  ),
  workspaceMode: OrchestrationSwarmWorkspaceMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE),
  ),
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderModelOptions),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunStartedPayload = Schema.Struct({
  runId: SwarmRunId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunIdledPayload = Schema.Struct({
  runId: SwarmRunId,
  idledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunPausedPayload = Schema.Struct({
  runId: SwarmRunId,
  pausedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunResumedPayload = Schema.Struct({
  runId: SwarmRunId,
  resumedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunBlockedPayload = Schema.Struct({
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  blockedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunFailedPayload = Schema.Struct({
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunCancelledPayload = Schema.Struct({
  runId: SwarmRunId,
  cancelledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmRunCompletedPayload = Schema.Struct({
  runId: SwarmRunId,
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmTaskExecutionStartedPayload = Schema.Struct({
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.NullOr(ThreadId),
  sequenceNumber: NonNegativeInt,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmTaskExecutionCompletedPayload = Schema.Struct({
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmTaskExecutionFailedPayload = Schema.Struct({
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  reason: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SwarmTaskExecutionCancelledPayload = Schema.Struct({
  executionId: SwarmTaskExecutionId,
  runId: SwarmRunId,
  cancelledAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([
    ProjectId,
    ThreadId,
    PlanImplementationLaunchId,
    SwarmRunId,
    SwarmTaskExecutionId,
  ]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("plan-implementation-launch.requested"),
    payload: PlanImplementationLaunchRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("plan-implementation-launch.worktree-prepared"),
    payload: PlanImplementationLaunchWorktreePreparedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("plan-implementation-launch.started"),
    payload: PlanImplementationLaunchStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("plan-implementation-launch.failed"),
    payload: PlanImplementationLaunchFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("plan-implementation-launch.cancelled"),
    payload: PlanImplementationLaunchCancelledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.requested"),
    payload: SwarmRunRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.started"),
    payload: SwarmRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.idled"),
    payload: SwarmRunIdledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.paused"),
    payload: SwarmRunPausedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.resumed"),
    payload: SwarmRunResumedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.blocked"),
    payload: SwarmRunBlockedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.failed"),
    payload: SwarmRunFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.cancelled"),
    payload: SwarmRunCancelledPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-run.completed"),
    payload: SwarmRunCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-task-execution.started"),
    payload: SwarmTaskExecutionStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-task-execution.completed"),
    payload: SwarmTaskExecutionCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-task-execution.failed"),
    payload: SwarmTaskExecutionFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("swarm-task-execution.cancelled"),
    payload: SwarmTaskExecutionCancelledPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetSnapshotInput = Schema.Struct({});
export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type;
const OrchestrationGetSnapshotResult = OrchestrationReadModel;
export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({ threadId: ThreadId }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationLaunchPlanImplementationInput = Schema.Struct({
  sourceThreadId: ThreadId,
  planId: OrchestrationProposedPlanId,
  titleOverride: Schema.optional(TrimmedNonEmptyString),
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderModelOptions),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
  ),
  runSetup: Schema.Boolean,
});
export type OrchestrationLaunchPlanImplementationInput =
  typeof OrchestrationLaunchPlanImplementationInput.Type;

export const OrchestrationLaunchPlanImplementationResult = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  targetThreadId: ThreadId,
  status: OrchestrationPlanImplementationLaunchStatus,
});
export type OrchestrationLaunchPlanImplementationResult =
  typeof OrchestrationLaunchPlanImplementationResult.Type;

export const OrchestrationCancelPlanImplementationLaunchInput = Schema.Struct({
  launchId: PlanImplementationLaunchId,
});
export type OrchestrationCancelPlanImplementationLaunchInput =
  typeof OrchestrationCancelPlanImplementationLaunchInput.Type;

export const OrchestrationCancelPlanImplementationLaunchResult = Schema.Struct({
  launchId: PlanImplementationLaunchId,
  status: OrchestrationPlanImplementationLaunchStatus,
});
export type OrchestrationCancelPlanImplementationLaunchResult =
  typeof OrchestrationCancelPlanImplementationLaunchResult.Type;

export const OrchestrationRetryPlanImplementationLaunchInput = Schema.Struct({
  launchId: PlanImplementationLaunchId,
});
export type OrchestrationRetryPlanImplementationLaunchInput =
  typeof OrchestrationRetryPlanImplementationLaunchInput.Type;

export const OrchestrationStartSwarmRunInput = Schema.Struct({
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  schedulerMode: OrchestrationSwarmSchedulerMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE),
  ),
  workspaceMode: OrchestrationSwarmWorkspaceMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE),
  ),
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderModelOptions),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
});
export type OrchestrationStartSwarmRunInput = typeof OrchestrationStartSwarmRunInput.Type;

const OrchestrationSwarmRunControlInput = Schema.Struct({
  runId: SwarmRunId,
});
export type OrchestrationSwarmRunControlInput = typeof OrchestrationSwarmRunControlInput.Type;

export const OrchestrationContinueSwarmRunInput = OrchestrationSwarmRunControlInput;
export type OrchestrationContinueSwarmRunInput = typeof OrchestrationContinueSwarmRunInput.Type;

export const OrchestrationPauseSwarmRunInput = OrchestrationSwarmRunControlInput;
export type OrchestrationPauseSwarmRunInput = typeof OrchestrationPauseSwarmRunInput.Type;

export const OrchestrationResumeSwarmRunInput = OrchestrationSwarmRunControlInput;
export type OrchestrationResumeSwarmRunInput = typeof OrchestrationResumeSwarmRunInput.Type;

export const OrchestrationCancelSwarmRunInput = OrchestrationSwarmRunControlInput;
export type OrchestrationCancelSwarmRunInput = typeof OrchestrationCancelSwarmRunInput.Type;

export const OrchestrationSwarmRunControlResult = Schema.Struct({
  runId: SwarmRunId,
  status: OrchestrationSwarmRunStatus,
});
export type OrchestrationSwarmRunControlResult = typeof OrchestrationSwarmRunControlResult.Type;

export const OrchestrationRpcSchemas = {
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  launchPlanImplementation: {
    input: OrchestrationLaunchPlanImplementationInput,
    output: OrchestrationLaunchPlanImplementationResult,
  },
  cancelPlanImplementationLaunch: {
    input: OrchestrationCancelPlanImplementationLaunchInput,
    output: OrchestrationCancelPlanImplementationLaunchResult,
  },
  retryPlanImplementationLaunch: {
    input: OrchestrationRetryPlanImplementationLaunchInput,
    output: OrchestrationLaunchPlanImplementationResult,
  },
  startSwarmRun: {
    input: OrchestrationStartSwarmRunInput,
    output: OrchestrationSwarmRunControlResult,
  },
  continueSwarmRun: {
    input: OrchestrationContinueSwarmRunInput,
    output: OrchestrationSwarmRunControlResult,
  },
  pauseSwarmRun: {
    input: OrchestrationPauseSwarmRunInput,
    output: OrchestrationSwarmRunControlResult,
  },
  resumeSwarmRun: {
    input: OrchestrationResumeSwarmRunInput,
    output: OrchestrationSwarmRunControlResult,
  },
  cancelSwarmRun: {
    input: OrchestrationCancelSwarmRunInput,
    output: OrchestrationSwarmRunControlResult,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
