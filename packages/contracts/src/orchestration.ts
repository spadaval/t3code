import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
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
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  getEpicWorkflowDetail: "orchestration.getEpicWorkflowDetail",
  launchPlanImplementation: "orchestration.launchPlanImplementation",
  cancelPlanImplementationLaunch: "orchestration.cancelPlanImplementationLaunch",
  retryPlanImplementationLaunch: "orchestration.retryPlanImplementationLaunch",
  startEpicRun: "orchestration.startEpicRun",
  stopEpicRun: "orchestration.stopEpicRun",
} as const;

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

export const ProviderKind = ProviderDriverKind;
export type ProviderKind = ProviderDriverKind;
export const DEFAULT_PROVIDER_KIND: ProviderKind = ProviderDriverKind.make("codex");
export const ProviderStartOptions = Schema.Unknown;
export type ProviderStartOptions = typeof ProviderStartOptions.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
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
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
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

export const OrchestrationSubagentRunStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type OrchestrationSubagentRunStatus = typeof OrchestrationSubagentRunStatus.Type;

export const OrchestrationSubagentEntryKind = Schema.Literals([
  "assistant",
  "tool",
  "result",
  "error",
  "system",
]);
export type OrchestrationSubagentEntryKind = typeof OrchestrationSubagentEntryKind.Type;

export const OrchestrationSubagentEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  kind: OrchestrationSubagentEntryKind,
  title: Schema.NullOr(TrimmedNonEmptyString),
  text: Schema.String,
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type OrchestrationSubagentEntry = typeof OrchestrationSubagentEntry.Type;

export const OrchestrationSubagentRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  turnId: TurnId,
  parentItemId: ProviderItemId,
  provider: ProviderKind,
  providerInstanceId: Schema.optional(ProviderInstanceId),
  providerRunId: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  description: Schema.NullOr(TrimmedNonEmptyString),
  prompt: Schema.NullOr(Schema.String),
  agentType: Schema.NullOr(TrimmedNonEmptyString),
  model: Schema.NullOr(TrimmedNonEmptyString),
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
  config: Schema.Unknown,
  status: OrchestrationSubagentRunStatus,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  entries: Schema.Array(OrchestrationSubagentEntry),
});
export type OrchestrationSubagentRun = typeof OrchestrationSubagentRun.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlanIntent = Schema.Literals([
  "code-implementation",
  "tracker-refinement",
]);
export type OrchestrationProposedPlanIntent = typeof OrchestrationProposedPlanIntent.Type;
export const DEFAULT_ORCHESTRATION_PROPOSED_PLAN_INTENT: OrchestrationProposedPlanIntent =
  "code-implementation";

export const OrchestrationProposedPlanFollowUpOutcomeKind = Schema.Literals([
  "implement-code",
  "convert-to-tracker",
]);
export type OrchestrationProposedPlanFollowUpOutcomeKind =
  typeof OrchestrationProposedPlanFollowUpOutcomeKind.Type;

export const OrchestrationProposedPlanFollowUpOutcome = Schema.Struct({
  kind: OrchestrationProposedPlanFollowUpOutcomeKind,
  completedAt: IsoDateTime,
  targetThreadId: Schema.NullOr(ThreadId),
});
export type OrchestrationProposedPlanFollowUpOutcome =
  typeof OrchestrationProposedPlanFollowUpOutcome.Type;

export const OrchestrationPlanImplementationLaunchMode = Schema.Literals([
  "worktree",
  "tracker-only",
]);
export type OrchestrationPlanImplementationLaunchMode =
  typeof OrchestrationPlanImplementationLaunchMode.Type;
export const DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE: OrchestrationPlanImplementationLaunchMode =
  "worktree";

const OrchestrationProposedPlanShape = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  planIntent: OrchestrationProposedPlanIntent.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ORCHESTRATION_PROPOSED_PLAN_INTENT)),
  ),
  followUpOutcome: Schema.NullOr(OrchestrationProposedPlanFollowUpOutcome).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

const OrchestrationProposedPlanLegacyShape = Schema.Struct({
  ...OrchestrationProposedPlanShape.fields,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});

type OrchestrationProposedPlanLegacyCompatible =
  | typeof OrchestrationProposedPlanShape.Type
  | typeof OrchestrationProposedPlanLegacyShape.Type;

