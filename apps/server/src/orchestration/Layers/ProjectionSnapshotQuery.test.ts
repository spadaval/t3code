// @ts-nocheck
import {
  CheckpointRef,
  EventId,
  PlanImplementationLaunchId,
  MessageId,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  TurnId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { layerConfig } from "../../persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../config.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);
const asEventId = (value: string): EventId => EventId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);
const asLaunchId = (value: string): PlanImplementationLaunchId =>
  PlanImplementationLaunchId.makeUnsafe(value);
const asSwarmRunId = (value: string): EpicRunId => EpicRunId.makeUnsafe(value);
const asSwarmTaskExecutionId = (value: string): EpicIssueExecutionId =>
  EpicIssueExecutionId.makeUnsafe(value);

const projectionSnapshotLayer = it.layer(
  (() => {
    const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-projection-snapshot-query-test-",
    });
    const sqliteLayer = layerConfig.pipe(
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    return OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provideMerge(sqliteLayer),
      Layer.provideMerge(
        Layer.succeed(RepositoryIdentityResolver, {
          resolve: () => Effect.succeed(null),
        }),
      ),
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );
  })(),
);

projectionSnapshotLayer("ProjectionSnapshotQuery", (it) => {
  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_pending_checkpoint_captures`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-1',
          '2026-02-24T00:00:04.000Z',
          1,
          0,
          0,
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          'message-1',
          'thread-1',
          'turn-1',
          'assistant',
          'hello from projection',
          0,
          '2026-02-24T00:00:04.000Z',
          '2026-02-24T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id,
          thread_id,
          turn_id,
          plan_markdown,
          plan_intent,
          follow_up_outcome_json,
          created_at,
          updated_at
        )
        VALUES (
          'plan-1',
          'thread-1',
          'turn-1',
          '# Ship it',
          'code-implementation',
          '{"kind":"implement-code","completedAt":"2026-02-24T00:00:05.500Z","targetThreadId":"thread-2"}',
          '2026-02-24T00:00:05.000Z',
          '2026-02-24T00:00:05.500Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES (
          'activity-1',
          'thread-1',
          'turn-1',
          'info',
          'runtime.note',
          'provider started',
          '{"stage":"start"}',
          '2026-02-24T00:00:06.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_subagent_runs (
          run_id,
          thread_id,
          turn_id,
          parent_item_id,
          provider,
          provider_instance_id,
          provider_run_id,
          title,
          description,
          prompt,
          agent_type,
          model,
          reasoning_effort,
          config_json,
          status,
          started_at,
          completed_at,
          updated_at
        )
        VALUES (
          'subagent-run-1',
          'thread-1',
          'turn-1',
          'item-1',
          'codex',
          'codex',
          'provider-run-1',
          'Explorer',
          'Inspect files',
          'inspect',
          'explorer',
          'gpt-5-codex',
          NULL,
          '{"depth":1}',
          'running',
          '2026-02-24T00:00:06.250Z',
          NULL,
          '2026-02-24T00:00:06.500Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_subagent_entries (
          entry_id,
          run_id,
          kind,
          title,
          text,
          payload_json,
          created_at
        )
        VALUES (
          'subagent-entry-1',
          'subagent-run-1',
          'assistant',
          NULL,
          'done',
          '{"ok":true}',
          '2026-02-24T00:00:06.750Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          runtime_mode,
          active_turn_id,
          last_error,
          updated_at
        )
        VALUES (
          'thread-1',
          'running',
          'codex',
          'provider-session-1',
          'provider-thread-1',
          'approval-required',
          'turn-1',
          NULL,
          '2026-02-24T00:00:07.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_plan_implementation_launches (
          launch_id,
          source_thread_id,
          source_plan_id,
          project_id,
          target_thread_id,
          retry_of_launch_id,
          status,
          branch,
          worktree_path,
          failure_reason,
          cleanup_status,
          cleanup_error,
          title,
          setup_enabled,
          prompt_text,
          provider,
          model,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          requested_at,
          prepared_at,
          started_at,
          failed_at,
          cancelled_at,
          updated_at
        )
        VALUES (
          'launch-1',
          'thread-1',
          'plan-1',
          'project-1',
          'thread-2',
          NULL,
          'started',
          'feature/plan-1',
          '/tmp/project-1/.worktrees/plan-1',
          NULL,
          'not-required',
          NULL,
          'Implement Plan 1',
          1,
          'Ship it',
          'codex',
          'gpt-5.4',
          '[{"id":"reasoningEffort","value":"medium"}]',
          '{"codex":{"approvalPolicy":"never","sandboxMode":"danger-full-access"}}',
          'streaming',
          'full-access',
          '2026-02-24T00:00:08.250Z',
          '2026-02-24T00:00:08.750Z',
          '2026-02-24T00:00:09.250Z',
          NULL,
          NULL,
          '2026-02-24T00:00:09.250Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-1',
          'turn-1',
          NULL,
          'thread-1',
          'plan-1',
          'message-1',
          'completed',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          '2026-02-24T00:00:08.000Z',
          1,
          'checkpoint-1',
          'ready',
          '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]'
        )
      `;

      yield* sql`
        INSERT INTO projection_epic_runs (
          run_id,
          project_id,
          epic_issue_id,
          status,
          provider,
          model,
          model_options_json,
          provider_options_json,
          assistant_delivery_mode,
          runtime_mode,
          failure_context_json,
          requested_at,
          started_at,
          stop_requested_at,
          stopped_at,
          failed_at,
          completed_at,
          updated_at
        )
        VALUES (
          'run-1',
          'project-1',
          'EPIC-1',
          'running',
          'codex',
          'gpt-5.4',
          '[{"id":"reasoningEffort","value":"medium"}]',
          '{"codex":{"approvalPolicy":"never","sandboxMode":"danger-full-access"}}',
          'streaming',
          'full-access',
          NULL,
          '2026-02-24T00:00:08.500Z',
          '2026-02-24T00:00:09.000Z',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:10.500Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_epic_issue_executions (
          execution_id,
          run_id,
          issue_id,
          worker_thread_id,
          sequence_number,
          status,
          workspace_key,
          workspace_path,
          failure_kind,
          failure_message,
          failure_issue_id,
          failure_execution_id,
          failure_worker_thread_id,
          requested_at,
          started_at,
          stop_requested_at,
          stopped_at,
          completed_at,
          failed_at,
          updated_at
        )
        VALUES (
          'execution-1',
          'run-1',
          'TASK-1',
          'thread-1',
          1,
          'running',
          'shared',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:09.500Z',
          '2026-02-24T00:00:10.000Z',
          NULL,
          NULL,
          NULL,
          NULL,
          '2026-02-24T00:00:10.500Z'
        )
      `;

      let sequence = 5;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T00:00:09.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:10.500Z");
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.threads, [
        {
          id: ThreadId.makeUnsafe("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          issueLink: null,
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.makeUnsafe("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          deletedAt: null,
          messages: [
            {
              id: asMessageId("message-1"),
              role: "assistant",
              text: "hello from projection",
              turnId: asTurnId("turn-1"),
              streaming: false,
              createdAt: "2026-02-24T00:00:04.000Z",
              updatedAt: "2026-02-24T00:00:05.000Z",
            },
          ],
          proposedPlans: [
            {
              id: "plan-1",
              turnId: asTurnId("turn-1"),
              planMarkdown: "# Ship it",
              planIntent: "code-implementation",
              followUpOutcome: {
                kind: "implement-code",
                completedAt: "2026-02-24T00:00:05.500Z",
                targetThreadId: ThreadId.makeUnsafe("thread-2"),
              },
              createdAt: "2026-02-24T00:00:05.000Z",
              updatedAt: "2026-02-24T00:00:05.500Z",
            },
          ],
          subagentRuns: [
            {
              id: "subagent-run-1",
              threadId: ThreadId.makeUnsafe("thread-1"),
              turnId: asTurnId("turn-1"),
              parentItemId: "item-1",
              provider: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              providerRunId: "provider-run-1",
              title: "Explorer",
              description: "Inspect files",
              prompt: "inspect",
              agentType: "explorer",
              model: "gpt-5-codex",
              reasoningEffort: null,
              config: { depth: 1 },
              status: "running",
              startedAt: "2026-02-24T00:00:06.250Z",
              completedAt: null,
              updatedAt: "2026-02-24T00:00:06.500Z",
              entries: [
                {
                  id: "subagent-entry-1",
                  runId: "subagent-run-1",
                  kind: "assistant",
                  title: null,
                  text: "done",
                  payload: { ok: true },
                  createdAt: "2026-02-24T00:00:06.750Z",
                },
              ],
            },
          ],
          activities: [
            {
              id: asEventId("activity-1"),
              tone: "info",
              kind: "runtime.note",
              summary: "provider started",
              payload: { stage: "start" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.000Z",
            },
          ],
          pendingCheckpointCaptures: [],
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-1"),
              status: "ready",
              files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: asMessageId("message-1"),
              completedAt: "2026-02-24T00:00:08.000Z",
            },
          ],
          session: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
        },
      ]);
      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.snapshotSequence, 5);
      assert.equal(shellSnapshot.updatedAt, "2026-02-24T00:00:10.500Z");
      assert.deepEqual(shellSnapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
        },
      ]);
      assert.deepEqual(shellSnapshot.threads, [
        {
          id: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.make("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
          latestUserMessageAt: "2026-02-24T00:00:04.000Z",
          hasPendingApprovals: true,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
        },
      ]);
      assert.deepEqual(shellSnapshot.epicRuns, [
        {
          runId: asSwarmRunId("run-1"),
          projectId: asProjectId("project-1"),
          epicIssueId: "EPIC-1",
          status: "running",
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: [{ id: "reasoningEffort", value: "medium" }],
          providerOptions: {
            codex: {
              approvalPolicy: "never",
              sandboxMode: "danger-full-access",
            },
          },
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          failureContext: null,
          requestedAt: "2026-02-24T00:00:08.500Z",
          startedAt: "2026-02-24T00:00:09.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          failedAt: null,
          completedAt: null,
          updatedAt: "2026-02-24T00:00:10.500Z",
        },
      ]);
      assert.deepEqual(shellSnapshot.epicIssueExecutions, [
        {
          executionId: asSwarmTaskExecutionId("execution-1"),
          runId: asSwarmRunId("run-1"),
          issueId: "TASK-1",
          workerThreadId: ThreadId.makeUnsafe("thread-1"),
          sequenceNumber: 1,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-02-24T00:00:09.500Z",
          startedAt: "2026-02-24T00:00:10.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: "2026-02-24T00:00:10.500Z",
        },
      ]);

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value, snapshot.threads[0]);
      }
      assert.deepEqual(snapshot.epicRuns, [
        {
          runId: asSwarmRunId("run-1"),
          projectId: asProjectId("project-1"),
          epicIssueId: "EPIC-1",
          status: "running",
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: [{ id: "reasoningEffort", value: "medium" }],
          providerOptions: {
            codex: {
              approvalPolicy: "never",
              sandboxMode: "danger-full-access",
            },
          },
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          failureContext: null,
          requestedAt: "2026-02-24T00:00:08.500Z",
          startedAt: "2026-02-24T00:00:09.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          failedAt: null,
          completedAt: null,
          updatedAt: "2026-02-24T00:00:10.500Z",
        },
      ]);
      assert.deepEqual(snapshot.epicIssueExecutions, [
        {
          executionId: asSwarmTaskExecutionId("execution-1"),
          runId: asSwarmRunId("run-1"),
          issueId: "TASK-1",
          workerThreadId: ThreadId.makeUnsafe("thread-1"),
          sequenceNumber: 1,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: "2026-02-24T00:00:09.500Z",
          startedAt: "2026-02-24T00:00:10.000Z",
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: "2026-02-24T00:00:10.500Z",
        },
      ]);
      assert.deepEqual(snapshot.planImplementationLaunches, [
        {
          launchId: asLaunchId("launch-1"),
          sourceThreadId: ThreadId.makeUnsafe("thread-1"),
          sourcePlanId: "plan-1",
          projectId: asProjectId("project-1"),
          targetThreadId: ThreadId.makeUnsafe("thread-2"),
          retryOfLaunchId: null,
          status: "started",
          launchMode: "worktree",
          branch: "feature/plan-1",
          worktreePath: "/tmp/project-1/.worktrees/plan-1",
          failureReason: null,
          cleanupStatus: "not-required",
          cleanupError: null,
          title: "Implement Plan 1",
          setupEnabled: true,
          requestedAt: "2026-02-24T00:00:08.250Z",
          preparedAt: "2026-02-24T00:00:08.750Z",
          startedAt: "2026-02-24T00:00:09.250Z",
          failedAt: null,
          cancelledAt: null,
          updatedAt: "2026-02-24T00:00:09.250Z",
        },
      ]);
    }),
  );

  it.effect("ignores incomplete checkpoint rows when hydrating the snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_pending_checkpoint_captures`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-incomplete-checkpoint',
          'Project Incomplete Checkpoint',
          '/tmp/project-incomplete-checkpoint',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-02-24T00:00:00.000Z',
          '2026-02-24T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-incomplete-checkpoint',
          'project-incomplete-checkpoint',
          'Thread Incomplete Checkpoint',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          NULL,
          'turn-incomplete-checkpoint',
          '2026-02-24T00:00:01.000Z',
          '2026-02-24T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          'thread-incomplete-checkpoint',
          'turn-incomplete-checkpoint',
          NULL,
          NULL,
          NULL,
          'message-incomplete-checkpoint',
          'running',
          '2026-02-24T00:00:02.000Z',
          '2026-02-24T00:00:03.000Z',
          NULL,
          1,
          'checkpoint-incomplete',
          'ready',
          '[]'
        )
      `;

      yield* sql`
        INSERT INTO projection_pending_checkpoint_captures (
          thread_id,
          turn_id,
          checkpoint_turn_count,
          assistant_message_id,
          requested_at
        )
        VALUES (
          'thread-incomplete-checkpoint',
          'turn-incomplete-checkpoint',
          1,
          'message-incomplete-checkpoint',
          '2026-02-24T00:00:02.000Z'
        )
      `;

      let sequence = 1;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`
          INSERT INTO projection_state (
            projector,
            last_applied_sequence,
            updated_at
          )
          VALUES (
            ${projector},
            ${sequence},
            '2026-02-24T00:00:04.000Z'
          )
        `;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();
      assert.deepStrictEqual(snapshot.threads, [
        {
          id: ThreadId.makeUnsafe("thread-incomplete-checkpoint"),
          projectId: ProjectId.makeUnsafe("project-incomplete-checkpoint"),
          title: "Thread Incomplete Checkpoint",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          issueLink: null,
          createdAt: "2026-02-24T00:00:01.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          archivedAt: null,
          deletedAt: null,
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-incomplete-checkpoint"),
            state: "running",
            requestedAt: "2026-02-24T00:00:02.000Z",
            startedAt: "2026-02-24T00:00:03.000Z",
            completedAt: null,
            assistantMessageId: MessageId.makeUnsafe("message-incomplete-checkpoint"),
          },
          messages: [],
          proposedPlans: [],
          subagentRuns: [],
          activities: [],
          pendingCheckpointCaptures: [
            {
              turnId: TurnId.makeUnsafe("turn-incomplete-checkpoint"),
              checkpointTurnCount: 1,
              assistantMessageId: MessageId.makeUnsafe("message-incomplete-checkpoint"),
              requestedAt: "2026-02-24T00:00:02.000Z",
            },
          ],
          checkpoints: [],
          session: null,
        },
      ]);
    }),
  );

  it.effect(
    "reads targeted project, thread, and count queries without hydrating the full snapshot",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_pending_checkpoint_captures`;
        yield* sql`DELETE FROM projection_turns`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          (
            'project-active',
            'Active Project',
            '/tmp/workspace',
            '{"provider":"codex","model":"gpt-5-codex"}',
            '[]',
            '2026-03-01T00:00:00.000Z',
            '2026-03-01T00:00:01.000Z',
            NULL
          ),
          (
            'project-deleted',
            'Deleted Project',
            '/tmp/deleted',
            NULL,
            '[]',
            '2026-03-01T00:00:02.000Z',
            '2026-03-01T00:00:03.000Z',
            '2026-03-01T00:00:04.000Z'
          )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES
          (
            'thread-first',
            'project-active',
            'First Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:05.000Z',
            '2026-03-01T00:00:06.000Z',
            NULL,
            NULL
          ),
          (
            'thread-second',
            'project-active',
            'Second Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:07.000Z',
            '2026-03-01T00:00:08.000Z',
            NULL,
            NULL
          ),
          (
            'thread-deleted',
            'project-active',
            'Deleted Thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            'full-access',
            'default',
            NULL,
            NULL,
            NULL,
            '2026-03-01T00:00:09.000Z',
            '2026-03-01T00:00:10.000Z',
            NULL,
            '2026-03-01T00:00:11.000Z'
          )
      `;

        const counts = yield* snapshotQuery.getCounts();
        assert.deepEqual(counts, {
          projectCount: 2,
          threadCount: 3,
        });

        const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/workspace");
        assert.equal(project._tag, "Some");
        if (project._tag === "Some") {
          assert.equal(project.value.id, asProjectId("project-active"));
        }

        const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/missing");
        assert.equal(missingProject._tag, "None");

        const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          asProjectId("project-active"),
        );
        assert.equal(firstThreadId._tag, "Some");
        if (firstThreadId._tag === "Some") {
          assert.equal(firstThreadId.value, ThreadId.makeUnsafe("thread-first"));
        }
      }),
  );

  it.effect("reads single-thread checkpoint context without hydrating unrelated threads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_pending_checkpoint_captures`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-context',
          'Context Project',
          '/tmp/context-workspace',
          NULL,
          '[]',
          '2026-03-02T00:00:00.000Z',
          '2026-03-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-context',
          'project-context',
          'Context Thread',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          'feature/perf',
          '/tmp/context-worktree',
          NULL,
          '2026-03-02T00:00:02.000Z',
          '2026-03-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-context',
            'turn-1',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            '2026-03-02T00:00:04.000Z',
            1,
            'checkpoint-a',
            'ready',
            '[]'
          ),
          (
            'thread-context',
            'turn-2',
            NULL,
            NULL,
            NULL,
            NULL,
            'completed',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            '2026-03-02T00:00:05.000Z',
            2,
            'checkpoint-b',
            'ready',
            '[]'
          )
      `;

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.makeUnsafe("thread-context"),
      );
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          threadId: ThreadId.makeUnsafe("thread-context"),
          projectId: asProjectId("project-context"),
          workspaceRoot: "/tmp/context-workspace",
          worktreePath: "/tmp/context-worktree",
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-a"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:04.000Z",
            },
            {
              turnId: asTurnId("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: asCheckpointRef("checkpoint-b"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:05.000Z",
            },
          ],
        });
      }
    }),
  );

  it.effect("keeps thread detail activity ordering consistent with shell snapshot ordering", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-01T00:00:00.000Z',
          '2026-04-01T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-04-01T00:00:02.000Z',
          '2026-04-01T00:00:03.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES
          (
            'activity-unsequenced',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'unsequenced first',
            '{"source":"unsequenced"}',
            NULL,
            '2026-04-01T00:00:06.000Z'
          ),
          (
            'activity-sequence-2',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'sequence two',
            '{"source":"sequence-2"}',
            2,
            '2026-04-01T00:00:04.000Z'
          ),
          (
            'activity-sequence-1',
            'thread-1',
            NULL,
            'info',
            'runtime.note',
            'sequence one',
            '{"source":"sequence-1"}',
            1,
            '2026-04-01T00:00:05.000Z'
          )
      `;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));

      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value.activities, snapshot.threads[0]?.activities ?? []);
      }

      assert.deepEqual(snapshot.threads[0]?.activities ?? [], [
        {
          id: asEventId("activity-unsequenced"),
          tone: "info",
          kind: "runtime.note",
          summary: "unsequenced first",
          payload: { source: "unsequenced" },
          turnId: null,
          createdAt: "2026-04-01T00:00:06.000Z",
        },
        {
          id: asEventId("activity-sequence-1"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence one",
          payload: { source: "sequence-1" },
          turnId: null,
          sequence: 1,
          createdAt: "2026-04-01T00:00:05.000Z",
        },
        {
          id: asEventId("activity-sequence-2"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence two",
          payload: { source: "sequence-2" },
          turnId: null,
          sequence: 2,
          createdAt: "2026-04-01T00:00:04.000Z",
        },
      ]);
    }),
  );

  it.effect("uses projection_threads.latest_turn_id for targeted thread latest turn queries", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-04-02T00:00:00.000Z',
          '2026-04-02T00:00:01.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          'turn-running',
          '2026-04-02T00:00:04.000Z',
          0,
          0,
          0,
          '2026-04-02T00:00:02.000Z',
          '2026-04-02T00:00:03.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-1',
            'turn-completed',
            'message-user-1',
            NULL,
            NULL,
            'message-assistant-1',
            'completed',
            '2026-04-02T00:00:05.000Z',
            '2026-04-02T00:00:06.000Z',
            '2026-04-02T00:00:20.000Z',
            5,
            'checkpoint-5',
            'ready',
            '[]'
          ),
          (
            'thread-1',
            'turn-running',
            'message-user-2',
            NULL,
            NULL,
            NULL,
            'running',
            '2026-04-02T00:00:30.000Z',
            '2026-04-02T00:00:30.000Z',
            NULL,
            NULL,
            NULL,
            NULL,
            '[]'
          )
      `;

      const threadShell = yield* snapshotQuery.getThreadShellById(ThreadId.make("thread-1"));
      assert.equal(threadShell._tag, "Some");
      if (threadShell._tag === "Some") {
        assert.equal(threadShell.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadShell.value.latestTurn?.state, "running");
        assert.equal(threadShell.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.equal(threadDetail.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadDetail.value.latestTurn?.state, "running");
        assert.equal(threadDetail.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }
    }),
  );

  it.effect("hydrates thread detail subagent runs and nested entries in stable order", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_subagent_entries`;
      yield* sql`DELETE FROM projection_thread_subagent_runs`;
      yield* sql`DELETE FROM projection_threads`;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-subagent-order',
          'project-subagent-order',
          'Thread Subagent Order',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-05-14T12:00:00.000Z',
          '2026-05-14T12:00:00.000Z',
          NULL,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_thread_subagent_runs (
          run_id,
          thread_id,
          turn_id,
          parent_item_id,
          provider,
          provider_instance_id,
          provider_run_id,
          title,
          description,
          prompt,
          agent_type,
          model,
          reasoning_effort,
          config_json,
          status,
          started_at,
          completed_at,
          updated_at
        )
        VALUES
          (
            'run-b',
            'thread-subagent-order',
            'turn-2',
            'item-b',
            'codex',
            NULL,
            NULL,
            NULL,
            NULL,
            'inspect b',
            'explorer',
            'gpt-5-codex',
            NULL,
            '{}',
            'running',
            '2026-05-14T12:00:02.000Z',
            NULL,
            '2026-05-14T12:00:02.000Z'
          ),
          (
            'run-a',
            'thread-subagent-order',
            'turn-1',
            'item-a',
            'codex',
            NULL,
            NULL,
            NULL,
            NULL,
            'inspect a',
            'explorer',
            'gpt-5-codex',
            NULL,
            '{}',
            'completed',
            '2026-05-14T12:00:01.000Z',
            '2026-05-14T12:00:03.000Z',
            '2026-05-14T12:00:03.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_subagent_entries (
          entry_id,
          run_id,
          kind,
          title,
          text,
          payload_json,
          created_at
        )
        VALUES
          (
            'entry-b',
            'run-a',
            'assistant',
            NULL,
            'second',
            '{"order":2}',
            '2026-05-14T12:01:02.000Z'
          ),
          (
            'entry-a',
            'run-a',
            'assistant',
            NULL,
            'first',
            '{"order":1}',
            '2026-05-14T12:01:01.000Z'
          )
      `;

      const detail = yield* snapshotQuery.getThreadDetailById(
        ThreadId.make("thread-subagent-order"),
      );

      assert.equal(detail._tag, "Some");
      if (detail._tag === "Some") {
        assert.deepEqual(
          detail.value.subagentRuns.map((run) => run.id),
          ["run-a", "run-b"],
        );
        assert.deepEqual(
          detail.value.subagentRuns[0]?.entries.map((entry) => entry.id),
          ["entry-a", "entry-b"],
        );
      }
    }),
  );

  it.effect("caps hydrated thread detail subagent runs and nested entries", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_subagent_entries`;
      yield* sql`DELETE FROM projection_thread_subagent_runs`;
      yield* sql`DELETE FROM projection_threads`;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          'thread-subagent-cap',
          'project-subagent-cap',
          'Thread Subagent Cap',
          '{"provider":"codex","model":"gpt-5-codex"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-05-14T13:00:00.000Z',
          '2026-05-14T13:00:00.000Z',
          NULL,
          NULL
        )
      `;

      yield* Effect.forEach(
        Array.from({ length: 301 }, (_, index) => index),
        (index) => {
          const runId = `run-${String(index).padStart(3, "0")}`;
          const timestamp = `2026-05-14T13:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
          return sql`
            INSERT INTO projection_thread_subagent_runs (
              run_id,
              thread_id,
              turn_id,
              parent_item_id,
              provider,
              provider_instance_id,
              provider_run_id,
              title,
              description,
              prompt,
              agent_type,
              model,
              reasoning_effort,
              config_json,
              status,
              started_at,
              completed_at,
              updated_at
            )
            VALUES (
              ${runId},
              'thread-subagent-cap',
              'turn-subagent-cap',
              ${`item-${index}`},
              'codex',
              NULL,
              NULL,
              NULL,
              NULL,
              'inspect',
              'explorer',
              'gpt-5-codex',
              NULL,
              '{}',
              'running',
              ${timestamp},
              NULL,
              ${timestamp}
            )
          `;
        },
        { concurrency: 1 },
      );

      yield* Effect.forEach(
        Array.from({ length: 501 }, (_, index) => index),
        (index) => {
          const entryId = `entry-${String(index).padStart(3, "0")}`;
          const timestamp = `2026-05-14T14:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
          return sql`
            INSERT INTO projection_thread_subagent_entries (
              entry_id,
              run_id,
              kind,
              title,
              text,
              payload_json,
              created_at
            )
            VALUES (
              ${entryId},
              'run-300',
              'assistant',
              NULL,
              ${`entry ${index}`},
              '{}',
              ${timestamp}
            )
          `;
        },
        { concurrency: 1 },
      );

      const detail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-subagent-cap"));
      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(detail._tag, "Some");
      if (detail._tag === "Some") {
        assert.equal(detail.value.subagentRuns.length, 300);
        assert.deepEqual(
          detail.value.subagentRuns.slice(0, 2).map((run) => run.id),
          ["run-001", "run-002"],
        );
        assert.equal(detail.value.subagentRuns.at(-1)?.id, "run-300");
        assert.equal(detail.value.subagentRuns.at(-1)?.entries.length, 500);
        assert.deepEqual(
          detail.value.subagentRuns
            .at(-1)
            ?.entries.slice(0, 2)
            .map((entry) => entry.id),
          ["entry-001", "entry-002"],
        );
        assert.equal(detail.value.subagentRuns.at(-1)?.entries.at(-1)?.id, "entry-500");
      }

      const snapshotThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.make("thread-subagent-cap"),
      );
      assert.ok(snapshotThread);
      assert.equal(snapshotThread.subagentRuns.length, 300);
      assert.deepEqual(
        snapshotThread.subagentRuns.slice(0, 2).map((run) => run.id),
        ["run-001", "run-002"],
      );
      assert.equal(snapshotThread.subagentRuns.at(-1)?.id, "run-300");
      assert.equal(snapshotThread.subagentRuns.at(-1)?.entries.length, 500);
      assert.deepEqual(
        snapshotThread.subagentRuns
          .at(-1)
          ?.entries.slice(0, 2)
          .map((entry) => entry.id),
        ["entry-001", "entry-002"],
      );
      assert.equal(snapshotThread.subagentRuns.at(-1)?.entries.at(-1)?.id, "entry-500");
    }),
  );
});
