import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  ModelSelection,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  RuntimeMode,
} from "./orchestration";

export const BEADS_WS_METHODS = {
  queryIssues: "beads.queryIssues",
  getIssue: "beads.getIssue",
  updateIssue: "beads.updateIssue",
  commentIssue: "beads.commentIssue",
  getSessionActivity: "beads.getSessionActivity",
  startWorkflow: "beads.startWorkflow",
  getContext: "beads.getContext",
  getSwarmSupport: "beads.getSwarmSupport",
  getIssueGraph: "beads.getIssueGraph",
  getEpicSwarm: "beads.getEpicSwarm",
  validateEpicSwarm: "beads.validateEpicSwarm",
  getEpicSwarmStatus: "beads.getEpicSwarmStatus",
  listSwarms: "beads.listSwarms",
  getProjectCoordinatorSnapshot: "beads.getProjectCoordinatorSnapshot",
  getEpicCoordinatorSnapshot: "beads.getEpicCoordinatorSnapshot",
  startEpicQuickRefine: "beads.startEpicQuickRefine",
  startEpicPlannedRefine: "beads.startEpicPlannedRefine",
  startEpicPlanImplementation: "beads.startEpicPlanImplementation",
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

export const BeadsIssueHistoryEntry = Schema.Struct({
  commitHash: TrimmedNonEmptyString,
  committer: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  commitDate: IsoDateTime,
  title: TrimmedNonEmptyString,
  status: BeadsIssueStatus,
});
export type BeadsIssueHistoryEntry = typeof BeadsIssueHistoryEntry.Type;

export const BeadsIssueDetail = Schema.Struct({
  ...BeadsIssueSummary.fields,
  dependencies: Schema.Array(BeadsIssueDependency).pipe(Schema.withDecodingDefault(() => [])),
  comments: Schema.Array(BeadsIssueComment).pipe(Schema.withDecodingDefault(() => [])),
  history: Schema.Array(BeadsIssueHistoryEntry).pipe(Schema.withDecodingDefault(() => [])),
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

export const BeadsSwarmSupport = Schema.Struct({
  supported: Schema.Boolean,
  reason: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  backend: BeadsBackendInfo,
});
export type BeadsSwarmSupport = typeof BeadsSwarmSupport.Type;

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

export const BeadsSwarmSummary = Schema.Struct({
  swarmId: BeadsIssueId,
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  totalIssueCount: NonNegativeInt,
  completedIssueCount: NonNegativeInt,
  activeIssueCount: NonNegativeInt,
  readyIssueCount: NonNegativeInt,
  blockedIssueCount: NonNegativeInt,
  activeWorkerCount: NonNegativeInt,
});
export type BeadsSwarmSummary = typeof BeadsSwarmSummary.Type;

export const BeadsSwarmValidation = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  swarm: Schema.NullOr(BeadsSwarmSummary).pipe(Schema.withDecodingDefault(() => null)),
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
export type BeadsSwarmValidation = typeof BeadsSwarmValidation.Type;

export const BeadsSwarmStatus = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  swarm: Schema.NullOr(BeadsSwarmSummary).pipe(Schema.withDecodingDefault(() => null)),
  completed: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  active: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  ready: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
  blocked: Schema.Array(BeadsIssueRelationSummary).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsSwarmStatus = typeof BeadsSwarmStatus.Type;

export const BeadsCoordinatorFetchLifecycleKind = Schema.Literals([
  "ready",
  "loading",
  "timeout",
  "stale",
  "error",
]);
export type BeadsCoordinatorFetchLifecycleKind = typeof BeadsCoordinatorFetchLifecycleKind.Type;

export const BeadsCoordinatorFetchLifecycle = Schema.Struct({
  kind: BeadsCoordinatorFetchLifecycleKind,
  detail: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
});
export type BeadsCoordinatorFetchLifecycle = typeof BeadsCoordinatorFetchLifecycle.Type;

export const BeadsCoordinatorEpicStateKind = Schema.Literals([
  "checking",
  "timeout",
  "stale",
  "error",
  "unsupported",
  "no_swarm",
  "needs_repair",
  "ready",
  "running",
  "idle",
  "paused",
  "blocked",
  "failed",
  "cancelled",
  "completed",
]);
export type BeadsCoordinatorEpicStateKind = typeof BeadsCoordinatorEpicStateKind.Type;

export const BeadsCoordinatorPrimaryAction = Schema.Struct({
  kind: Schema.Literals([
    "checking",
    "unsupported",
    "create_swarm",
    "repair_swarm",
    "refresh_swarm_state",
    "start_swarm",
    "continue_swarm",
    "open_coordinator",
  ]),
  label: TrimmedNonEmptyString,
  busyLabel: TrimmedNonEmptyString,
  disabled: Schema.Boolean,
});
export type BeadsCoordinatorPrimaryAction = typeof BeadsCoordinatorPrimaryAction.Type;

export const BeadsCoordinatorProjectConflict = Schema.Struct({
  run: OrchestrationSwarmRun,
  message: TrimmedNonEmptyString,
});
export type BeadsCoordinatorProjectConflict = typeof BeadsCoordinatorProjectConflict.Type;

export const BeadsCoordinatorEpicSnapshot = Schema.Struct({
  epicId: BeadsIssueId,
  epicTitle: TrimmedNonEmptyString,
  issue: Schema.NullOr(BeadsIssueSummary).pipe(Schema.withDecodingDefault(() => null)),
  fetchLifecycle: BeadsCoordinatorFetchLifecycle,
  stateKind: BeadsCoordinatorEpicStateKind,
  primaryAction: BeadsCoordinatorPrimaryAction,
  latestRun: Schema.NullOr(OrchestrationSwarmRun).pipe(Schema.withDecodingDefault(() => null)),
  projectConflict: Schema.NullOr(BeadsCoordinatorProjectConflict).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  swarmSummary: Schema.NullOr(BeadsSwarmSummary).pipe(Schema.withDecodingDefault(() => null)),
  validation: Schema.NullOr(BeadsSwarmValidation).pipe(Schema.withDecodingDefault(() => null)),
  status: Schema.NullOr(BeadsSwarmStatus).pipe(Schema.withDecodingDefault(() => null)),
  runs: Schema.Array(OrchestrationSwarmRun).pipe(Schema.withDecodingDefault(() => [])),
  executions: Schema.Array(OrchestrationSwarmTaskExecution).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  activeExecution: Schema.NullOr(OrchestrationSwarmTaskExecution).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type BeadsCoordinatorEpicSnapshot = typeof BeadsCoordinatorEpicSnapshot.Type;

export const BeadsIssueSortBy = Schema.Literals(["updated", "priority"]);
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

export const BeadsGetContextInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetContextInput = typeof BeadsGetContextInput.Type;

export const BeadsGetSwarmSupportInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsGetSwarmSupportInput = typeof BeadsGetSwarmSupportInput.Type;

export const BeadsEpicIssueInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  epicIssueId: BeadsIssueId,
});
export type BeadsEpicIssueInput = typeof BeadsEpicIssueInput.Type;

export const BeadsListSwarmsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeadsListSwarmsInput = typeof BeadsListSwarmsInput.Type;

export const BeadsProjectCoordinatorSnapshotInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  projectId: ProjectId,
});
export type BeadsProjectCoordinatorSnapshotInput = typeof BeadsProjectCoordinatorSnapshotInput.Type;

export const BeadsProjectCoordinatorSnapshot = Schema.Struct({
  projectId: ProjectId,
  support: BeadsSwarmSupport,
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
  support: BeadsSwarmSupport,
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

export const BeadsStartEpicPlanImplementationInput = Schema.Struct(BeadsEpicWorkflowStartInputBase);
export type BeadsStartEpicPlanImplementationInput =
  typeof BeadsStartEpicPlanImplementationInput.Type;

export const BeadsListSwarmsResult = Schema.Struct({
  swarms: Schema.Array(BeadsSwarmSummary).pipe(Schema.withDecodingDefault(() => [])),
});
export type BeadsListSwarmsResult = typeof BeadsListSwarmsResult.Type;

export class BeadsError extends Schema.TaggedErrorClass<BeadsError>()("BeadsError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