export const OrchestrationProposedPlan = Schema.Union([
  OrchestrationProposedPlanLegacyShape,
  OrchestrationProposedPlanShape,
]).pipe(
  Schema.decode({
    decode: SchemaGetter.transform((input: OrchestrationProposedPlanLegacyCompatible) => ({
      id: input.id,
      turnId: input.turnId,
      planMarkdown: input.planMarkdown,
      planIntent: input.planIntent,
      followUpOutcome:
        input.followUpOutcome ??
        ("implementedAt" in input && input.implementedAt
          ? {
              kind: "implement-code" as const,
              completedAt: input.implementedAt,
              targetThreadId: input.implementationThreadId,
            }
          : null),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })),
    encode: SchemaGetter.transform((input: OrchestrationProposedPlanLegacyCompatible) => input),
  }),
) as unknown as typeof OrchestrationProposedPlanShape;
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationThreadIssueLink = Schema.Struct({
  issueId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  priority: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
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

// Browser-facing orchestration session status. This is a projected UX state
// used by coordinator/chat read models, so it intentionally includes derived
// states such as `idle` and `interrupted` that do not exist in the raw runtime
// protocol. It stays distinct from:
// - ProviderSessionStatus in provider.ts, which models the client/provider API
//   handle lifecycle
// - RuntimeSessionState in providerRuntime.ts, which preserves raw provider
//   protocol states like `waiting`
// - ProviderSessionRuntimeStatus below, which only tracks the persisted server
//   process lifecycle for runtime supervision
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
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
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

export const OrchestrationCheckpointCaptureRequest = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  assistantMessageId: Schema.NullOr(MessageId),
  requestedAt: IsoDateTime,
});
export type OrchestrationCheckpointCaptureRequest =
  typeof OrchestrationCheckpointCaptureRequest.Type;

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

export const OrchestrationTurnStatus = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationTurnStatus = typeof OrchestrationTurnStatus.Type;

export const OrchestrationTurnTerminalSource = Schema.Literals([
  "turn_completed",
  "interrupt_request",
  "checkpoint_fallback",
]);
export type OrchestrationTurnTerminalSource = typeof OrchestrationTurnTerminalSource.Type;

export const OrchestrationSettledTurn = Schema.Struct({
  turnId: TurnId,
  state: Schema.Literals(["completed", "interrupted", "error"]),
  completedAt: IsoDateTime,
});
export type OrchestrationSettledTurn = typeof OrchestrationSettledTurn.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationTurnStatus,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  terminalSource: Schema.optional(OrchestrationTurnTerminalSource),
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
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issueLink: Schema.NullOr(OrchestrationThreadIssueLink).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  subagentRuns: Schema.Array(OrchestrationSubagentRun).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  pendingCheckpointCaptures: Schema.Array(OrchestrationCheckpointCaptureRequest).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
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
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
    ),
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

export const OrchestrationEpicRunStatus = Schema.Literals([
  "pending",
  "running",
  "stopping",
  "stopped",
  "failed",
  "completed",
]);
export type OrchestrationEpicRunStatus = typeof OrchestrationEpicRunStatus.Type;

export const OrchestrationEpicIssueExecutionStatus = Schema.Literals([
  "launching",
  "running",
  "stopping",
  "stopped",
  "completed",
  "failed",
]);
export type OrchestrationEpicIssueExecutionStatus =
  typeof OrchestrationEpicIssueExecutionStatus.Type;

export const OrchestrationEpicRunFailureKind = Schema.Literals([
  "launch_failure",
  "worker_failure",
  "issue_incomplete",
  "environment_failure",
  "invariant_violation",
]);
export type OrchestrationEpicRunFailureKind = typeof OrchestrationEpicRunFailureKind.Type;

