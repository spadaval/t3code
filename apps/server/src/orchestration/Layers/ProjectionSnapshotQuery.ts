import {
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointCaptureRequest,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationProposedPlanFollowUpOutcome,
  OrchestrationPlanImplementationLaunchStatus,
  OrchestrationReadModel,
  OrchestrationEpicRunFailureContext,
  ProviderModelOptions,
  ProviderStartOptions,
  ProjectScript,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationPlanImplementationLaunch,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationEpicRun,
  type OrchestrationEpicIssueExecution,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  OrchestrationThreadIssueLink,
  ModelSelection,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionPlanImplementationLaunch } from "../../persistence/Services/ProjectionPlanImplementationLaunches.ts";
import { ProjectionPendingCheckpointCapture } from "../../persistence/Services/ProjectionPendingCheckpointCaptures.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionEpicRun } from "../../persistence/Services/ProjectionEpicRuns.ts";
import { ProjectionEpicIssueExecution } from "../../persistence/Services/ProjectionEpicIssueExecutions.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
  type ProjectionThreadCheckpointContext,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan.mapFields(
  Struct.assign({
    followUpOutcome: Schema.NullOr(Schema.fromJsonString(OrchestrationProposedPlanFollowUpOutcome)),
  }),
);
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    issueLink: Schema.NullOr(Schema.fromJsonString(OrchestrationThreadIssueLink)),
  }),
);
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionPlanImplementationLaunchDbRowSchema = ProjectionPlanImplementationLaunch.mapFields(
  Struct.assign({
    setupEnabled: Schema.Number,
    modelOptions: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    providerOptions: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionPendingCheckpointCaptureDbRowSchema = ProjectionPendingCheckpointCapture;
const ProjectionEpicRunDbRowSchema = Schema.Struct({
  runId: ProjectionEpicRun.fields.runId,
  projectId: ProjectionEpicRun.fields.projectId,
  epicIssueId: ProjectionEpicRun.fields.epicIssueId,
  status: ProjectionEpicRun.fields.status,
  provider: ProjectionEpicRun.fields.provider,
  model: ProjectionEpicRun.fields.model,
  modelOptions: Schema.NullOr(Schema.fromJsonString(ProviderModelOptions)),
  providerOptions: Schema.NullOr(Schema.fromJsonString(ProviderStartOptions)),
  assistantDeliveryMode: ProjectionEpicRun.fields.assistantDeliveryMode,
  runtimeMode: ProjectionEpicRun.fields.runtimeMode,
  failureContext: Schema.NullOr(Schema.fromJsonString(OrchestrationEpicRunFailureContext)),
  requestedAt: ProjectionEpicRun.fields.requestedAt,
  startedAt: ProjectionEpicRun.fields.startedAt,
  stopRequestedAt: ProjectionEpicRun.fields.stopRequestedAt,
  stoppedAt: ProjectionEpicRun.fields.stoppedAt,
  failedAt: ProjectionEpicRun.fields.failedAt,
  completedAt: ProjectionEpicRun.fields.completedAt,
  updatedAt: ProjectionEpicRun.fields.updatedAt,
});
const ProjectionEpicIssueExecutionDbRowSchema = ProjectionEpicIssueExecution.mapFields(
  Struct.assign({
    failureContext: Schema.NullOr(Schema.fromJsonString(OrchestrationEpicRunFailureContext)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;
const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.planImplementationLaunches,
  ORCHESTRATION_PROJECTOR_NAMES.epicRuns,
  ORCHESTRATION_PROJECTOR_NAMES.epicIssueExecutions,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
  ORCHESTRATION_PROJECTOR_NAMES.pendingCheckpointCaptures,
] as const;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          issue_link_json AS "issueLink",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          plan_intent AS "planIntent",
          follow_up_outcome_json AS "followUpOutcome",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listPlanImplementationLaunchRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPlanImplementationLaunchDbRowSchema,
    execute: () =>
      sql`
        SELECT
          launch_id AS "launchId",
          source_thread_id AS "sourceThreadId",
          source_plan_id AS "sourcePlanId",
          project_id AS "projectId",
          target_thread_id AS "targetThreadId",
          retry_of_launch_id AS "retryOfLaunchId",
          status,
          launch_mode AS "launchMode",
          branch,
          worktree_path AS "worktreePath",
          failure_reason AS "failureReason",
          cleanup_status AS "cleanupStatus",
          cleanup_error AS "cleanupError",
          title,
          setup_enabled AS "setupEnabled",
          prompt_text AS "promptText",
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          requested_at AS "requestedAt",
          prepared_at AS "preparedAt",
          started_at AS "startedAt",
          failed_at AS "failedAt",
          cancelled_at AS "cancelledAt",
          updated_at AS "updatedAt"
        FROM projection_plan_implementation_launches
        ORDER BY requested_at ASC, launch_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listPendingCheckpointCaptureRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPendingCheckpointCaptureDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          assistant_message_id AS "assistantMessageId",
          requested_at AS "requestedAt"
        FROM projection_pending_checkpoint_captures
        ORDER BY thread_id ASC, checkpoint_turn_count ASC, requested_at ASC, turn_id ASC
      `,
  });

  const listEpicRunRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionEpicRunDbRowSchema,
    execute: () =>
      sql`
        SELECT
          run_id AS "runId",
          project_id AS "projectId",
          epic_issue_id AS "epicIssueId",
          status,
          provider,
          model,
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions",
          assistant_delivery_mode AS "assistantDeliveryMode",
          runtime_mode AS "runtimeMode",
          failure_context_json AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          failed_at AS "failedAt",
          completed_at AS "completedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_runs
        ORDER BY requested_at ASC, run_id ASC
      `,
  });

  const listEpicIssueExecutionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionEpicIssueExecutionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          execution_id AS "executionId",
          run_id AS "runId",
          issue_id AS "issueId",
          worker_thread_id AS "workerThreadId",
          sequence_number AS "sequenceNumber",
          status,
          workspace_key AS "workspaceKey",
          workspace_path AS "workspacePath",
          CASE
            WHEN failure_kind IS NULL OR failure_message IS NULL THEN NULL
            ELSE json_object(
              'kind', failure_kind,
              'message', failure_message,
              'issueId', failure_issue_id,
              'executionId', failure_execution_id,
              'workerThreadId', failure_worker_thread_id
            )
          END AS "failureContext",
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          stop_requested_at AS "stopRequestedAt",
          stopped_at AS "stoppedAt",
          completed_at AS "completedAt",
          failed_at AS "failedAt",
          updated_at AS "updatedAt"
        FROM projection_epic_issue_executions
        ORDER BY run_id ASC, sequence_number ASC, execution_id ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `,
  });

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            launchRows,
            epicRunRows,
            epicIssueExecutionRows,
            checkpointRows,
            pendingCheckpointCaptureRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listPlanImplementationLaunchRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listPlanImplementationLaunches:query",
                  "ProjectionSnapshotQuery.getSnapshot:listPlanImplementationLaunches:decodeRows",
                ),
              ),
            ),
            listEpicRunRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listEpicRuns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listEpicRuns:decodeRows",
                ),
              ),
            ),
            listEpicIssueExecutionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listEpicIssueExecutions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listEpicIssueExecutions:decodeRows",
                ),
              ),
            ),
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            listPendingCheckpointCaptureRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listPendingCheckpointCaptures:query",
                  "ProjectionSnapshotQuery.getSnapshot:listPendingCheckpointCaptures:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const messagesByThread = new Map<string, Array<OrchestrationMessage>>();
          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const activitiesByThread = new Map<string, Array<OrchestrationThreadActivity>>();
          const checkpointsByThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
          const pendingCheckpointCapturesByThread = new Map<
            string,
            Array<OrchestrationCheckpointCaptureRequest>
          >();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of launchRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of epicRunRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of epicIssueExecutionRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          for (const row of messageRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null ? { attachments: row.attachments } : {}),
              turnId: row.turnId,
              streaming: row.isStreaming === 1,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            messagesByThread.set(row.threadId, threadMessages);
          }

          for (const row of proposedPlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadProposedPlans.push({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              planIntent: row.planIntent,
              followUpOutcome: row.followUpOutcome,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            proposedPlansByThread.set(row.threadId, threadProposedPlans);
          }

          for (const row of activityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push({
              id: row.activityId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              turnId: row.turnId,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            });
            activitiesByThread.set(row.threadId, threadActivities);
          }

          for (const row of checkpointRows) {
            updatedAt = maxIso(updatedAt, row.completedAt);
            const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
            threadCheckpoints.push({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              checkpointRef: row.checkpointRef,
              status: row.status,
              files: row.files,
              assistantMessageId: row.assistantMessageId,
              completedAt: row.completedAt,
            });
            checkpointsByThread.set(row.threadId, threadCheckpoints);
          }

          for (const row of pendingCheckpointCaptureRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            const threadPendingCaptures = pendingCheckpointCapturesByThread.get(row.threadId) ?? [];
            threadPendingCaptures.push({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              assistantMessageId: row.assistantMessageId,
              requestedAt: row.requestedAt,
            });
            pendingCheckpointCapturesByThread.set(row.threadId, threadPendingCaptures);
          }

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (latestTurnByThread.has(row.threadId)) {
              continue;
            }
            latestTurnByThread.set(row.threadId, {
              turnId: row.turnId,
              state:
                row.state === "error"
                  ? "error"
                  : row.state === "interrupted"
                    ? "interrupted"
                    : row.state === "completed"
                      ? "completed"
                      : "running",
              requestedAt: row.requestedAt,
              startedAt: row.startedAt,
              completedAt: row.completedAt,
              assistantMessageId: row.assistantMessageId,
              ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
                ? {
                    sourceProposedPlan: {
                      threadId: row.sourceProposedPlanThreadId,
                      planId: row.sourceProposedPlanId,
                    },
                  }
                : {}),
            });
          }

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            workspaceRoot: row.workspaceRoot,
            defaultModelSelection: row.defaultModelSelection,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => ({
            id: row.threadId,
            projectId: row.projectId,
            title: row.title,
            modelSelection: row.modelSelection,
            runtimeMode: row.runtimeMode,
            interactionMode: row.interactionMode,
            branch: row.branch,
            worktreePath: row.worktreePath,
            issueLink: row.issueLink,
            latestTurn: latestTurnByThread.get(row.threadId) ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            archivedAt: row.archivedAt,
            deletedAt: row.deletedAt,
            messages: messagesByThread.get(row.threadId) ?? [],
            proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
            activities: activitiesByThread.get(row.threadId) ?? [],
            checkpoints: checkpointsByThread.get(row.threadId) ?? [],
            pendingCheckpointCaptures: pendingCheckpointCapturesByThread.get(row.threadId) ?? [],
            session: sessionsByThread.get(row.threadId) ?? null,
          }));

          const planImplementationLaunches: Array<OrchestrationPlanImplementationLaunch> =
            launchRows.map((row) => ({
              launchId: row.launchId,
              sourceThreadId: row.sourceThreadId,
              sourcePlanId: row.sourcePlanId,
              projectId: row.projectId,
              targetThreadId: row.targetThreadId,
              retryOfLaunchId: row.retryOfLaunchId,
              status:
                row.status === "requested" ||
                row.status === "prepared" ||
                row.status === "started" ||
                row.status === "failed" ||
                row.status === "cancelled"
                  ? (row.status as OrchestrationPlanImplementationLaunchStatus)
                  : "failed",
              launchMode: row.launchMode,
              branch: row.branch,
              worktreePath: row.worktreePath,
              failureReason: row.failureReason,
              cleanupStatus: row.cleanupStatus,
              cleanupError: row.cleanupError,
              title: row.title,
              setupEnabled: row.setupEnabled === 1,
              requestedAt: row.requestedAt,
              preparedAt: row.preparedAt,
              startedAt: row.startedAt,
              failedAt: row.failedAt,
              cancelledAt: row.cancelledAt,
              updatedAt: row.updatedAt,
            }));

          const epicRuns: Array<OrchestrationEpicRun> = epicRunRows.map((row) => ({
            runId: row.runId,
            projectId: row.projectId,
            epicIssueId: row.epicIssueId,
            status: row.status,
            provider: row.provider,
            model: row.model,
            modelOptions: row.modelOptions,
            providerOptions: row.providerOptions,
            assistantDeliveryMode: row.assistantDeliveryMode,
            runtimeMode: row.runtimeMode,
            failureContext: row.failureContext,
            requestedAt: row.requestedAt,
            startedAt: row.startedAt,
            stopRequestedAt: row.stopRequestedAt,
            stoppedAt: row.stoppedAt,
            failedAt: row.failedAt,
            completedAt: row.completedAt,
            updatedAt: row.updatedAt,
          }));

          const epicIssueExecutions: Array<OrchestrationEpicIssueExecution> =
            epicIssueExecutionRows.map((row) => ({
              executionId: row.executionId,
              runId: row.runId,
              issueId: row.issueId,
              workerThreadId: row.workerThreadId,
              sequenceNumber: row.sequenceNumber,
              status: row.status,
              workspaceKey: row.workspaceKey,
              workspacePath: row.workspacePath,
              failureContext: row.failureContext,
              requestedAt: row.requestedAt,
              startedAt: row.startedAt,
              stopRequestedAt: row.stopRequestedAt,
              stoppedAt: row.stoppedAt,
              completedAt: row.completedAt,
              failedAt: row.failedAt,
              updatedAt: row.updatedAt,
            }));

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            planImplementationLaunches,
            epicRuns,
            epicIssueExecutions,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.map(
          Option.map(
            (row): OrchestrationProject => ({
              id: row.projectId,
              title: row.title,
              workspaceRoot: row.workspaceRoot,
              defaultModelSelection: row.defaultModelSelection,
              scripts: row.scripts,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }),
          ),
        ),
      );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstActiveThreadIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.threadId)),
      );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow",
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );

      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        workspaceRoot: threadRow.value.workspaceRoot,
        worktreePath: threadRow.value.worktreePath,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  return {
    getSnapshot,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
