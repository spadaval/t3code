// @ts-nocheck
import {
  CheckpointRef,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ProviderInstanceId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive, layerConfig } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import {
  ORCHESTRATION_PROJECTOR_NAMES,
  OrchestrationProjectionPipelineLive,
} from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../../config.ts";

function makeTestPersistenceLayer(prefix: string) {
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), { prefix });
  const sqliteLayer = layerConfig.pipe(
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );

  return {
    serverConfigLayer,
    sqliteLayer,
  };
}

const makeProjectionPipelinePrefixedTestLayer = (prefix: string) => {
  const { serverConfigLayer, sqliteLayer } = makeTestPersistenceLayer(prefix);
  return OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(sqliteLayer),
    Layer.provideMerge(NodeServices.layer),
  );
};

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath));
    return fileInfo._tag === "Success";
  });

const BaseTestLayer = makeProjectionPipelinePrefixedTestLayer("t3-projection-pipeline-test-");

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("bootstraps all projection states and writes projection rows", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-1"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Thread 1",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-3"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          messageId: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.subagent-run-upserted",
        eventId: EventId.makeUnsafe("evt-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-4"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          run: {
            id: "subagent-run-1",
            threadId: ThreadId.makeUnsafe("thread-1"),
            turnId: TurnId.makeUnsafe("turn-1"),
            parentItemId: "item-1",
            provider: "codex",
            description: null,
            prompt: "inspect",
            agentType: "explorer",
            model: "gpt-5-codex",
            reasoningEffort: null,
            config: { depth: 1 },
            status: "running",
            startedAt: now,
            completedAt: null,
            updatedAt: now,
            entries: [],
          },
        },
      });

      yield* eventStore.append({
        type: "thread.subagent-entry-appended",
        eventId: EventId.makeUnsafe("evt-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-1"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-5"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          runId: "subagent-run-1",
          entry: {
            id: "subagent-entry-1",
            runId: "subagent-run-1",
            kind: "assistant",
            title: null,
            text: "done",
            payload: { ok: true },
            createdAt: now,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const projectRows = yield* sql<{
        readonly projectId: string;
        readonly title: string;
        readonly scriptsJson: string;
      }>`
        SELECT
          project_id AS "projectId",
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
      `;
      assert.deepEqual(projectRows, [
        { projectId: "project-1", title: "Project 1", scriptsJson: "[]" },
      ]);

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly text: string;
      }>`
        SELECT
          message_id AS "messageId",
          text
        FROM projection_thread_messages
      `;
      assert.deepEqual(messageRows, [{ messageId: "message-1", text: "hello" }]);

      const subagentRunRows = yield* sql<{
        readonly runId: string;
        readonly threadId: string;
        readonly turnId: string;
      }>`
        SELECT
          run_id AS "runId",
          thread_id AS "threadId",
          turn_id AS "turnId"
        FROM projection_thread_subagent_runs
      `;
      assert.deepEqual(subagentRunRows, [
        { runId: "subagent-run-1", threadId: "thread-1", turnId: "turn-1" },
      ]);

      const subagentEntryRows = yield* sql<{
        readonly entryId: string;
        readonly runId: string;
        readonly text: string;
      }>`
        SELECT
          entry_id AS "entryId",
          run_id AS "runId",
          text
        FROM projection_thread_subagent_entries
      `;
      assert.deepEqual(subagentEntryRows, [
        { entryId: "subagent-entry-1", runId: "subagent-run-1", text: "done" },
      ]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        ORDER BY projector ASC
      `;
      assert.equal(stateRows.length, Object.keys(ORCHESTRATION_PROJECTOR_NAMES).length);
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, 5);
      }
    }),
  );

  it.effect("projects swarm runs and task executions into dedicated projection tables", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const requestedAt = "2026-04-06T00:00:00.000Z";
      const startedAt = "2026-04-06T00:00:01.000Z";
      const failedAt = "2026-04-06T00:00:02.000Z";

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-swarm-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-swarm"),
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-swarm-project"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-swarm-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-swarm"),
          title: "Swarm Project",
          workspaceRoot: "/tmp/project-swarm",
          defaultModelSelection: null,
          scripts: [],
          createdAt: requestedAt,
          updatedAt: requestedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-run.requested",
        eventId: EventId.makeUnsafe("evt-swarm-run"),
        aggregateKind: "epicRun",
        aggregateId: "run-1" as never,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-swarm-run"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-swarm-run"),
        metadata: {},
        payload: {
          runId: "run-1" as never,
          projectId: ProjectId.makeUnsafe("project-swarm"),
          epicIssueId: "EPIC-1",
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: null,
          providerOptions: null,
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          requestedAt,
          updatedAt: requestedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-issue-execution.requested",
        eventId: EventId.makeUnsafe("evt-swarm-execution-requested"),
        aggregateKind: "epicIssueExecution",
        aggregateId: "execution-1" as never,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-swarm-execution-requested"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-swarm-execution-requested"),
        metadata: {},
        payload: {
          executionId: "execution-1" as never,
          runId: "run-1" as never,
          issueId: "TASK-1",
          workerThreadId: "thread-1" as never,
          sequenceNumber: 1,
          requestedAt,
          updatedAt: requestedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-issue-execution.started",
        eventId: EventId.makeUnsafe("evt-swarm-execution-started"),
        aggregateKind: "epicIssueExecution",
        aggregateId: "execution-1" as never,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-swarm-execution-started"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-swarm-execution-started"),
        metadata: {},
        payload: {
          executionId: "execution-1" as never,
          runId: "run-1" as never,
          startedAt,
          updatedAt: startedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-issue-execution.failed",
        eventId: EventId.makeUnsafe("evt-swarm-execution-failed"),
        aggregateKind: "epicIssueExecution",
        aggregateId: "execution-1" as never,
        occurredAt: failedAt,
        commandId: CommandId.makeUnsafe("cmd-swarm-execution-failed"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-swarm-execution-failed"),
        metadata: {},
        payload: {
          executionId: "execution-1" as never,
          runId: "run-1" as never,
          reason: "worker crashed",
          failedAt,
          updatedAt: failedAt,
        },
      });

      yield* projectionPipeline.bootstrap;

      const runRows = yield* sql<{
        readonly runId: string;
        readonly status: string;
      }>`
        SELECT
          run_id AS "runId",
          status
        FROM projection_epic_runs
      `;
      assert.deepEqual(runRows, [
        {
          runId: "run-1",
          status: "pending",
        },
      ]);

      const executionRows = yield* sql<{
        readonly executionId: string;
        readonly status: string;
        readonly requestedAt: string;
        readonly failureMessage: string | null;
      }>`
        SELECT
          execution_id AS "executionId",
          status,
          requested_at AS "requestedAt",
          failure_message AS "failureMessage"
        FROM projection_epic_issue_executions
      `;
      assert.deepEqual(executionRows, [
        {
          executionId: "execution-1",
          status: "failed",
          requestedAt,
          failureMessage: "worker crashed",
        },
      ]);
    }),
  );

  it.effect("cleans up subagent runs and entries after thread.reverted", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-subagent-revert");
      const now = "2026-05-14T15:00:00.000Z";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-subagent-revert-turn-keep"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-subagent-revert-turn-keep"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-subagent-revert-turn-keep"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-subagent-keep"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-subagent-revert/1"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-subagent-revert-turn-remove"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-subagent-revert-turn-remove"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-subagent-revert-turn-remove"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-subagent-remove"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-subagent-revert/2"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: now,
        },
      });

      for (const [runId, turnId] of [
        ["run-subagent-keep", "turn-subagent-keep"],
        ["run-subagent-remove", "turn-subagent-remove"],
      ] as const) {
        yield* appendAndProject({
          type: "thread.subagent-run-upserted",
          eventId: EventId.makeUnsafe(`evt-${runId}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.makeUnsafe(`cmd-${runId}`),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe(`cmd-${runId}`),
          metadata: {},
          payload: {
            threadId,
            run: {
              id: runId,
              threadId,
              turnId: TurnId.makeUnsafe(turnId),
              parentItemId: `item-${runId}`,
              provider: "codex",
              description: null,
              prompt: "inspect",
              agentType: "explorer",
              model: "gpt-5-codex",
              reasoningEffort: null,
              config: {},
              status: "completed",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              entries: [
                {
                  id: `entry-${runId}`,
                  runId,
                  kind: "assistant",
                  title: null,
                  text: runId,
                  payload: {},
                  createdAt: now,
                },
              ],
            },
          },
        });
      }

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.makeUnsafe("evt-subagent-revert"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-subagent-revert"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-subagent-revert"),
        metadata: {},
        payload: {
          threadId,
          turnCount: 1,
        },
      });

      const runRows = yield* sql<{ readonly runId: string }>`
        SELECT run_id AS "runId"
        FROM projection_thread_subagent_runs
        WHERE thread_id = 'thread-subagent-revert'
        ORDER BY run_id ASC
      `;
      assert.deepEqual(runRows, [{ runId: "run-subagent-keep" }]);

      const entryRows = yield* sql<{ readonly entryId: string; readonly runId: string }>`
        SELECT
          entry_id AS "entryId",
          run_id AS "runId"
        FROM projection_thread_subagent_entries
        WHERE run_id IN ('run-subagent-keep', 'run-subagent-remove')
        ORDER BY entry_id ASC
      `;
      assert.deepEqual(entryRows, [
        { entryId: "entry-run-subagent-keep", runId: "run-subagent-keep" },
      ]);
    }),
  );
});

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-base-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("stores message attachment references without mutating payloads", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-attachments"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-attachments"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-attachments"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-attachments"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-attachments"),
            messageId: MessageId.makeUnsafe("message-attachments"),
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-att-1",
                name: "example.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments'
          `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-safe-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("preserves mixed image attachment metadata as-is", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-attachments-safe"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-attachments-safe"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-attachments-safe"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-attachments-safe"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-attachments-safe"),
            messageId: MessageId.makeUnsafe("message-attachments-safe"),
            role: "user",
            text: "Inspect this",
            attachments: [
              {
                type: "image",
                id: "thread-attachments-safe-att-1",
                name: "untrusted.exe",
                mimeType: "image/x-unknown",
                sizeBytes: 5,
              },
              {
                type: "image",
                id: "thread-attachments-safe-att-2",
                name: "not-image.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
            SELECT
              attachments_json AS "attachmentsJson"
            FROM projection_thread_messages
            WHERE message_id = 'message-attachments-safe'
          `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
          {
            type: "image",
            id: "thread-attachments-safe-att-1",
            name: "untrusted.exe",
            mimeType: "image/x-unknown",
            sizeBytes: 5,
          },
          {
            type: "image",
            id: "thread-attachments-safe-att-2",
            name: "not-image.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ]);
      }),
    );
  },
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect(
    "passes explicit empty attachment arrays through the projection pipeline to clear attachments",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const now = new Date().toISOString();
        const later = new Date(Date.now() + 1_000).toISOString();

        yield* eventStore.append({
          type: "project.created",
          eventId: EventId.makeUnsafe("evt-clear-attachments-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe("project-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-clear-attachments-1"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-clear-attachments-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe("project-clear-attachments"),
            title: "Project Clear Attachments",
            workspaceRoot: "/tmp/project-clear-attachments",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.created",
          eventId: EventId.makeUnsafe("evt-clear-attachments-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-clear-attachments-2"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-clear-attachments-2"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-clear-attachments"),
            projectId: ProjectId.makeUnsafe("project-clear-attachments"),
            title: "Thread Clear Attachments",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-clear-attachments-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-clear-attachments"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-clear-attachments-3"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-clear-attachments-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-clear-attachments"),
            messageId: MessageId.makeUnsafe("message-clear-attachments"),
            role: "user",
            text: "Has attachments",
            attachments: [
              {
                type: "image",
                id: "thread-clear-attachments-att-1",
                name: "clear.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* eventStore.append({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-clear-attachments-4"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-clear-attachments"),
          occurredAt: later,
          commandId: CommandId.makeUnsafe("cmd-clear-attachments-4"),
          causationEventId: null,
          correlationId: CommandId.makeUnsafe("cmd-clear-attachments-4"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-clear-attachments"),
            messageId: MessageId.makeUnsafe("message-clear-attachments"),
            role: "user",
            text: "",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: later,
          },
        });

        yield* projectionPipeline.bootstrap;

        const rows = yield* sql<{
          readonly attachmentsJson: string | null;
        }>`
          SELECT
            attachments_json AS "attachmentsJson"
          FROM projection_thread_messages
          WHERE message_id = 'message-clear-attachments'
        `;
        assert.equal(rows.length, 1);
        assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), []);
      }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("overwrites stored attachment references when a message updates attachments", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();
      const later = new Date(Date.now() + 1_000).toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-overwrite-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-overwrite"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-overwrite-1"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-overwrite-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-overwrite"),
          title: "Project Overwrite",
          workspaceRoot: "/tmp/project-overwrite",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-overwrite-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-overwrite"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-overwrite-2"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-overwrite-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-overwrite"),
          projectId: ProjectId.makeUnsafe("project-overwrite"),
          title: "Thread Overwrite",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-overwrite-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-overwrite"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-overwrite-3"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-overwrite-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-overwrite"),
          messageId: MessageId.makeUnsafe("message-overwrite"),
          role: "user",
          text: "first image",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-1",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-overwrite-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-overwrite"),
        occurredAt: later,
        commandId: CommandId.makeUnsafe("cmd-overwrite-4"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-overwrite-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-overwrite"),
          messageId: MessageId.makeUnsafe("message-overwrite"),
          role: "user",
          text: "",
          attachments: [
            {
              type: "image",
              id: "thread-overwrite-att-2",
              name: "file.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: later,
        },
      });

      yield* projectionPipeline.bootstrap;

      const rows = yield* sql<{
        readonly attachmentsJson: string | null;
      }>`
              SELECT attachments_json AS "attachmentsJson"
              FROM projection_thread_messages
              WHERE message_id = 'message-overwrite'
            `;
      assert.equal(rows.length, 1);
      assert.deepEqual(JSON.parse(rows[0]?.attachmentsJson ?? "null"), [
        {
          type: "image",
          id: "thread-overwrite-att-2",
          name: "file.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ]);
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-rollback-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("does not persist attachment files when projector transaction rolls back", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-rollback-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-rollback"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-rollback-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-rollback-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-rollback"),
          title: "Project Rollback",
          workspaceRoot: "/tmp/project-rollback",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-rollback-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-rollback"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-rollback-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-rollback-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-rollback"),
          projectId: ProjectId.makeUnsafe("project-rollback"),
          title: "Thread Rollback",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* sql`
        CREATE TRIGGER fail_thread_messages_projection_state_update
        BEFORE UPDATE ON projection_state
        WHEN NEW.projector = 'projection.thread-messages'
        BEGIN
          SELECT RAISE(ABORT, 'forced-projection-state-failure');
        END;
      `;

      const result = yield* Effect.result(
        appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-rollback-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-rollback"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-rollback-3"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-rollback-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-rollback"),
            messageId: MessageId.makeUnsafe("message-rollback"),
            role: "user",
            text: "Rollback me",
            attachments: [
              {
                type: "image",
                id: "thread-rollback-att-1",
                name: "rollback.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      assert.equal(result._tag, "Failure");

      const rows = yield* sql<{
        readonly count: number;
      }>`
        SELECT COUNT(*) AS "count"
        FROM projection_thread_messages
        WHERE message_id = 'message-rollback'
      `;
      assert.equal(rows[0]?.count ?? 0, 0);

      const { attachmentsDir } = yield* ServerConfig;
      const attachmentPath = path.join(attachmentsDir, "thread-rollback-att-1.png");
      assert.isFalse(yield* exists(attachmentPath));
      yield* sql`DROP TRIGGER IF EXISTS fail_thread_messages_projection_state_update`;
    }),
  );
});

it.layer(
  Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-overwrite-")),
)("OrchestrationProjectionPipeline", (it) => {
  it.effect("removes unreferenced attachment files when a thread is reverted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const { attachmentsDir } = yield* ServerConfig;
      const now = new Date().toISOString();
      const threadId = ThreadId.makeUnsafe("Thread Revert.Files");
      const keepAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000001";
      const removeAttachmentId = "thread-revert-files-00000000-0000-4000-8000-000000000002";
      const otherThreadAttachmentId =
        "thread-revert-files-extra-00000000-0000-4000-8000-000000000003";

      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-revert-files-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-revert-files"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-revert-files"),
          title: "Project Revert Files",
          workspaceRoot: "/tmp/project-revert-files",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-revert-files-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-2"),
        metadata: {},
        payload: {
          threadId,
          projectId: ProjectId.makeUnsafe("project-revert-files"),
          title: "Thread Revert Files",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-files-3"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-3"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-keep"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-revert-files/turn/1"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("message-keep"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-files-4"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-4"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-keep"),
          role: "assistant",
          text: "Keep",
          attachments: [
            {
              type: "image",
              id: keepAttachmentId,
              name: "keep.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.makeUnsafe("turn-keep"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-files-5"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-5"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-5"),
        metadata: {},
        payload: {
          threadId,
          turnId: TurnId.makeUnsafe("turn-remove"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-revert-files/turn/2"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("message-remove"),
          completedAt: now,
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-files-6"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-6"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-6"),
        metadata: {},
        payload: {
          threadId,
          messageId: MessageId.makeUnsafe("message-remove"),
          role: "assistant",
          text: "Remove",
          attachments: [
            {
              type: "image",
              id: removeAttachmentId,
              name: "remove.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
          turnId: TurnId.makeUnsafe("turn-remove"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      const keepPath = path.join(attachmentsDir, `${keepAttachmentId}.png`);
      const removePath = path.join(attachmentsDir, `${removeAttachmentId}.png`);
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(keepPath, "keep");
      yield* fileSystem.writeFileString(removePath, "remove");
      const otherThreadPath = path.join(attachmentsDir, `${otherThreadAttachmentId}.png`);
      yield* fileSystem.writeFileString(otherThreadPath, "other");
      assert.isTrue(yield* exists(keepPath));
      assert.isTrue(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.makeUnsafe("evt-revert-files-7"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-revert-files-7"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-files-7"),
        metadata: {},
        payload: {
          threadId,
          turnCount: 1,
        },
      });

      assert.isTrue(yield* exists(keepPath));
      assert.isFalse(yield* exists(removePath));
      assert.isTrue(yield* exists(otherThreadPath));
    }),
  );
});

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-revert-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("removes thread attachment directory when thread is deleted", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const { attachmentsDir } = yield* ServerConfig;
        const now = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe("Thread Delete.Files");
        const attachmentId = "thread-delete-files-00000000-0000-4000-8000-000000000001";
        const otherThreadAttachmentId =
          "thread-delete-files-extra-00000000-0000-4000-8000-000000000002";

        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: EventId.makeUnsafe("evt-delete-files-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe("project-delete-files"),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-delete-files-1"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-delete-files-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe("project-delete-files"),
            title: "Project Delete Files",
            workspaceRoot: "/tmp/project-delete-files",
            defaultModelSelection: null,
            scripts: [],
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: EventId.makeUnsafe("evt-delete-files-2"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-delete-files-2"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-delete-files-2"),
          metadata: {},
          payload: {
            threadId,
            projectId: ProjectId.makeUnsafe("project-delete-files"),
            title: "Thread Delete Files",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        });

        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-delete-files-3"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-delete-files-3"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-delete-files-3"),
          metadata: {},
          payload: {
            threadId,
            messageId: MessageId.makeUnsafe("message-delete-files"),
            role: "user",
            text: "Delete",
            attachments: [
              {
                type: "image",
                id: attachmentId,
                name: "delete.png",
                mimeType: "image/png",
                sizeBytes: 5,
              },
            ],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        });

        const threadAttachmentPath = path.join(attachmentsDir, `${attachmentId}.png`);
        const otherThreadAttachmentPath = path.join(
          attachmentsDir,
          `${otherThreadAttachmentId}.png`,
        );
        yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
        yield* fileSystem.writeFileString(threadAttachmentPath, "delete");
        yield* fileSystem.writeFileString(otherThreadAttachmentPath, "other-thread");
        assert.isTrue(yield* exists(threadAttachmentPath));
        assert.isTrue(yield* exists(otherThreadAttachmentPath));

        yield* appendAndProject({
          type: "thread.deleted",
          eventId: EventId.makeUnsafe("evt-delete-files-4"),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-delete-files-4"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-delete-files-4"),
          metadata: {},
          payload: {
            threadId,
            deletedAt: now,
          },
        });

        assert.isFalse(yield* exists(threadAttachmentPath));
        assert.isTrue(yield* exists(otherThreadAttachmentPath));
      }),
    );
  },
);