export const OrchestrationEpicRunFailureContext = Schema.Struct({
  kind: OrchestrationEpicRunFailureKind,
  message: TrimmedNonEmptyString,
  issueId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  executionId: Schema.NullOr(EpicIssueExecutionId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  workerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type OrchestrationEpicRunFailureContext = typeof OrchestrationEpicRunFailureContext.Type;

export const OrchestrationEpicWorkspaceKey = TrimmedNonEmptyString;
export type OrchestrationEpicWorkspaceKey = typeof OrchestrationEpicWorkspaceKey.Type;
export const DEFAULT_ORCHESTRATION_EPIC_WORKSPACE_KEY: OrchestrationEpicWorkspaceKey = "shared";

export const OrchestrationEpicRun = Schema.Struct({
  runId: EpicRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  status: OrchestrationEpicRunStatus,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  failureContext: Schema.NullOr(OrchestrationEpicRunFailureContext).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  stopRequestedAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  stoppedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  failedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type OrchestrationEpicRun = typeof OrchestrationEpicRun.Type;

export const OrchestrationEpicIssueExecution = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  sequenceNumber: NonNegativeInt,
  status: OrchestrationEpicIssueExecutionStatus,
  workspaceKey: OrchestrationEpicWorkspaceKey.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ORCHESTRATION_EPIC_WORKSPACE_KEY)),
  ),
  workspacePath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  failureContext: Schema.NullOr(OrchestrationEpicRunFailureContext).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  stopRequestedAt: Schema.NullOr(IsoDateTime).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  stoppedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  failedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  updatedAt: IsoDateTime,
});
export type OrchestrationEpicIssueExecution = typeof OrchestrationEpicIssueExecution.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  planImplementationLaunches: Schema.Array(OrchestrationPlanImplementationLaunch).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  epicRuns: Schema.Array(OrchestrationEpicRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  epicIssueExecutions: Schema.Array(OrchestrationEpicIssueExecution).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  epicRuns: Schema.Array(OrchestrationEpicRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  epicIssueExecutions: Schema.Array(OrchestrationEpicIssueExecution).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
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
  force: Schema.optional(Schema.Boolean),
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
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
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
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
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
  settledTurn: Schema.optional(OrchestrationSettledTurn),
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

export const ThreadCheckpointCaptureRequestCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.capture.request"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  assistantMessageId: Schema.optional(MessageId),
  requestedAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type ThreadCheckpointCaptureRequestCommand =
  typeof ThreadCheckpointCaptureRequestCommand.Type;

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

export const ThreadSubagentRunUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.subagent-run.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  run: OrchestrationSubagentRun,
  createdAt: IsoDateTime,
});
export type ThreadSubagentRunUpsertCommand = typeof ThreadSubagentRunUpsertCommand.Type;

export const ThreadSubagentEntryAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.subagent-entry.append"),
  commandId: CommandId,
  threadId: ThreadId,
  runId: TrimmedNonEmptyString,
  entry: OrchestrationSubagentEntry,
  createdAt: IsoDateTime,
});
export type ThreadSubagentEntryAppendCommand = typeof ThreadSubagentEntryAppendCommand.Type;

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
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
    ),
  ),
  promptText: Schema.String,
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderOptionSelections),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
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

const EpicRunRequestCommand = Schema.Struct({
  type: Schema.Literal("epic-run.request"),
  commandId: CommandId,
  runId: EpicRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderOptionSelections),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  createdAt: IsoDateTime,
});

