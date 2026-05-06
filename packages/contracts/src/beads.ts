import { Effect, Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import {
  ModelSelection,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  RuntimeMode,
} from "./orchestration.ts";

export const BEADS_WS_METHODS = {
  queryIssues: "beads.queryIssues",
  getIssue: "beads.getIssue",
  createIssue: "beads.createIssue",
  updateIssue: "beads.updateIssue",
  commentIssue: "beads.commentIssue",
  getSessionActivity: "beads.getSessionActivity",
  startWorkflow: "beads.startWorkflow",
  startBacklogGrooming: "beads.startBacklogGrooming",
  getContext: "beads.getContext",
  getIssueGraph: "beads.getIssueGraph",
  validateEpicCoordination: "beads.validateEpicCoordination",
  getEpicCoordinationStatus: "beads.getEpicCoordinationStatus",
  getProjectRunSummary: "beads.getProjectRunSummary",
  getEpicIssueSummaries: "beads.getEpicIssueSummaries",
  getEpicCoordinationDetail: "beads.getEpicCoordinationDetail",
  startEpicQuickRefine: "beads.startEpicQuickRefine",
  startEpicPlannedRefine: "beads.startEpicPlannedRefine",
  startEpicCoordinationPrep: "beads.startEpicCoordinationPrep",
  getIssues: "beads.getIssues",
  resolveIssueRefs: "beads.resolveIssueRefs",
} as const;

const BeadsIssueId = TrimmedNonEmptyString;
export type BeadsIssueId = typeof BeadsIssueId.Type;

const BeadsIssueStatus = TrimmedNonEmptyString;
export type BeadsIssueStatus = typeof BeadsIssueStatus.Type;

const BeadsIssueType = TrimmedNonEmptyString;
export type BeadsIssueType = typeof BeadsIssueType.Type;

const BeadsLabel = TrimmedNonEmptyString;
export type BeadsLabel = typeof BeadsLabel.Type;

const BeadsPriority = Schema.NullOr(NonNegativeInt);
export type BeadsPriority = typeof BeadsPriority.Type;

export const BeadsIssueParentRef = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
});
export type BeadsIssueParentRef = typeof BeadsIssueParentRef.Type;

export const BeadsIssueSummaryDependencyRef = Schema.Struct({
  issueId: BeadsIssueId,
  dependsOnId: BeadsIssueId,
  dependencyType: TrimmedNonEmptyString,
});
export type BeadsIssueSummaryDependencyRef = typeof BeadsIssueSummaryDependencyRef.Type;

export const BeadsIssueSummary = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  issueType: BeadsIssueType,
  assignee: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  createdBy: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  updatedAt: IsoDateTime,
  labels: Schema.Array(BeadsLabel).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  molType: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  parent: Schema.NullOr(BeadsIssueParentRef).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  dependencyRefs: Schema.Array(BeadsIssueSummaryDependencyRef).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependencyCount: Schema.optional(NonNegativeInt),
  dependentCount: Schema.optional(NonNegativeInt),
  commentCount: Schema.optional(NonNegativeInt),
});
export type BeadsIssueSummary = typeof BeadsIssueSummary.Type;

export const BeadsIssueReferenceSummary = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  status: BeadsIssueStatus,
  issueType: BeadsIssueType,
});
export type BeadsIssueReferenceSummary = typeof BeadsIssueReferenceSummary.Type;

export const BeadsIssueReferenceLoadError = Schema.Struct({
  issueId: BeadsIssueId,
  message: TrimmedNonEmptyString,
});
export type BeadsIssueReferenceLoadError = typeof BeadsIssueReferenceLoadError.Type;

export const BeadsIssueDependency = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  issueType: BeadsIssueType,
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  createdBy: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  updatedAt: IsoDateTime,
  dependencyType: TrimmedNonEmptyString,
});
export type BeadsIssueDependency = typeof BeadsIssueDependency.Type;