it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-attachments-delete-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("ignores unsafe thread ids for attachment cleanup paths", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const now = new Date().toISOString();
        const { attachmentsDir: attachmentsRootDir, stateDir } = yield* ServerConfig;
        const attachmentsSentinelPath = path.join(attachmentsRootDir, "sentinel.txt");
        const stateDirSentinelPath = path.join(stateDir, "state-sentinel.txt");
        yield* fileSystem.makeDirectory(attachmentsRootDir, { recursive: true });
        yield* fileSystem.writeFileString(attachmentsSentinelPath, "keep-attachments-root");
        yield* fileSystem.writeFileString(stateDirSentinelPath, "keep-state-dir");

        yield* eventStore.append({
          type: "thread.deleted",
          eventId: EventId.makeUnsafe("evt-unsafe-thread-delete"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe(".."),
          occurredAt: now,
          commandId: CommandId.makeUnsafe("cmd-unsafe-thread-delete"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-unsafe-thread-delete"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe(".."),
            deletedAt: now,
          },
        });

        yield* projectionPipeline.bootstrap;

        assert.isTrue(yield* exists(attachmentsRootDir));
        assert.isTrue(yield* exists(attachmentsSentinelPath));
        assert.isTrue(yield* exists(stateDirSentinelPath));
      }),
    );
  },
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline", (it) => {
  it.effect("resumes from projector last_applied_sequence without replaying older events", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-a1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-a"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-a1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-a1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "Project A",
          workspaceRoot: "/tmp/project-a",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-a2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-a"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-a2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-a2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-a"),
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "Thread A",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-a3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-a"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-a3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-a3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-a"),
          messageId: MessageId.makeUnsafe("message-a"),
          role: "assistant",
          text: "hello",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-a4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-a"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-a4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-a4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-a"),
          messageId: MessageId.makeUnsafe("message-a"),
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;
      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{ readonly text: string }>`
        SELECT text FROM projection_thread_messages WHERE message_id = 'message-a'
      `;
      assert.deepEqual(messageRows, [{ text: "hello world" }]);

      const stateRows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
      `;
      const maxSequenceRows = yield* sql<{ readonly maxSequence: number }>`
        SELECT MAX(sequence) AS "maxSequence" FROM orchestration_events
      `;
      const maxSequence = maxSequenceRows[0]?.maxSequence ?? 0;
      for (const row of stateRows) {
        assert.equal(row.lastAppliedSequence, maxSequence);
      }
    }),
  );

  it.effect("keeps accumulated assistant text when completion payload text is empty", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-empty-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-empty"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-empty-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-empty-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-empty"),
          title: "Project Empty",
          workspaceRoot: "/tmp/project-empty",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-empty-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-empty"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-empty-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-empty-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-empty"),
          projectId: ProjectId.makeUnsafe("project-empty"),
          title: "Thread Empty",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-empty-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-empty"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-empty-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-empty-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-empty"),
          messageId: MessageId.makeUnsafe("assistant-empty"),
          role: "assistant",
          text: "Hello",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-empty-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-empty"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-empty-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-empty-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-empty"),
          messageId: MessageId.makeUnsafe("assistant-empty"),
          role: "assistant",
          text: " world",
          turnId: null,
          streaming: true,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* eventStore.append({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-empty-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-empty"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-empty-5"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-empty-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-empty"),
          messageId: MessageId.makeUnsafe("assistant-empty"),
          role: "assistant",
          text: "",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      });

      yield* projectionPipeline.bootstrap;

      const messageRows = yield* sql<{ readonly text: string; readonly isStreaming: unknown }>`
        SELECT
          text,
          is_streaming AS "isStreaming"
        FROM projection_thread_messages
        WHERE message_id = 'assistant-empty'
      `;
      assert.equal(messageRows.length, 1);
      assert.equal(messageRows[0]?.text, "Hello world");
      assert.isFalse(Boolean(messageRows[0]?.isStreaming));
    }),
  );

  it.effect(
    "resolves turn-count conflicts when checkpoint completion updates checkpoint metadata without rewriting turn state",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: EventId.makeUnsafe("evt-conflict-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe("project-conflict"),
          occurredAt: "2026-02-26T13:00:00.000Z",
          commandId: CommandId.makeUnsafe("cmd-conflict-1"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-conflict-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe("project-conflict"),
            title: "Project Conflict",
            workspaceRoot: "/tmp/project-conflict",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-02-26T13:00:00.000Z",
            updatedAt: "2026-02-26T13:00:00.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: EventId.makeUnsafe("evt-conflict-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-conflict"),
          occurredAt: "2026-02-26T13:00:01.000Z",
          commandId: CommandId.makeUnsafe("cmd-conflict-2"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-conflict-2"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-conflict"),
            projectId: ProjectId.makeUnsafe("project-conflict"),
            title: "Thread Conflict",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: "2026-02-26T13:00:01.000Z",
            updatedAt: "2026-02-26T13:00:01.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-interrupt-requested",
          eventId: EventId.makeUnsafe("evt-conflict-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-conflict"),
          occurredAt: "2026-02-26T13:00:02.000Z",
          commandId: CommandId.makeUnsafe("cmd-conflict-3"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-conflict-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-conflict"),
            turnId: TurnId.makeUnsafe("turn-interrupted"),
            createdAt: "2026-02-26T13:00:02.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.message-sent",
          eventId: EventId.makeUnsafe("evt-conflict-4"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-conflict"),
          occurredAt: "2026-02-26T13:00:03.000Z",
          commandId: CommandId.makeUnsafe("cmd-conflict-4"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-conflict-4"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-conflict"),
            messageId: MessageId.makeUnsafe("assistant-conflict"),
            role: "assistant",
            text: "done",
            turnId: TurnId.makeUnsafe("turn-completed"),
            streaming: false,
            createdAt: "2026-02-26T13:00:03.000Z",
            updatedAt: "2026-02-26T13:00:03.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-diff-completed",
          eventId: EventId.makeUnsafe("evt-conflict-5"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-conflict"),
          occurredAt: "2026-02-26T13:00:04.000Z",
          commandId: CommandId.makeUnsafe("cmd-conflict-5"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-conflict-5"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-conflict"),
            turnId: TurnId.makeUnsafe("turn-completed"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-conflict/turn/1"),
            status: "ready",
            files: [],
            assistantMessageId: MessageId.makeUnsafe("assistant-conflict"),
            completedAt: "2026-02-26T13:00:04.000Z",
          },
        });

        const turnRows = yield* sql<{
          readonly turnId: string;
          readonly checkpointTurnCount: number | null;
          readonly status: string;
        }>`
        SELECT
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          state AS "status"
        FROM projection_turns
        WHERE thread_id = 'thread-conflict'
        ORDER BY
          CASE
            WHEN checkpoint_turn_count IS NULL THEN 1
            ELSE 0
          END ASC,
          checkpoint_turn_count ASC,
          requested_at ASC
      `;
        assert.deepEqual(turnRows, [
          { turnId: "turn-completed", checkpointTurnCount: 1, status: "running" },
          { turnId: "turn-interrupted", checkpointTurnCount: null, status: "interrupted" },
        ]);
      }),
  );

  it.effect("creates and clears pending checkpoint capture rows without rewriting turn state", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-pending-checkpoint-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-pending-checkpoint"),
        occurredAt: "2026-03-01T10:00:00.000Z",
        commandId: CommandId.makeUnsafe("cmd-pending-checkpoint-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-pending-checkpoint-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-pending-checkpoint"),
          title: "Pending Checkpoint Project",
          workspaceRoot: "/repo/pending-checkpoint",
          defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
          scripts: [],
          createdAt: "2026-03-01T10:00:00.000Z",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-pending-checkpoint-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
        occurredAt: "2026-03-01T10:00:01.000Z",
        commandId: CommandId.makeUnsafe("cmd-pending-checkpoint-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-pending-checkpoint-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
          projectId: ProjectId.makeUnsafe("project-pending-checkpoint"),
          title: "Thread Pending Checkpoint",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: "2026-03-01T10:00:01.000Z",
          updatedAt: "2026-03-01T10:00:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-pending-checkpoint-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
        occurredAt: "2026-03-01T10:00:02.000Z",
        commandId: CommandId.makeUnsafe("cmd-pending-checkpoint-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-pending-checkpoint-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
          session: {
            threadId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.makeUnsafe("turn-pending"),
            lastError: null,
            updatedAt: "2026-03-01T10:00:02.000Z",
          },
        },
      });

      yield* appendAndProject({
        type: "thread.checkpoint-capture-requested",
        eventId: EventId.makeUnsafe("evt-pending-checkpoint-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
        occurredAt: "2026-03-01T10:00:03.000Z",
        commandId: CommandId.makeUnsafe("cmd-pending-checkpoint-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-pending-checkpoint-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
          request: {
            turnId: TurnId.makeUnsafe("turn-pending"),
            checkpointTurnCount: 1,
            assistantMessageId: MessageId.makeUnsafe("assistant-pending"),
            requestedAt: "2026-03-01T10:00:03.000Z",
          },
        },
      });

      const pendingRows = yield* sql<{
        readonly turnId: string;
        readonly checkpointTurnCount: number;
      }>`
        SELECT
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount"
        FROM projection_pending_checkpoint_captures
        WHERE thread_id = 'thread-pending-checkpoint'
        ORDER BY requested_at ASC
      `;
      assert.deepEqual(pendingRows, [{ turnId: "turn-pending", checkpointTurnCount: 1 }]);

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-pending-checkpoint-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
        occurredAt: "2026-03-01T10:00:04.000Z",
        commandId: CommandId.makeUnsafe("cmd-pending-checkpoint-5"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-pending-checkpoint-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-pending-checkpoint"),
          turnId: TurnId.makeUnsafe("turn-pending"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-pending/turn/1"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("assistant-pending"),
          completedAt: "2026-03-01T10:00:04.000Z",
        },
      });

      const clearedPendingRows = yield* sql`
        SELECT COUNT(*) AS count
        FROM projection_pending_checkpoint_captures
        WHERE thread_id = 'thread-pending-checkpoint'
      `;
      assert.deepEqual(clearedPendingRows, [{ count: 0 }]);

      const turnRows = yield* sql<{
        readonly state: string;
        readonly checkpointTurnCount: number | null;
      }>`
        SELECT
          state,
          checkpoint_turn_count AS "checkpointTurnCount"
        FROM projection_turns
        WHERE thread_id = 'thread-pending-checkpoint'
          AND turn_id = 'turn-pending'
      `;
      assert.deepEqual(turnRows, [{ state: "running", checkpointTurnCount: 1 }]);
    }),
  );

  it.effect(
    "treats legacy missing checkpoint events as pending capture replay without interrupting turns",
    () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
          eventStore
            .append(event)
            .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

        yield* appendAndProject({
          type: "project.created",
          eventId: EventId.makeUnsafe("evt-legacy-missing-1"),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe("project-legacy-missing"),
          occurredAt: "2026-03-01T11:00:00.000Z",
          commandId: CommandId.makeUnsafe("cmd-legacy-missing-1"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-legacy-missing-1"),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe("project-legacy-missing"),
            title: "Legacy Missing Project",
            workspaceRoot: "/repo/legacy-missing",
            defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
            scripts: [],
            createdAt: "2026-03-01T11:00:00.000Z",
            updatedAt: "2026-03-01T11:00:00.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.created",
          eventId: EventId.makeUnsafe("evt-legacy-missing-2"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-legacy-missing"),
          occurredAt: "2026-03-01T11:00:01.000Z",
          commandId: CommandId.makeUnsafe("cmd-legacy-missing-2"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-legacy-missing-2"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-legacy-missing"),
            projectId: ProjectId.makeUnsafe("project-legacy-missing"),
            title: "Thread Legacy Missing",
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: "2026-03-01T11:00:01.000Z",
            updatedAt: "2026-03-01T11:00:01.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-interrupt-requested",
          eventId: EventId.makeUnsafe("evt-legacy-missing-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-legacy-missing"),
          occurredAt: "2026-03-01T11:00:02.000Z",
          commandId: CommandId.makeUnsafe("cmd-legacy-missing-3"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-legacy-missing-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-legacy-missing"),
            turnId: TurnId.makeUnsafe("turn-legacy"),
            createdAt: "2026-03-01T11:00:02.000Z",
          },
        });

        yield* appendAndProject({
          type: "thread.turn-diff-completed",
          eventId: EventId.makeUnsafe("evt-legacy-missing-4"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-legacy-missing"),
          occurredAt: "2026-03-01T11:00:03.000Z",
          commandId: CommandId.makeUnsafe("cmd-legacy-missing-4"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-legacy-missing-4"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-legacy-missing"),
            turnId: TurnId.makeUnsafe("turn-legacy"),
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-legacy/turn/1"),
            status: "missing",
            files: [],
            assistantMessageId: MessageId.makeUnsafe("assistant-legacy"),
            completedAt: "2026-03-01T11:00:03.000Z",
          },
        });

        const pendingRows = yield* sql<{
          readonly turnId: string;
          readonly checkpointTurnCount: number;
        }>`
        SELECT
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount"
        FROM projection_pending_checkpoint_captures
        WHERE thread_id = 'thread-legacy-missing'
      `;
        assert.deepEqual(pendingRows, [{ turnId: "turn-legacy", checkpointTurnCount: 1 }]);

        const turnRows = yield* sql<{
          readonly state: string;
          readonly checkpointTurnCount: number | null;
        }>`
        SELECT
          state,
          checkpoint_turn_count AS "checkpointTurnCount"
        FROM projection_turns
        WHERE thread_id = 'thread-legacy-missing'
          AND turn_id = 'turn-legacy'
      `;
        assert.deepEqual(turnRows, [{ state: "interrupted", checkpointTurnCount: null }]);
      }),
  );

  it.effect("does not fallback-retain messages whose turnId is removed by revert", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const appendAndProject = (event: Parameters<typeof eventStore.append>[0]) =>
        eventStore
          .append(event)
          .pipe(Effect.flatMap((savedEvent) => projectionPipeline.projectEvent(savedEvent)));

      yield* appendAndProject({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-revert-1"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-revert"),
        occurredAt: "2026-02-26T12:00:00.000Z",
        commandId: CommandId.makeUnsafe("cmd-revert-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-1"),
        metadata: {},
        payload: {
          projectId: ProjectId.makeUnsafe("project-revert"),
          title: "Project Revert",
          workspaceRoot: "/tmp/project-revert",
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-02-26T12:00:00.000Z",
          updatedAt: "2026-02-26T12:00:00.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.created",
        eventId: EventId.makeUnsafe("evt-revert-2"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:01.000Z",
        commandId: CommandId.makeUnsafe("cmd-revert-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-2"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          projectId: ProjectId.makeUnsafe("project-revert"),
          title: "Thread Revert",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: "2026-02-26T12:00:01.000Z",
          updatedAt: "2026-02-26T12:00:01.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-3"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:02.000Z",
        commandId: CommandId.makeUnsafe("cmd-revert-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-3"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          turnId: TurnId.makeUnsafe("turn-1"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-revert/turn/1"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("assistant-keep"),
          completedAt: "2026-02-26T12:00:02.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-4"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:02.100Z",
        commandId: CommandId.makeUnsafe("cmd-revert-4"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-4"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          messageId: MessageId.makeUnsafe("assistant-keep"),
          role: "assistant",
          text: "kept",
          turnId: TurnId.makeUnsafe("turn-1"),
          streaming: false,
          createdAt: "2026-02-26T12:00:02.100Z",
          updatedAt: "2026-02-26T12:00:02.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.turn-diff-completed",
        eventId: EventId.makeUnsafe("evt-revert-5"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.000Z",
        commandId: CommandId.makeUnsafe("cmd-revert-5"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-5"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          turnId: TurnId.makeUnsafe("turn-2"),
          checkpointTurnCount: 2,
          checkpointRef: CheckpointRef.makeUnsafe("refs/t3/checkpoints/thread-revert/turn/2"),
          status: "ready",
          files: [],
          assistantMessageId: MessageId.makeUnsafe("assistant-remove"),
          completedAt: "2026-02-26T12:00:03.000Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-6"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.050Z",
        commandId: CommandId.makeUnsafe("cmd-revert-6"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-6"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          messageId: MessageId.makeUnsafe("user-remove"),
          role: "user",
          text: "removed",
          turnId: TurnId.makeUnsafe("turn-2"),
          streaming: false,
          createdAt: "2026-02-26T12:00:03.050Z",
          updatedAt: "2026-02-26T12:00:03.050Z",
        },
      });

      yield* appendAndProject({
        type: "thread.message-sent",
        eventId: EventId.makeUnsafe("evt-revert-7"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:03.100Z",
        commandId: CommandId.makeUnsafe("cmd-revert-7"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-7"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          messageId: MessageId.makeUnsafe("assistant-remove"),
          role: "assistant",
          text: "removed",
          turnId: TurnId.makeUnsafe("turn-2"),
          streaming: false,
          createdAt: "2026-02-26T12:00:03.100Z",
          updatedAt: "2026-02-26T12:00:03.100Z",
        },
      });

      yield* appendAndProject({
        type: "thread.reverted",
        eventId: EventId.makeUnsafe("evt-revert-8"),
        aggregateKind: "thread",
        aggregateId: ThreadId.makeUnsafe("thread-revert"),
        occurredAt: "2026-02-26T12:00:04.000Z",
        commandId: CommandId.makeUnsafe("cmd-revert-8"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-revert-8"),
        metadata: {},
        payload: {
          threadId: ThreadId.makeUnsafe("thread-revert"),
          turnCount: 1,
        },
      });

      const messageRows = yield* sql<{
        readonly messageId: string;
        readonly turnId: string | null;
        readonly role: string;
      }>`
        SELECT
          message_id AS "messageId",
          turn_id AS "turnId",
          role
        FROM projection_thread_messages
        WHERE thread_id = 'thread-revert'
        ORDER BY created_at ASC, message_id ASC
      `;
      assert.deepEqual(messageRows, [
        {
          messageId: "assistant-keep",
          turnId: "turn-1",
          role: "assistant",
        },
      ]);
    }),
  );
});

it.effect("restores pending turn-start metadata across projection pipeline restart", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );

    const threadId = ThreadId.makeUnsafe("thread-restart");
    const turnId = TurnId.makeUnsafe("turn-restart");
    const messageId = MessageId.makeUnsafe("message-restart");
    const sourcePlanThreadId = ThreadId.makeUnsafe("thread-plan-source");
    const sourcePlanId = "plan-source";
    const turnStartedAt = "2026-02-26T14:00:00.000Z";
    const sessionSetAt = "2026-02-26T14:00:05.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "thread.turn-start-requested",
        eventId: EventId.makeUnsafe("evt-restart-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: turnStartedAt,
        commandId: CommandId.makeUnsafe("cmd-restart-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-restart-1"),
        metadata: {},
        payload: {
          threadId,
          messageId,
          sourceProposedPlan: {
            threadId: sourcePlanThreadId,
            planId: sourcePlanId,
          },
          runtimeMode: "approval-required",
          createdAt: turnStartedAt,
        },
      });

      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(firstProjectionLayer));

    const turnRows = yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* eventStore.append({
        type: "thread.session-set",
        eventId: EventId.makeUnsafe("evt-restart-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: sessionSetAt,
        commandId: CommandId.makeUnsafe("cmd-restart-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-restart-2"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: sessionSetAt,
          },
        },
      });

      yield* projectionPipeline.bootstrap;

      const pendingRows = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
      `;
      assert.deepEqual(pendingRows, []);

      return yield* sql<{
        readonly turnId: string;
        readonly userMessageId: string | null;
        readonly sourceProposedPlanThreadId: string | null;
        readonly sourceProposedPlanId: string | null;
        readonly startedAt: string;
      }>`
        SELECT
          turn_id AS "turnId",
          pending_message_id AS "userMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          started_at AS "startedAt"
        FROM projection_turns
        WHERE turn_id = ${turnId}
      `;
    }).pipe(Effect.provide(secondProjectionLayer));

    assert.deepEqual(turnRows, [
      {
        turnId: "turn-restart",
        userMessageId: "message-restart",
        sourceProposedPlanThreadId: "thread-plan-source",
        sourceProposedPlanId: "plan-source",
        startedAt: turnStartedAt,
      },
    ]);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-projection-pipeline-restart-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.effect("replays plan launch and epic-run projections across pipeline restart", () =>
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig;
    const persistenceLayer = makeSqlitePersistenceLive(dbPath);
    const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
      Layer.provideMerge(OrchestrationEventStoreLive),
      Layer.provideMerge(persistenceLayer),
    );
    const snapshotQueryLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provideMerge(persistenceLayer),
    );

    const requestedAt = "2026-04-07T12:00:00.000Z";
    const preparedAt = "2026-04-07T12:00:10.000Z";
    const startedAt = "2026-04-07T12:00:20.000Z";

    yield* Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* eventStore.append({
        type: "plan-implementation-launch.requested",
        eventId: EventId.makeUnsafe("evt-launch-restart-1"),
        aggregateKind: "planImplementationLaunch",
        aggregateId: "launch-restart-1" as never,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-launch-restart-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-launch-restart-1"),
        metadata: {},
        payload: {
          launchId: "launch-restart-1" as never,
          sourceThreadId: ThreadId.makeUnsafe("thread-source"),
          sourcePlanId: "plan-source",
          projectId: ProjectId.makeUnsafe("project-1"),
          targetThreadId: ThreadId.makeUnsafe("thread-target"),
          retryOfLaunchId: null,
          title: "Implement source plan",
          promptText: "Ship the plan",
          setupEnabled: true,
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: null,
          providerOptions: null,
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          launchMode: "worktree",
          requestedAt,
          updatedAt: requestedAt,
        },
      });

      yield* eventStore.append({
        type: "plan-implementation-launch.worktree-prepared",
        eventId: EventId.makeUnsafe("evt-launch-restart-2"),
        aggregateKind: "planImplementationLaunch",
        aggregateId: "launch-restart-1" as never,
        occurredAt: preparedAt,
        commandId: CommandId.makeUnsafe("cmd-launch-restart-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-launch-restart-2"),
        metadata: {},
        payload: {
          launchId: "launch-restart-1" as never,
          branch: "feature/source-plan",
          worktreePath: "/tmp/project-1/.worktrees/source-plan",
          preparedAt,
          updatedAt: preparedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-run.requested",
        eventId: EventId.makeUnsafe("evt-epic-restart-1"),
        aggregateKind: "epicRun",
        aggregateId: "run-restart-1" as never,
        occurredAt: requestedAt,
        commandId: CommandId.makeUnsafe("cmd-epic-restart-1"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-epic-restart-1"),
        metadata: {},
        payload: {
          runId: "run-restart-1" as never,
          projectId: ProjectId.makeUnsafe("project-1"),
          epicIssueId: "EPIC-RESTART",
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: null,
          providerOptions: null,
          assistantDeliveryMode: "streaming",
          runtimeMode: "full-access",
          requestedAt,
          updatedAt: requestedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-run.started",
        eventId: EventId.makeUnsafe("evt-epic-restart-2"),
        aggregateKind: "epicRun",
        aggregateId: "run-restart-1" as never,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-epic-restart-2"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-epic-restart-2"),
        metadata: {},
        payload: {
          runId: "run-restart-1" as never,
          startedAt,
          updatedAt: startedAt,
        },
      });

      yield* eventStore.append({
        type: "epic-issue-execution.requested",
        eventId: EventId.makeUnsafe("evt-epic-restart-3"),
        aggregateKind: "epicIssueExecution",
        aggregateId: "execution-restart-1" as never,
        occurredAt: startedAt,
        commandId: CommandId.makeUnsafe("cmd-epic-restart-3"),
        causationEventId: null,
        correlationId: CorrelationId.makeUnsafe("cmd-epic-restart-3"),
        metadata: {},
        payload: {
          executionId: "execution-restart-1" as never,
          runId: "run-restart-1" as never,
          issueId: "TASK-RESTART-1",
          workerThreadId: ThreadId.makeUnsafe("thread-target"),
          sequenceNumber: 1,
          requestedAt: startedAt,
          updatedAt: startedAt,
        },
      });

      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(firstProjectionLayer));

    yield* Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      yield* projectionPipeline.bootstrap;
    }).pipe(Effect.provide(secondProjectionLayer));

    const snapshot = yield* Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      return yield* snapshotQuery.getSnapshot();
    }).pipe(Effect.provide(snapshotQueryLayer));

    assert.deepEqual(snapshot.planImplementationLaunches, [
      {
        launchId: "launch-restart-1",
        sourceThreadId: "thread-source",
        sourcePlanId: "plan-source",
        projectId: "project-1",
        targetThreadId: "thread-target",
        retryOfLaunchId: null,
        status: "prepared",
        launchMode: "worktree",
        branch: "feature/source-plan",
        worktreePath: "/tmp/project-1/.worktrees/source-plan",
        failureReason: null,
        cleanupStatus: "not-required",
        cleanupError: null,
        title: "Implement source plan",
        setupEnabled: true,
        requestedAt,
        preparedAt,
        startedAt: null,
        failedAt: null,
        cancelledAt: null,
        updatedAt: preparedAt,
      },
    ]);
    assert.deepEqual(snapshot.epicRuns, [
      {
        runId: "run-restart-1",
        projectId: "project-1",
        epicIssueId: "EPIC-RESTART",
        status: "running",
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "streaming",
        runtimeMode: "full-access",
        failureContext: null,
        requestedAt,
        startedAt,
        stopRequestedAt: null,
        stoppedAt: null,
        failedAt: null,
        completedAt: null,
        updatedAt: startedAt,
      },
    ]);
    assert.deepEqual(snapshot.epicIssueExecutions, [
      {
        executionId: "execution-restart-1",
        runId: "run-restart-1",
        issueId: "TASK-RESTART-1",
        workerThreadId: "thread-target",
        sequenceNumber: 1,
        status: "launching",
        workspaceKey: "shared",
        workspacePath: null,
        failureContext: null,
        requestedAt: startedAt,
        startedAt: null,
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: null,
        failedAt: null,
        updatedAt: startedAt,
      },
    ]);
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-projection-pipeline-run-restart-",
        }),
        NodeServices.layer,
      ),
    ),
  ),
);

