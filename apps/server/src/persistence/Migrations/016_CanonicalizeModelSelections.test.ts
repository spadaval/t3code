import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { repairCanonicalModelSelections } from "./016_CanonicalizeModelSelections.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("016_CanonicalizeModelSelections", (it) => {
  it.effect(
    "migrates legacy projection rows and event payloads to the canonical model-selection shape",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Setup base state
        {
          yield* runMigrations({ toMigrationInclusive: 15 });

          yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES
          ('project-codex', 'Codex project', '/tmp/project-codex', 'gpt-5.4', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-claude', 'Claude project', '/tmp/project-claude', 'claude-sonnet-4-6', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
          ('project-null', 'Null project', '/tmp/project-null', NULL, '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)
      `;
          yield* sql`
        UPDATE projection_projects
        SET default_model = 'claude-opus-4-6'
        WHERE project_id = 'project-claude'
      `;
          yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          ('thread-session', 'project-codex', 'Session thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-claude', 'project-claude', 'Claude thread', 'claude-opus-4-6', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-codex', 'project-codex', 'Codex thread', 'gpt-5.4', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default'),
          ('thread-legacy-options', 'project-claude', 'Legacy options thread', 'claude-opus-4-6', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, 'full-access', 'default')
      `;
          yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          active_turn_id,
          last_error,
          updated_at,
          runtime_mode
        )
        VALUES (
          'thread-session',
          'running',
          'claudeAgent',
          'provider-session-1',
          'provider-thread-1',
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          'full-access'
        )
      `;
          yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
        (
          'event-project-created',
          'project',
          'project-1',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created',
          NULL,
          'correlation-project-created',
          'user',
          '{"projectId":"project-1","title":"Project","workspaceRoot":"/tmp/project","defaultModel":"claude-opus-4-6","defaultModelOptions":{"codex":{"reasoningEffort":"high"},"claudeAgent":{"effort":"max"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-fallback',
          'project',
          'project-2',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-fallback',
          NULL,
          'correlation-project-created-fallback',
          'user',
          '{"projectId":"project-2","title":"Fallback Project","workspaceRoot":"/tmp/project-2","defaultModel":"claude-opus-4-6","defaultModelOptions":{"codex":{"reasoningEffort":"low"}},"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-project-created-null-model',
          'project',
          'project-3',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'command-project-created-null-model',
          NULL,
          'correlation-project-created-null-model',
          'user',
          '{"projectId":"project-3","title":"Null Model Project","workspaceRoot":"/tmp/project-3","defaultModel":null,"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-thread-created',
          'thread',
          'thread-1',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created',
          NULL,
          'correlation-thread-created',
          'user',
          '{"threadId":"thread-1","projectId":"project-1","title":"Thread","model":"claude-opus-4-6","modelOptions":{"codex":{"reasoningEffort":"high"},"claudeAgent":{"effort":"max","thinking":false}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-thread-created-fallback',
          'thread',
          'thread-2',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created-fallback',
          NULL,
          'correlation-thread-created-fallback',
          'user',
          '{"threadId":"thread-2","projectId":"project-1","title":"Fallback Thread","model":"gpt-5.4","modelOptions":{"claudeAgent":{"effort":"max"}},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        ),
        (
          'event-turn-start-requested',
          'thread',
          'thread-1',
          2,
          'thread.turn-start-requested',
          '2026-01-01T00:00:00.000Z',
          'command-turn-start-requested',
          NULL,
          'correlation-turn-start-requested',
          'user',
          '{"threadId":"thread-1","turnId":"turn-1","input":"hi","model":"gpt-5.4","modelOptions":{"codex":{"fastMode":true},"claudeAgent":{"effort":"max"}},"deliveryMode":"buffered"}',
          '{}'
        ),
        (
          'event-thread-created-no-model',
          'thread',
          'thread-3',
          1,
          'thread.created',
          '2026-01-01T00:00:00.000Z',
          'command-thread-created-no-model',
          NULL,
          'correlation-thread-created-no-model',
          'user',
          '{"threadId":"thread-3","projectId":"project-1","title":"Ancient Thread","runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        )
      `;
        }

        // Execute migration under test
        yield* runMigrations({ toMigrationInclusive: 16 });

        // Assert expected state
        {
          const projectRows = yield* sql<{
            readonly projectId: string;
            readonly defaultModelSelection: string | null;
          }>`
        SELECT
          project_id AS "projectId",
          default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        ORDER BY project_id
      `;
          assert.deepStrictEqual(projectRows, [
            {
              projectId: "project-claude",
              defaultModelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              projectId: "project-codex",
              defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            { projectId: "project-null", defaultModelSelection: null },
          ]);

          const threadRows = yield* sql<{
            readonly threadId: string;
            readonly modelSelection: string | null;
          }>`
        SELECT
          thread_id AS "threadId",
          model_selection_json AS "modelSelection"
        FROM projection_threads
        ORDER BY thread_id
      `;
          assert.deepStrictEqual(threadRows, [
            {
              threadId: "thread-claude",
              modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              threadId: "thread-codex",
              modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
            },
            {
              threadId: "thread-legacy-options",
              modelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
            },
            {
              threadId: "thread-session",
              modelSelection: '{"provider":"claudeAgent","model":"gpt-5.4"}',
            },
          ]);

          const eventRows = yield* sql<{
            readonly payloadJson: string;
          }>`
        SELECT payload_json AS "payloadJson"
        FROM orchestration_events
        ORDER BY rowid ASC
      `;

          assert.deepStrictEqual(JSON.parse(eventRows[0]!.payloadJson), {
            projectId: "project-1",
            title: "Project",
            workspaceRoot: "/tmp/project",
            defaultModelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                effort: "max",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[1]!.payloadJson), {
            projectId: "project-2",
            title: "Fallback Project",
            workspaceRoot: "/tmp/project-2",
            defaultModelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                reasoningEffort: "low",
              },
            },
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[2]!.payloadJson), {
            projectId: "project-3",
            title: "Null Model Project",
            workspaceRoot: "/tmp/project-3",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[3]!.payloadJson), {
            threadId: "thread-1",
            projectId: "project-1",
            title: "Thread",
            modelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                effort: "max",
                thinking: false,
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[4]!.payloadJson), {
            threadId: "thread-2",
            projectId: "project-1",
            title: "Fallback Thread",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                effort: "max",
              },
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[5]!.payloadJson), {
            threadId: "thread-1",
            turnId: "turn-1",
            input: "hi",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
              options: {
                fastMode: true,
              },
            },
            deliveryMode: "buffered",
          });

          assert.deepStrictEqual(JSON.parse(eventRows[6]!.payloadJson), {
            threadId: "thread-3",
            projectId: "project-1",
            title: "Ancient Thread",
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          });
        }
      }),
  );

  it.effect(
    "repairs legacy projection tables even when later migrations are already recorded",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DROP TABLE IF EXISTS effect_sql_migrations`;
        yield* sql`DROP TABLE IF EXISTS projection_thread_sessions`;
        yield* sql`DROP TABLE IF EXISTS projection_threads`;
        yield* sql`DROP TABLE IF EXISTS projection_projects`;
        yield* sql`DROP TABLE IF EXISTS orchestration_events`;

        yield* sql`
          CREATE TABLE effect_sql_migrations (
            migration_id integer PRIMARY KEY NOT NULL,
            created_at datetime NOT NULL DEFAULT current_timestamp,
            name VARCHAR(255) NOT NULL
          )
        `;
        yield* sql`
          CREATE TABLE projection_projects (
            project_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            workspace_root TEXT NOT NULL,
            default_model TEXT,
            scripts_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          )
        `;
        yield* sql`
          CREATE TABLE projection_threads (
            thread_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            model TEXT NOT NULL,
            branch TEXT,
            worktree_path TEXT,
            latest_turn_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            runtime_mode TEXT NOT NULL,
            interaction_mode TEXT NOT NULL
          )
        `;
        yield* sql`
          CREATE TABLE projection_thread_sessions (
            thread_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            provider_name TEXT,
            provider_session_id TEXT,
            provider_thread_id TEXT,
            active_turn_id TEXT,
            last_error TEXT,
            updated_at TEXT NOT NULL
          )
        `;
        yield* sql`
          CREATE TABLE orchestration_events (
            event_id TEXT PRIMARY KEY,
            aggregate_kind TEXT NOT NULL,
            stream_id TEXT NOT NULL,
            stream_version INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            command_id TEXT,
            causation_event_id TEXT,
            correlation_id TEXT,
            actor_kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            metadata_json TEXT NOT NULL
          )
        `;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'Project 1',
          '/tmp/project-1',
          'gpt-5.4',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          'gpt-5.4',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          'full-access',
          'default'
        )
      `;

        yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (16, 'CanonicalizeModelSelections'),
          (17, 'ProjectionThreadsArchivedAt'),
          (18, 'ProjectionThreadsArchivedAtIndex'),
          (19, 'ProjectionSnapshotLookupIndexes'),
          (20, 'ProjectionPlanImplementationLaunches')
      `;

        yield* repairCanonicalModelSelections;

        const projectRows = yield* sql<{
          readonly defaultModelSelection: string | null;
        }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
      `;
        assert.deepStrictEqual(projectRows, [
          {
            defaultModelSelection: '{"provider":"codex","model":"gpt-5.4"}',
          },
        ]);

        const threadRows = yield* sql<{
          readonly modelSelection: string | null;
        }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
      `;
        assert.deepStrictEqual(threadRows, [
          {
            modelSelection: '{"provider":"codex","model":"gpt-5.4"}',
          },
        ]);
      }),
  );
});
