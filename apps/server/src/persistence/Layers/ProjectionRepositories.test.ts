// @ts-nocheck
import { ProjectId, EpicRunId, EpicIssueExecutionId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionEpicRunRepositoryLive } from "./ProjectionEpicRuns.ts";
import { ProjectionEpicIssueExecutionRepositoryLive } from "./ProjectionEpicIssueExecutions.ts";
import { layerConfig } from "./Sqlite.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionEpicRunRepository } from "../Services/ProjectionEpicRuns.ts";
import { ProjectionEpicIssueExecutionRepository } from "../Services/ProjectionEpicIssueExecutions.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";
import { ServerConfig } from "../../config.ts";

const projectionRepositoriesLayer = it.layer(
  (() => {
    const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-projection-repositories-test-",
    });
    const sqliteLayer = layerConfig.pipe(
      Layer.provide(serverConfigLayer),
      Layer.provide(NodeServices.layer),
    );

    return Layer.mergeAll(
      ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      ProjectionEpicRunRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      ProjectionEpicIssueExecutionRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(sqliteLayer)),
      sqliteLayer,
    );
  })(),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.makeUnsafe("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_projects row to exist."));
      }

      assert.strictEqual(
        row.defaultModelSelection,
        JSON.stringify({
          provider: "codex",
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.makeUnsafe("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.makeUnsafe("thread-null-options"),
        projectId: ProjectId.makeUnsafe("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        issueLink: null,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_threads row to exist."));
      }

      assert.strictEqual(
        row.modelSelection,
        JSON.stringify({
          provider: "claudeAgent",
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.makeUnsafe("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("stores JSON for epic-run provider options and links active execution ids", () =>
    Effect.gen(function* () {
      const epicRuns = yield* ProjectionEpicRunRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* epicRuns.upsert({
        runId: EpicRunId.makeUnsafe("run-json-options"),
        projectId: ProjectId.makeUnsafe("project-null-options"),
        epicIssueId: "EPIC-1",
        status: "running",
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: {
          codex: {
            reasoningEffort: "high",
          },
        },
        providerOptions: {
          codex: {
            approvalPolicy: "never",
            sandboxMode: "danger-full-access",
          },
        },
        assistantDeliveryMode: "streaming",
        runtimeMode: "full-access",
        failureContext: null,
        requestedAt: "2026-04-06T00:00:00.000Z",
        startedAt: "2026-04-06T00:00:01.000Z",
        stopRequestedAt: null,
        stoppedAt: null,
        failedAt: null,
        completedAt: null,
        updatedAt: "2026-04-06T00:00:02.000Z",
      });

      const rows = yield* sql<{
        readonly modelOptions: string | null;
        readonly providerOptions: string | null;
      }>`
        SELECT
          model_options_json AS "modelOptions",
          provider_options_json AS "providerOptions"
        FROM projection_epic_runs
        WHERE run_id = 'run-json-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Expected projection_epic_runs row to exist."));
      }

      assert.strictEqual(
        row.modelOptions,
        JSON.stringify({
          codex: {
            reasoningEffort: "high",
          },
        }),
      );
      assert.strictEqual(
        row.providerOptions,
        JSON.stringify({
          codex: {
            approvalPolicy: "never",
            sandboxMode: "danger-full-access",
          },
        }),
      );

      const persisted = yield* epicRuns.getById({
        runId: EpicRunId.makeUnsafe("run-json-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.providerOptions, {
        codex: {
          approvalPolicy: "never",
          sandboxMode: "danger-full-access",
        },
      });
    }),
  );

  it.effect("stores epic-run execution rows and nullable worker thread ids", () =>
    Effect.gen(function* () {
      const executions = yield* ProjectionEpicIssueExecutionRepository;

      yield* executions.upsert({
        executionId: EpicIssueExecutionId.makeUnsafe("execution-1"),
        runId: EpicRunId.makeUnsafe("run-json-options"),
        issueId: "TASK-1",
        workerThreadId: null,
        sequenceNumber: 1,
        status: "running",
        workspaceKey: "shared",
        workspacePath: null,
        failureContext: null,
        requestedAt: "2026-04-06T00:00:02.000Z",
        startedAt: "2026-04-06T00:00:03.000Z",
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: null,
        failedAt: null,
        updatedAt: "2026-04-06T00:00:03.000Z",
      });

      const persisted = yield* executions.getById({
        executionId: EpicIssueExecutionId.makeUnsafe("execution-1"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted), {
        executionId: EpicIssueExecutionId.makeUnsafe("execution-1"),
        runId: EpicRunId.makeUnsafe("run-json-options"),
        issueId: "TASK-1",
        workerThreadId: null,
        sequenceNumber: 1,
        status: "running",
        workspaceKey: "shared",
        workspacePath: null,
        failureContext: null,
        requestedAt: "2026-04-06T00:00:02.000Z",
        startedAt: "2026-04-06T00:00:03.000Z",
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: null,
        failedAt: null,
        updatedAt: "2026-04-06T00:00:03.000Z",
      });
    }),
  );
});