it.layer(BaseTestLayer)("OrchestrationProjectionPipeline terminal session settlement", (it) => {
  it.effect(
    "settles the persisted latest turn when thread.session-set ends a running turn without settledTurn metadata",
    () =>
      Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const sql = yield* SqlClient.SqlClient;

        yield* eventStore.append({
          type: "project.created",
          eventId: EventId.makeUnsafe("evt-session-terminal-project"),
          aggregateKind: "project",
          aggregateId: ProjectId.makeUnsafe("project-session-terminal"),
          occurredAt: "2026-03-01T12:00:00.000Z",
          commandId: CommandId.makeUnsafe("cmd-session-terminal-project"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-session-terminal-project"),
          metadata: {},
          payload: {
            projectId: ProjectId.makeUnsafe("project-session-terminal"),
            title: "Session Terminal Project",
            workspaceRoot: "/tmp/project-session-terminal",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-03-01T12:00:00.000Z",
            updatedAt: "2026-03-01T12:00:00.000Z",
          },
        });

        yield* eventStore.append({
          type: "thread.created",
          eventId: EventId.makeUnsafe("evt-session-terminal-thread"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-session-terminal"),
          occurredAt: "2026-03-01T12:00:01.000Z",
          commandId: CommandId.makeUnsafe("cmd-session-terminal-thread"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-session-terminal-thread"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-session-terminal"),
            projectId: ProjectId.makeUnsafe("project-session-terminal"),
            title: "Thread Session Terminal",
            modelSelection: { provider: "codex", model: "gpt-5-codex" },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: "2026-03-01T12:00:01.000Z",
            updatedAt: "2026-03-01T12:00:01.000Z",
          },
        });

        yield* eventStore.append({
          type: "thread.session-set",
          eventId: EventId.makeUnsafe("evt-session-terminal-running"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-session-terminal"),
          occurredAt: "2026-03-01T12:00:02.000Z",
          commandId: CommandId.makeUnsafe("cmd-session-terminal-running"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-session-terminal-running"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-session-terminal"),
            session: {
              threadId: ThreadId.makeUnsafe("thread-session-terminal"),
              status: "running",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: TurnId.makeUnsafe("turn-session-terminal"),
              lastError: null,
              updatedAt: "2026-03-01T12:00:02.000Z",
            },
          },
        });

        yield* eventStore.append({
          type: "thread.session-set",
          eventId: EventId.makeUnsafe("evt-session-terminal-error"),
          aggregateKind: "thread",
          aggregateId: ThreadId.makeUnsafe("thread-session-terminal"),
          occurredAt: "2026-03-01T12:00:05.000Z",
          commandId: CommandId.makeUnsafe("cmd-session-terminal-error"),
          causationEventId: null,
          correlationId: CorrelationId.makeUnsafe("cmd-session-terminal-error"),
          metadata: {},
          payload: {
            threadId: ThreadId.makeUnsafe("thread-session-terminal"),
            session: {
              threadId: ThreadId.makeUnsafe("thread-session-terminal"),
              status: "error",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: "provider process exited unexpectedly",
              updatedAt: "2026-03-01T12:00:05.000Z",
            },
          },
        });

        yield* projectionPipeline.bootstrap;

        const turnRows = yield* sql<{
          readonly state: string;
          readonly completedAt: string | null;
        }>`
            SELECT
              state,
              completed_at AS "completedAt"
            FROM projection_turns
            WHERE thread_id = 'thread-session-terminal'
              AND turn_id = 'turn-session-terminal'
          `;

        assert.deepEqual(turnRows, [
          {
            state: "error",
            completedAt: "2026-03-01T12:00:05.000Z",
          },
        ]);
      }),
  );
});