const EpicRunMarkStartedCommand = Schema.Struct({
  type: Schema.Literal("epic-run.mark-started"),
  commandId: CommandId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const EpicRunFailCommand = Schema.Struct({
  type: Schema.Literal("epic-run.fail"),
  commandId: CommandId,
  runId: EpicRunId,
  reason: TrimmedNonEmptyString,
  issueId: Schema.optional(TrimmedNonEmptyString),
  executionId: Schema.optional(EpicIssueExecutionId),
  workerThreadId: Schema.optional(ThreadId),
  createdAt: IsoDateTime,
});

const EpicRunStopCommand = Schema.Struct({
  type: Schema.Literal("epic-run.stop"),
  commandId: CommandId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const EpicRunCompleteCommand = Schema.Struct({
  type: Schema.Literal("epic-run.complete"),
  commandId: CommandId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const EpicIssueExecutionRequestCommand = Schema.Struct({
  type: Schema.Literal("epic-issue-execution.request"),
  commandId: CommandId,
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: ThreadId,
  sequenceNumber: NonNegativeInt,
  createdAt: IsoDateTime,
});

const EpicIssueExecutionStartCommand = Schema.Struct({
  type: Schema.Literal("epic-issue-execution.start"),
  commandId: CommandId,
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const EpicIssueExecutionCompleteCommand = Schema.Struct({
  type: Schema.Literal("epic-issue-execution.complete"),
  commandId: CommandId,
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const EpicIssueExecutionFailCommand = Schema.Struct({
  type: Schema.Literal("epic-issue-execution.fail"),
  commandId: CommandId,
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  reason: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const EpicIssueExecutionStopCommand = Schema.Struct({
  type: Schema.Literal("epic-issue-execution.stop"),
  commandId: CommandId,
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadCheckpointCaptureRequestCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadSubagentRunUpsertCommand,
  ThreadSubagentEntryAppendCommand,
  ThreadRevertCompleteCommand,
  PlanImplementationLaunchRequestCommand,
  PlanImplementationLaunchMarkWorktreePreparedCommand,
  PlanImplementationLaunchMarkStartedCommand,
  PlanImplementationLaunchFailCommand,
  PlanImplementationLaunchCancelCommand,
  EpicRunRequestCommand,
  EpicRunMarkStartedCommand,
  EpicRunFailCommand,
  EpicRunStopCommand,
  EpicRunCompleteCommand,
  EpicIssueExecutionRequestCommand,
  EpicIssueExecutionStartCommand,
  EpicIssueExecutionCompleteCommand,
  EpicIssueExecutionFailCommand,
  EpicIssueExecutionStopCommand,
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
  "thread.checkpoint-capture-requested",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "thread.subagent-run-upserted",
  "thread.subagent-entry-appended",
  "plan-implementation-launch.requested",
  "plan-implementation-launch.worktree-prepared",
  "plan-implementation-launch.started",
  "plan-implementation-launch.failed",
  "plan-implementation-launch.cancelled",
  "epic-run.requested",
  "epic-run.started",
  "epic-run.failed",
  "epic-run.stopped",
  "epic-run.completed",
  "epic-issue-execution.requested",
  "epic-issue-execution.started",
  "epic-issue-execution.completed",
  "epic-issue-execution.failed",
  "epic-issue-execution.stopped",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals([
  "project",
  "thread",
  "planImplementationLaunch",
  "epicRun",
  "epicIssueExecution",
]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
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
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  issueLink: Schema.NullOr(OrchestrationThreadIssueLink).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
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
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
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
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
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
  settledTurn: Schema.optional(OrchestrationSettledTurn),
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadCheckpointCaptureRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  request: OrchestrationCheckpointCaptureRequest,
});
export type ThreadCheckpointCaptureRequestedPayload =
  typeof ThreadCheckpointCaptureRequestedPayload.Type;

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

export const ThreadSubagentRunUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  run: OrchestrationSubagentRun,
});
export type ThreadSubagentRunUpsertedPayload = typeof ThreadSubagentRunUpsertedPayload.Type;

export const ThreadSubagentEntryAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  runId: TrimmedNonEmptyString,
  entry: OrchestrationSubagentEntry,
});
export type ThreadSubagentEntryAppendedPayload = typeof ThreadSubagentEntryAppendedPayload.Type;

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
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
    ),
  ),
  promptText: Schema.String,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderOptionSelections),
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

export const EpicRunRequestedPayload = Schema.Struct({
  runId: EpicRunId,
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  provider: Schema.NullOr(ProviderKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  providerOptions: Schema.NullOr(ProviderStartOptions),
  assistantDeliveryMode: Schema.NullOr(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicRunStartedPayload = Schema.Struct({
  runId: EpicRunId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicRunFailedPayload = Schema.Struct({
  runId: EpicRunId,
  reason: TrimmedNonEmptyString,
  issueId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  executionId: Schema.NullOr(EpicIssueExecutionId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  workerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicRunStoppedPayload = Schema.Struct({
  runId: EpicRunId,
  stoppedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicRunCompletedPayload = Schema.Struct({
  runId: EpicRunId,
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicIssueExecutionStartedPayload = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicIssueExecutionRequestedPayload = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  issueId: TrimmedNonEmptyString,
  workerThreadId: ThreadId,
  sequenceNumber: NonNegativeInt,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicIssueExecutionCompletedPayload = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicIssueExecutionFailedPayload = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  reason: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const EpicIssueExecutionStoppedPayload = Schema.Struct({
  executionId: EpicIssueExecutionId,
  runId: EpicRunId,
  stoppedAt: IsoDateTime,
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
    EpicRunId,
    EpicIssueExecutionId,
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
    type: Schema.Literal("thread.checkpoint-capture-requested"),
    payload: ThreadCheckpointCaptureRequestedPayload,
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
    type: Schema.Literal("thread.subagent-run-upserted"),
    payload: ThreadSubagentRunUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.subagent-entry-appended"),
    payload: ThreadSubagentEntryAppendedPayload,
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
    type: Schema.Literal("epic-run.requested"),
    payload: EpicRunRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.started"),
    payload: EpicRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.failed"),
    payload: EpicRunFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.stopped"),
    payload: EpicRunStoppedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.completed"),
    payload: EpicRunCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.requested"),
    payload: EpicIssueExecutionRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.started"),
    payload: EpicIssueExecutionStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.completed"),
    payload: EpicIssueExecutionCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.failed"),
    payload: EpicIssueExecutionFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.stopped"),
    payload: EpicIssueExecutionStoppedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationEpicRunLifecycleEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.requested"),
    payload: EpicRunRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.started"),
    payload: EpicRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.failed"),
    payload: EpicRunFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.stopped"),
    payload: EpicRunStoppedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-run.completed"),
    payload: EpicRunCompletedPayload,
  }),
]);
export type OrchestrationEpicRunLifecycleEvent = typeof OrchestrationEpicRunLifecycleEvent.Type;

export const OrchestrationEpicIssueExecutionLifecycleEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.requested"),
    payload: EpicIssueExecutionRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.started"),
    payload: EpicIssueExecutionStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.completed"),
    payload: EpicIssueExecutionCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.failed"),
    payload: EpicIssueExecutionFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("epic-issue-execution.stopped"),
    payload: EpicIssueExecutionStoppedPayload,
  }),
]);
export type OrchestrationEpicIssueExecutionLifecycleEvent =
  typeof OrchestrationEpicIssueExecutionLifecycleEvent.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("epic-run-event"),
    sequence: NonNegativeInt,
    event: OrchestrationEpicRunLifecycleEvent,
  }),
  Schema.Struct({
    kind: Schema.Literal("epic-issue-execution-event"),
    sequence: NonNegativeInt,
    event: OrchestrationEpicIssueExecutionLifecycleEvent,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

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

// Persisted provider-session runtime process status. This tracks only the
// server's runtime-process lifecycle for supervision and restart handling, so
// it intentionally excludes browser projection states (`idle`, `interrupted`),
// raw provider protocol states (`waiting`, `ready`), and client handle states
// such as `connecting` or `closed`.
export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

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

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
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
  modelOptions: Schema.optional(ProviderOptionSelections),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  launchMode: OrchestrationPlanImplementationLaunchMode.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATION_PLAN_IMPLEMENTATION_LAUNCH_MODE),
    ),
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

export const OrchestrationStartEpicRunInput = Schema.Struct({
  projectId: ProjectId,
  epicIssueId: TrimmedNonEmptyString,
  provider: Schema.optional(ProviderKind),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optional(ProviderOptionSelections),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
});
export type OrchestrationStartEpicRunInput = typeof OrchestrationStartEpicRunInput.Type;

const OrchestrationEpicRunControlInput = Schema.Struct({
  runId: EpicRunId,
});
export type OrchestrationEpicRunControlInput = typeof OrchestrationEpicRunControlInput.Type;

export const OrchestrationStopEpicRunInput = OrchestrationEpicRunControlInput;
export type OrchestrationStopEpicRunInput = typeof OrchestrationStopEpicRunInput.Type;

export const OrchestrationEpicRunControlResult = Schema.Struct({
  runId: EpicRunId,
  status: OrchestrationEpicRunStatus,
});
export type OrchestrationEpicRunControlResult = typeof OrchestrationEpicRunControlResult.Type;

export const OrchestrationRpcSchemas = {
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
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
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
  startEpicRun: {
    input: OrchestrationStartEpicRunInput,
    output: OrchestrationEpicRunControlResult,
  },
  stopEpicRun: {
    input: OrchestrationStopEpicRunInput,
    output: OrchestrationEpicRunControlResult,
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
