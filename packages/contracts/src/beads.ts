import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  ModelSelection,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
  RuntimeMode,
} from "./orchestration";

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
  getEpicRunSupport: "beads.getEpicRunSupport",
  getIssueGraph: "beads.getIssueGraph",
  getEpicTrackerSummary: "beads.getEpicTrackerSummary",
  validateEpicRun: "beads.validateEpicRun",
  getEpicTrackerStatus: "beads.getEpicTrackerStatus",
  listEpicTrackerSummaries: "beads.listEpicTrackerSummaries",
  getProjectCoordinatorSnapshot: "beads.getProjectCoordinatorSnapshot",
  getEpicCoordinatorSnapshot: "beads.getEpicCoordinatorSnapshot",
  startEpicQuickRefine: "beads.startEpicQuickRefine",
  startEpicPlannedRefine: "beads.startEpicPlannedRefine",
  startEpicCoordinationPrep: "beads.startEpicCoordinationPrep",
  getIssues: "beads.getIssues",
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

export const BeadsIssueSummary = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(() => null)),
  issueType: BeadsIssueType,
  assignee: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  createdBy: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  updatedAt: IsoDateTime,
  labels: Schema.Array(BeadsLabel).pipe(Schema.withDecodingDefault(() => [])),
  parent: Schema.NullOr(BeadsIssueParentRef).pipe(Schema.withDecodingDefault(() => null)),
  dependencyCount: Schema.optional(NonNegativeInt),
  dependentCount: Schema.optional(NonNegativeInt),
  commentCount: Schema.optional(NonNegativeInt),
});
export type BeadsIssueSummary = typeof BeadsIssueSummary.Type;

export const BeadsIssueDependency = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(() => null)),
  issueType: BeadsIssueType,
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  createdBy: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  updatedAt: IsoDateTime,
  dependencyType: TrimmedNonEmptyString,
});
export type BeadsIssueDependency = typeof BeadsIssueDependency.Type;

export const BeadsIssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  issueId: BeadsIssueId,
  author: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type BeadsIssueComment = typeof BeadsIssueComment.Type;

export const BeadsIssueDetail = Schema.Struct({
  ...BeadsIssueSummary.fields,
  dependencies: Schema.Array(BeadsIssueDependency).pipe(Schema.withDecodingDefault(() => [])),
  comments: Schema.Array(BeadsIssueComment).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsIssueDetail = typeof BeadsIssueDetail.Type;

export const BeadsBackendInfo = Schema.Struct({
  kind: TrimmedNonEmptyString,
  doltMode: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  database: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  projectId: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  role: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  bdVersion: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
});
export type BeadsBackendInfo = typeof BeadsBackendInfo.Type;

export const BeadsEpicRunSupport = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  backend: BeadsBackendInfo,
});
export type BeadsEpicRunSupport = typeof BeadsEpicRunSupport.Type;

export const BeadsContext = Schema.Struct({
  beadsDir: TrimmedNonEmptyString,
  repoRoot: TrimmedNonEmptyString,
  cwdRepoRoot: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  isRedirected: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  isWorktree: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  backend: BeadsBackendInfo,
});
export type BeadsContext = typeof BeadsContext.Type;

export const BeadsIssueRelationSummary = Schema.Struct({
  id: BeadsIssueId,
  title: TrimmedNonEmptyString,
  status: BeadsIssueStatus,
  priority: BeadsPriority.pipe(Schema.withDecodingDefault(() => null)),
  issueType: BeadsIssueType,
  assignee: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  owner: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  parent: Schema.NullOr(BeadsIssueParentRef).pipe(Schema.withDecodingDefault(() => null)),
});
export type BeadsIssueRelationSummary = typeof BeadsIssueRelationSummary.Type;

export const BeadsIssueGraph = Schema.Struct({
  epic: BeadsIssueDetail,
  parent: Schema.NullOr(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => null)),
  children: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  dependencies: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  dependents: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsIssueGraph = typeof BeadsIssueGraph.Type;

export const BeadsEpicTrackerSummary = Schema.Struct({
  trackerId: BeadsIssueId,
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  totalIssueCount: NonNegativeInt,
  completedIssueCount: NonNegativeInt,
  activeIssueCount: NonNegativeInt,
  readyIssueCount: NonNegativeInt,
  blockedIssueCount: NonNegativeInt,
  activeWorkerCount: NonNegativeInt,
});
export type BeadsEpicTrackerSummary = typeof BeadsEpicTrackerSummary.Type;

export const BeadsEpicRunValidation = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  trackerSummary: Schema.NullOr(BeadsEpicTrackerSummary).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  valid: Schema.Boolean,
  errors: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  warnings: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  readyFronts: Schema.Array(Schema.Array(BeadsIssueRelationSummary)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  estimatedWorkerSessions: Schema.NullOr(NonNegativeInt).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  maxParallelism: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(() => null)),
});
export type BeadsEpicRunValidation = typeof BeadsEpicRunValidation.Type;

export const BeadsEpicTrackerBlockedBreakdown = Schema.Struct({
  internal: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  external: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  unknown: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsEpicTrackerBlockedBreakdown = typeof BeadsEpicTrackerBlockedBreakdown.Type;

export const BeadsEpicTrackerStatus = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  trackerSummary: Schema.NullOr(BeadsEpicTrackerSummary).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  completed: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  active: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  ready: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  blocked: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  blockedBreakdown: BeadsEpicTrackerBlockedBreakdown.pipe(
    Schema.withDecodingDefault(() => ({
      internal: [],
      external: [],
      unknown: [],
    })),
  ),
});
export type BeadsEpicTrackerStatus = typeof BeadsEpicTrackerStatus.Type;