const engineLayer = it.layer(
  (() => {
    const { serverConfigLayer, sqliteLayer } = makeTestPersistenceLayer(
      "t3-projection-pipeline-engine-dispatch-",
    );
    return OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provideMerge(sqliteLayer),
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );
  })(),
);

engineLayer("OrchestrationProjectionPipeline via engine dispatch", (it) => {
  it.effect("projects dispatched engine events immediately", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = new Date().toISOString();

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-live-project"),
        projectId: ProjectId.makeUnsafe("project-live"),
        title: "Live Project",
        workspaceRoot: "/tmp/project-live",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      });

      const projectRows = yield* sql<{ readonly title: string; readonly scriptsJson: string }>`
        SELECT
          title,
          scripts_json AS "scriptsJson"
        FROM projection_projects
        WHERE project_id = 'project-live'
      `;
      assert.deepEqual(projectRows, [{ title: "Live Project", scriptsJson: "[]" }]);

      const projectorRows = yield* sql<{ readonly lastAppliedSequence: number }>`
        SELECT
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector = 'projection.projects'
      `;
      assert.deepEqual(projectorRows, [{ lastAppliedSequence: 1 }]);
    }),
  );

  it.effect("projects persist updated scripts from project.meta.update", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = new Date().toISOString();

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-scripts-project-create"),
        projectId: ProjectId.makeUnsafe("project-scripts"),
        title: "Scripts Project",
        workspaceRoot: "/tmp/project-scripts",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      });

      yield* engine.dispatch({
        type: "project.meta.update",
        commandId: CommandId.makeUnsafe("cmd-scripts-project-update"),
        projectId: ProjectId.makeUnsafe("project-scripts"),
        scripts: [
          {
            id: "script-1",
            name: "Build",
            command: "bun run build",
            icon: "build",
            runOnWorktreeCreate: false,
          },
        ],
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5",
        },
      });

      const projectRows = yield* sql<{
        readonly scriptsJson: string;
        readonly defaultModelSelection: string;
      }>`
        SELECT
          scripts_json AS "scriptsJson",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-scripts'
      `;
      assert.deepEqual(projectRows, [
        {
          scriptsJson:
            '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
          defaultModelSelection: '{"instanceId":"codex","model":"gpt-5"}',
        },
      ]);
    }),
  );
});