export const BeadsIssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  issueId: BeadsIssueId,
  author: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type BeadsIssueComment = typeof BeadsIssueComment.Type;

export const BeadsIssueDetail = Schema.Struct({
  ...BeadsIssueSummary.fields,
  dependencies: Schema.Array(BeadsIssueDependency).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  comments: Schema.Array(BeadsIssueComment).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type BeadsIssueDetail = typeof BeadsIssueDetail.Type;

export const BeadsBackendInfo = Schema.Struct({
  kind: TrimmedNonEmptyString,
  doltMode: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  database: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  projectId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  role: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  bdVersion: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type BeadsBackendInfo = typeof BeadsBackendInfo.Type;

export const BeadsContext = Schema.Struct({
  beadsDir: TrimmedNonEmptyString,
  repoRoot: TrimmedNonEmptyString,
  cwdRepoRoot: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  isRedirected: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  isWorktree: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  backend: BeadsBackendInfo,
});
export type BeadsContext = typeof BeadsContext.Type;

export const BeadsIssueRelationSummary = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  issueType: BeadsIssueType,
  assignee: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  parent: Schema.NullOr(BeadsIssueParentRef).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type BeadsIssueRelationSummary = typeof BeadsIssueRelationSummary.Type;

export const BeadsIssueGraph = Schema.Struct({
  epic: BeadsIssueDetail,
  parent: Schema.NullOr(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  children: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependencies: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependents: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsIssueGraph = typeof BeadsIssueGraph.Type;

export const BeadsEpicCoordinationSummary = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  totalIssueCount: NonNegativeInt,
  completedIssueCount: NonNegativeInt,
  activeIssueCount: NonNegativeInt,
  readyIssueCount: NonNegativeInt,
  blockedIssueCount: NonNegativeInt,
  activeWorkerCount: NonNegativeInt,
});
export type BeadsEpicCoordinationSummary = typeof BeadsEpicCoordinationSummary.Type;

export const BeadsEpicCoordinationValidation = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  summary: Schema.NullOr(BeadsEpicCoordinationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  valid: Schema.Boolean,
  errors: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  warnings: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  readyFronts: Schema.Array(Schema.Array(BeadsIssueRelationSummary)).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  estimatedWorkerSessions: Schema.NullOr(NonNegativeInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  maxParallelism: Schema.NullOr(NonNegativeInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type BeadsEpicCoordinationValidation = typeof BeadsEpicCoordinationValidation.Type;

export const BeadsEpicCoordinationBlockedBreakdown = Schema.Struct({
  internal: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  external: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  unknown: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsEpicCoordinationBlockedBreakdown =
  typeof BeadsEpicCoordinationBlockedBreakdown.Type;

export const BeadsEpicCoordinationStatus = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  summary: Schema.NullOr(BeadsEpicCoordinationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  completed: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  active: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  ready: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  blocked: Schema.Array(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  blockedBreakdown: BeadsEpicCoordinationBlockedBreakdown.pipe(
    Schema.withDecodingDefault(Effect.succeed({ internal: [], external: [], unknown: [] })),
  ),
});
export type BeadsEpicCoordinationStatus = typeof BeadsEpicCoordinationStatus.Type;

export const BeadsCoordinatorLoadState = Schema.Literals(["ready", "timeout", "error"]);
export type BeadsCoordinatorLoadState = typeof BeadsCoordinatorLoadState.Type;

export const BeadsCoordinatorValidationState = Schema.Literals(["unknown", "valid", "invalid"]);
export type BeadsCoordinatorValidationState = typeof BeadsCoordinatorValidationState.Type;

export const BeadsCoordinatorState = Schema.Literals([
  "unknown",
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);
export type BeadsCoordinatorState = typeof BeadsCoordinatorState.Type;

export const BeadsCoordinatorProgress = Schema.Struct({
  totalIssueCount: NonNegativeInt,
  completedIssueCount: NonNegativeInt,
  readyIssueCount: NonNegativeInt,
  activeIssueCount: NonNegativeInt,
  blockedIssueCount: NonNegativeInt,
  internalBlockedIssueCount: NonNegativeInt,
  externalBlockedIssueCount: NonNegativeInt,
  unknownBlockedIssueCount: NonNegativeInt,
  activeWorkerCount: NonNegativeInt,
  isComplete: Schema.Boolean,
});
export type BeadsCoordinatorProgress = typeof BeadsCoordinatorProgress.Type;

export const BeadsEpicExecutionState = Schema.Literals([
  "checking",
  "error",
  "needs_preparation",
  "ready",
  "running",
  "waiting",
  "blocked",
  "failed",
  "completed",
]);
export type BeadsEpicExecutionState = typeof BeadsEpicExecutionState.Type;

export const BeadsEpicExecution = Schema.Struct({
  state: BeadsEpicExecutionState,
  summary: TrimmedNonEmptyString,
  blockingReason: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  nextIssue: Schema.NullOr(BeadsIssueRelationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type BeadsEpicExecution = typeof BeadsEpicExecution.Type;

export const BeadsEpicCommand = Schema.Struct({
  kind: Schema.Literals([
    "open_coordination_prep_thread",
    "refresh_epic_status",
    "start_epic_run",
    "stop_epic_run",
  ]),
  label: TrimmedNonEmptyString,
  busyLabel: TrimmedNonEmptyString,
  disabled: Schema.Boolean,
  disabledReason: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type BeadsEpicCommand = typeof BeadsEpicCommand.Type;

export const BeadsCoordinatorProjectConflict = Schema.Struct({
  run: OrchestrationEpicRun,
  message: TrimmedNonEmptyString,
});
export type BeadsCoordinatorProjectConflict = typeof BeadsCoordinatorProjectConflict.Type;

export const BeadsCoordinatorEpicSnapshot = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  issue: Schema.NullOr(BeadsIssueSummary).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  coordinationLoadState: BeadsCoordinatorLoadState,
  coordinationLoadDetail: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  validationState: BeadsCoordinatorValidationState,
  validationErrors: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  coordinationState: BeadsCoordinatorState,
  progress: BeadsCoordinatorProgress,
  execution: BeadsEpicExecution,
  commands: Schema.Array(BeadsEpicCommand).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  activeRunId: Schema.NullOr(EpicRunId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  activeExecutionId: Schema.NullOr(EpicIssueExecutionId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  projectConflict: Schema.NullOr(BeadsCoordinatorProjectConflict).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  summary: Schema.NullOr(BeadsEpicCoordinationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  validation: Schema.NullOr(BeadsEpicCoordinationValidation).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.NullOr(BeadsEpicCoordinationStatus).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  runs: Schema.Array(OrchestrationEpicRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  executions: Schema.Array(OrchestrationEpicIssueExecution).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsCoordinatorEpicSnapshot = typeof BeadsCoordinatorEpicSnapshot.Type;

export const BeadsIssueSortBy = Schema.Literals(["updated", "created", "priority", "title"]);
export type BeadsIssueSortBy = typeof BeadsIssueSortBy.Type;

export const BeadsQueryIssuesMode = Schema.Literals(["all", "ready"]);
export type BeadsQueryIssuesMode = typeof BeadsQueryIssuesMode.Type;

export const BeadsQueryIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  mode: BeadsQueryIssuesMode.pipe(Schema.withDecodingDefault(Effect.succeed("all"))),
  search: Schema.optional(TrimmedNonEmptyString),
  statuses: Schema.optional(Schema.Array(BeadsIssueStatus)),
  issueTypes: Schema.optional(Schema.Array(BeadsIssueType)),
  priorities: Schema.optional(Schema.Array(NonNegativeInt)),
  sortBy: BeadsIssueSortBy.pipe(Schema.withDecodingDefault(Effect.succeed("updated"))),
});
export type BeadsQueryIssuesInput = typeof BeadsQueryIssuesInput.Type;

export const BeadsQueryIssuesResult = Schema.Struct({
  issues: Schema.Array(BeadsIssueSummary),
});
export type BeadsQueryIssuesResult = typeof BeadsQueryIssuesResult.Type;

export const BeadsGetIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  issueId: BeadsIssueId,
});
export type BeadsGetIssueInput = typeof BeadsGetIssueInput.Type;

export const BeadsGetIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  issueIds: Schema.Array(BeadsIssueId),
});
export type BeadsGetIssuesInput = typeof BeadsGetIssuesInput.Type;

export const BeadsGetIssuesResult = Schema.Struct({
  issues: Schema.Array(BeadsIssueDetail),
});
export type BeadsGetIssuesResult = typeof BeadsGetIssuesResult.Type;

export const BeadsResolveIssueRefsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  issueIds: Schema.Array(BeadsIssueId),
});
export type BeadsResolveIssueRefsInput = typeof BeadsResolveIssueRefsInput.Type;

export const BeadsResolveIssueRefsResult = Schema.Struct({
  issues: Schema.Array(BeadsIssueReferenceSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  missingIssueIds: Schema.Array(BeadsIssueId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  loadErrors: Schema.Array(BeadsIssueReferenceLoadError).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsResolveIssueRefsResult = typeof BeadsResolveIssueRefsResult.Type;

export const BeadsGetContextInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetContextInput = typeof BeadsGetContextInput.Type;

export const BeadsEpicIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicIssueInput = typeof BeadsEpicIssueInput.Type;

export const BeadsProjectRunSummaryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
});
export type BeadsProjectRunSummaryInput = typeof BeadsProjectRunSummaryInput.Type;

export const BeadsProjectRunSummaryEpic = Schema.Struct({
  epicIssueId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  runs: Schema.Array(OrchestrationEpicRun).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  executions: Schema.Array(OrchestrationEpicIssueExecution).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsProjectRunSummaryEpic = typeof BeadsProjectRunSummaryEpic.Type;

export const BeadsProjectRunSummary = Schema.Struct({
  projectId: ProjectId,
  epics: Schema.Array(BeadsProjectRunSummaryEpic).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type BeadsProjectRunSummary = typeof BeadsProjectRunSummary.Type;

export const BeadsEpicIssueSummariesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicIssueSummariesInput = typeof BeadsEpicIssueSummariesInput.Type;

export const BeadsEpicIssueSummaries = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  progress: BeadsCoordinatorProgress,
  issues: Schema.Array(BeadsIssueSummary).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type BeadsEpicIssueSummaries = typeof BeadsEpicIssueSummaries.Type;

export const BeadsEpicCoordinationDetailInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicCoordinationDetailInput = typeof BeadsEpicCoordinationDetailInput.Type;

export const BeadsEpicCoordinationDetail = Schema.Struct({
  epicId: BeadsIssueId,
  coordinationLoadState: BeadsCoordinatorLoadState,
  coordinationLoadDetail: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  validationState: BeadsCoordinatorValidationState,
  validationErrors: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  coordinationState: BeadsCoordinatorState,
  summary: Schema.NullOr(BeadsEpicCoordinationSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  validation: Schema.NullOr(BeadsEpicCoordinationValidation).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.NullOr(BeadsEpicCoordinationStatus).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  execution: BeadsEpicExecution,
  commands: Schema.Array(BeadsEpicCommand).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type BeadsEpicCoordinationDetail = typeof BeadsEpicCoordinationDetail.Type;

export const BeadsUpdateIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  issueId: BeadsIssueId,
  title: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  status: Schema.optional(BeadsIssueStatus),
  priority: Schema.optional(NonNegativeInt),
  assignee: Schema.optional(Schema.NullOr(Schema.String)),
  labels: Schema.optional(Schema.Array(BeadsLabel)),
  claim: Schema.optional(Schema.Boolean),
});
export type BeadsUpdateIssueInput = typeof BeadsUpdateIssueInput.Type;

export const BeadsCreateIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  issueType: Schema.optional(BeadsIssueType),
  priority: Schema.optional(NonNegativeInt),
  assignee: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(BeadsLabel)),
  parent: Schema.optional(BeadsIssueId),
  status: Schema.optional(BeadsIssueStatus),
});
export type BeadsCreateIssueInput = typeof BeadsCreateIssueInput.Type;

export const BeadsCommentIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  issueId: BeadsIssueId,
  text: TrimmedNonEmptyString,
});
export type BeadsCommentIssueInput = typeof BeadsCommentIssueInput.Type;

export const BeadsSessionActivityKind = Schema.Literals([
  "created",
  "updated",
  "commented",
  "workflow-started",
]);
export type BeadsSessionActivityKind = typeof BeadsSessionActivityKind.Type;

export const BeadsIssueWorkflowKind = Schema.Literals([
  "refine",
  "solve",
  "continue",
  "plan-implementation",
]);
export type BeadsIssueWorkflowKind = typeof BeadsIssueWorkflowKind.Type;

export const BeadsSessionWorkflowKind = Schema.Literals([
  "refine",
  "solve",
  "continue",
  "plan-implementation",
  "coordination-prep",
]);
export type BeadsSessionWorkflowKind = typeof BeadsSessionWorkflowKind.Type;

export const BeadsSessionActivityEntry = Schema.Struct({
  kind: BeadsSessionActivityKind,
  issue: BeadsIssueSummary,
  createdAt: IsoDateTime,
  workflowKind: Schema.optional(BeadsSessionWorkflowKind),
  threadId: Schema.optional(ThreadId),
});
export type BeadsSessionActivityEntry = typeof BeadsSessionActivityEntry.Type;

export const BeadsGetSessionActivityInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetSessionActivityInput = typeof BeadsGetSessionActivityInput.Type;

export const BeadsGetSessionActivityResult = Schema.Struct({
  entries: Schema.Array(BeadsSessionActivityEntry),
});
export type BeadsGetSessionActivityResult = typeof BeadsGetSessionActivityResult.Type;

export const BeadsStartWorkflowInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  issueId: BeadsIssueId,
  workflow: BeadsIssueWorkflowKind,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
});
export type BeadsStartWorkflowInput = typeof BeadsStartWorkflowInput.Type;

export const BeadsStartBacklogGroomingInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
});
export type BeadsStartBacklogGroomingInput = typeof BeadsStartBacklogGroomingInput.Type;

export const BeadsStartWorkflowResult = Schema.Struct({
  threadId: ThreadId,
  created: Schema.Boolean,
});
export type BeadsStartWorkflowResult = typeof BeadsStartWorkflowResult.Type;

const BeadsEpicWorkflowStartInputBase = {
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  epicIssueId: BeadsIssueId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
} as const;

export const BeadsStartEpicQuickRefineInput = Schema.Struct(BeadsEpicWorkflowStartInputBase);
export type BeadsStartEpicQuickRefineInput = typeof BeadsStartEpicQuickRefineInput.Type;

export const BeadsStartEpicPlannedRefineInput = Schema.Struct(BeadsEpicWorkflowStartInputBase);
export type BeadsStartEpicPlannedRefineInput = typeof BeadsStartEpicPlannedRefineInput.Type;

export const BeadsStartEpicCoordinationPrepInput = Schema.Struct(BeadsEpicWorkflowStartInputBase);
export type BeadsStartEpicCoordinationPrepInput = typeof BeadsStartEpicCoordinationPrepInput.Type;

export class BeadsError extends Schema.TaggedErrorClass<BeadsError>()("BeadsError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