export const BeadsCoordinatorTrackerLoadState = Schema.Literals(["ready", "timeout", "error"]);
export type BeadsCoordinatorTrackerLoadState = typeof BeadsCoordinatorTrackerLoadState.Type;

export const BeadsCoordinatorValidationState = Schema.Literals(["unknown", "valid", "invalid"]);
export type BeadsCoordinatorValidationState = typeof BeadsCoordinatorValidationState.Type;

export const BeadsCoordinatorTrackerState = Schema.Literals([
  "unknown",
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);
export type BeadsCoordinatorTrackerState = typeof BeadsCoordinatorTrackerState.Type;

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

export const BeadsCoordinatorPrimaryAction = Schema.Struct({
  kind: Schema.Literals([
    "unsupported",
    "open_coordination_prep_thread",
    "refresh_epic_status",
    "start_epic_run",
    "stop_epic_run",
    "open_coordinator",
  ]),
  label: TrimmedNonEmptyString,
  busyLabel: TrimmedNonEmptyString,
  disabled: Schema.Boolean,
});
export type BeadsCoordinatorPrimaryAction = typeof BeadsCoordinatorPrimaryAction.Type;

export const BeadsCoordinatorProjectConflict = Schema.Struct({
  run: OrchestrationEpicRun,
  message: TrimmedNonEmptyString,
});
export type BeadsCoordinatorProjectConflict = typeof BeadsCoordinatorProjectConflict.Type;

export const BeadsCoordinatorEpicSnapshot = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  issue: Schema.NullOr(BeadsIssueSummary).pipe(Schema.withDecodingDefault(() => null)),
  trackerLoadState: BeadsCoordinatorTrackerLoadState,
  trackerLoadDetail: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  coordinationSupported: Schema.Boolean,
  coordinationUnsupportedReason: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  validationState: BeadsCoordinatorValidationState,
  validationErrors: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  trackerState: BeadsCoordinatorTrackerState,
  progress: BeadsCoordinatorProgress,
  primaryAction: BeadsCoordinatorPrimaryAction,
  activeRunId: Schema.NullOr(EpicRunId).pipe(Schema.withDecodingDefault(() => null)),
  activeExecutionId: Schema.NullOr(EpicIssueExecutionId).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  projectConflict: Schema.NullOr(BeadsCoordinatorProjectConflict).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  trackerSummary: Schema.NullOr(BeadsEpicTrackerSummary).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  validation: Schema.NullOr(BeadsEpicRunValidation).pipe(Schema.withDecodingDefault(() => null)),
  status: Schema.NullOr(BeadsEpicTrackerStatus).pipe(Schema.withDecodingDefault(() => null)),
  runs: Schema.Array(OrchestrationEpicRun).pipe(Schema.withDecodingDefault(() => [])),
  executions: Schema.Array(OrchestrationEpicIssueExecution).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type BeadsCoordinatorEpicSnapshot = typeof BeadsCoordinatorEpicSnapshot.Type;

export const BeadsIssueSortBy = Schema.Literals(["updated", "created", "priority", "title"]);
export type BeadsIssueSortBy = typeof BeadsIssueSortBy.Type;

export const BeadsQueryIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  search: Schema.optional(TrimmedNonEmptyString),
  statuses: Schema.optional(Schema.Array(BeadsIssueStatus)),
  issueTypes: Schema.optional(Schema.Array(BeadsIssueType)),
  priorities: Schema.optional(Schema.Array(NonNegativeInt)),
  sortBy: BeadsIssueSortBy.pipe(Schema.withDecodingDefault(() => "updated")),
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

export const BeadsGetContextInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetContextInput = typeof BeadsGetContextInput.Type;

export const BeadsGetEpicRunSupportInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetEpicRunSupportInput = typeof BeadsGetEpicRunSupportInput.Type;

export const BeadsEpicIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicIssueInput = typeof BeadsEpicIssueInput.Type;

export const BeadsListEpicTrackerSummariesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsListEpicTrackerSummariesInput = typeof BeadsListEpicTrackerSummariesInput.Type;

export const BeadsProjectCoordinatorSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
});
export type BeadsProjectCoordinatorSnapshotInput = typeof BeadsProjectCoordinatorSnapshotInput.Type;

export const BeadsProjectCoordinatorSnapshot = Schema.Struct({
  projectId: ProjectId,
  support: BeadsEpicRunSupport,
  epics: Schema.Array(BeadsCoordinatorEpicSnapshot).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsProjectCoordinatorSnapshot = typeof BeadsProjectCoordinatorSnapshot.Type;

export const BeadsEpicCoordinatorSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicCoordinatorSnapshotInput = typeof BeadsEpicCoordinatorSnapshotInput.Type;

export const BeadsEpicCoordinatorSnapshot = Schema.Struct({
  projectId: ProjectId,
  support: BeadsEpicRunSupport,
  epic: BeadsCoordinatorEpicSnapshot,
});
export type BeadsEpicCoordinatorSnapshot = typeof BeadsEpicCoordinatorSnapshot.Type;

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

export const BeadsListEpicTrackerSummariesResult = Schema.Struct({
  trackerSummaries: Schema.Array(BeadsEpicTrackerSummary).pipe(
    Schema.withDecodingDefault(() => []),
  ),
});
export type BeadsListEpicTrackerSummariesResult = typeof BeadsListEpicTrackerSummariesResult.Type;

export class BeadsError extends Schema.TaggedErrorClass<BeadsError>()("BeadsError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
