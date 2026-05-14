// @ts-nocheck
import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ProjectionThreadSubagentEntryRepository,
  ProjectionThreadSubagentRunRepository,
} from "../Services/ProjectionThreadSubagents.ts";
import {
  ProjectionThreadSubagentEntryRepositoryLive,
  ProjectionThreadSubagentRunRepositoryLive,
} from "./ProjectionThreadSubagents.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionThreadSubagentRunRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadSubagentEntryRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

layer("ProjectionThreadSubagent repositories", (it) => {
  it.effect("creates subagent projection tables and indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'projection_thread_subagent_runs',
            'projection_thread_subagent_entries'
          )
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["projection_thread_subagent_entries", "projection_thread_subagent_runs"],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name IN (
            'projection_thread_subagent_runs',
            'projection_thread_subagent_entries'
          )
          AND name IN (
            'idx_projection_thread_subagent_runs_thread_started',
            'idx_projection_thread_subagent_entries_run_created',
            'idx_projection_thread_subagent_runs_thread_turn'
          )
        ORDER BY name ASC
      `;
      assert.deepStrictEqual(
        indexes.map((index) => index.name),
        [
          "idx_projection_thread_subagent_entries_run_created",
          "idx_projection_thread_subagent_runs_thread_started",
          "idx_projection_thread_subagent_runs_thread_turn",
        ],
      );
    }),
  );

  it.effect("upserts, reads ordered runs, and decodes config JSON", () =>
    Effect.gen(function* () {
      const runs = yield* ProjectionThreadSubagentRunRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-subagent-runs");
      const otherThreadId = ThreadId.makeUnsafe("thread-subagent-other");
      const turnId = TurnId.makeUnsafe("turn-subagent-runs");

      yield* runs.upsert({
        runId: "run-b",
        threadId,
        turnId,
        parentItemId: "item-parent-b",
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex-main"),
        providerRunId: "provider-run-b",
        title: "Initial title",
        description: "Initial description",
        prompt: "Investigate B",
        agentType: "implementation",
        model: "gpt-5.4",
        reasoningEffort: "high",
        config: { limits: { files: 3 }, flags: ["fast"] },
        status: "running",
        startedAt: "2026-05-14T10:00:02.000Z",
        completedAt: null,
        updatedAt: "2026-05-14T10:00:02.000Z",
      });

      yield* runs.upsert({
        runId: "run-a",
        threadId,
        turnId,
        parentItemId: "item-parent-a",
        provider: "codex",
        providerInstanceId: null,
        providerRunId: null,
        title: null,
        description: null,
        prompt: null,
        agentType: null,
        model: null,
        reasoningEffort: null,
        config: { sequence: 1 },
        status: "completed",
        startedAt: "2026-05-14T10:00:01.000Z",
        completedAt: "2026-05-14T10:00:03.000Z",
        updatedAt: "2026-05-14T10:00:03.000Z",
      });

      yield* runs.upsert({
        runId: "run-c",
        threadId,
        turnId,
        parentItemId: "item-parent-c",
        provider: "claude",
        providerInstanceId: null,
        providerRunId: null,
        title: "Tie breaker",
        description: null,
        prompt: null,
        agentType: null,
        model: null,
        reasoningEffort: null,
        config: { sequence: 3 },
        status: "failed",
        startedAt: "2026-05-14T10:00:02.000Z",
        completedAt: "2026-05-14T10:00:04.000Z",
        updatedAt: "2026-05-14T10:00:04.000Z",
      });

      yield* runs.upsert({
        runId: "run-other",
        threadId: otherThreadId,
        turnId,
        parentItemId: "item-parent-other",
        provider: "codex",
        providerInstanceId: null,
        providerRunId: null,
        title: null,
        description: null,
        prompt: null,
        agentType: null,
        model: null,
        reasoningEffort: null,
        config: {},
        status: "running",
        startedAt: "2026-05-14T10:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-05-14T10:00:00.000Z",
      });

      yield* runs.upsert({
        runId: "run-b",
        threadId,
        turnId,
        parentItemId: "item-parent-b",
        provider: "codex",
        providerInstanceId: ProviderInstanceId.make("codex-main"),
        providerRunId: "provider-run-b-updated",
        title: "Updated title",
        description: "Updated description",
        prompt: "Investigate B again",
        agentType: "review",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        config: { limits: { files: 5 }, flags: ["careful"] },
        status: "completed",
        startedAt: "2026-05-14T10:00:02.000Z",
        completedAt: "2026-05-14T10:00:05.000Z",
        updatedAt: "2026-05-14T10:00:05.000Z",
      });

      const listed = yield* runs.listByThreadId({ threadId });
      assert.deepStrictEqual(
        listed.map((run) => run.runId),
        ["run-a", "run-b", "run-c"],
      );
      assert.deepStrictEqual(listed[1]?.config, {
        limits: { files: 5 },
        flags: ["careful"],
      });
      assert.strictEqual(listed[1]?.title, "Updated title");
      assert.strictEqual(listed[1]?.status, "completed");

      const byId = yield* runs.getByRunId({ runId: "run-b" });
      assert.deepStrictEqual(Option.getOrNull(byId)?.config, {
        limits: { files: 5 },
        flags: ["careful"],
      });

      const rows = yield* sql<{ readonly configJson: string }>`
        SELECT config_json AS "configJson"
        FROM projection_thread_subagent_runs
        WHERE run_id = 'run-b'
      `;
      assert.strictEqual(
        rows[0]?.configJson,
        JSON.stringify({ limits: { files: 5 }, flags: ["careful"] }),
      );

      yield* runs.deleteByThreadId({ threadId });
      assert.deepStrictEqual(yield* runs.listByThreadId({ threadId }), []);
      assert.strictEqual((yield* runs.listByThreadId({ threadId: otherThreadId })).length, 1);
    }),
  );

  it.effect("upserts, reads ordered entries, and decodes payload JSON", () =>
    Effect.gen(function* () {
      const runs = yield* ProjectionThreadSubagentRunRepository;
      const entries = yield* ProjectionThreadSubagentEntryRepository;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.makeUnsafe("thread-subagent-entries");
      const turnId = TurnId.makeUnsafe("turn-subagent-entries");

      yield* runs.upsert({
        runId: "run-for-entries",
        threadId,
        turnId,
        parentItemId: "item-parent-entries",
        provider: "codex",
        providerInstanceId: null,
        providerRunId: null,
        title: null,
        description: null,
        prompt: null,
        agentType: null,
        model: null,
        reasoningEffort: null,
        config: {},
        status: "running",
        startedAt: "2026-05-14T11:00:00.000Z",
        completedAt: null,
        updatedAt: "2026-05-14T11:00:00.000Z",
      });

      yield* entries.upsert({
        entryId: "entry-b",
        runId: "run-for-entries",
        kind: "tool",
        title: "Tool call",
        text: "Reading files",
        payload: { tool: "rg", args: ["needle"] },
        createdAt: "2026-05-14T11:00:02.000Z",
      });

      yield* entries.upsert({
        entryId: "entry-a",
        runId: "run-for-entries",
        kind: "assistant",
        title: null,
        text: "Starting",
        payload: { message: { index: 1 } },
        createdAt: "2026-05-14T11:00:01.000Z",
      });

      yield* entries.upsert({
        entryId: "entry-c",
        runId: "run-for-entries",
        kind: "result",
        title: "Result",
        text: "Done",
        payload: { result: true },
        createdAt: "2026-05-14T11:00:02.000Z",
      });

      yield* entries.upsert({
        entryId: "entry-b",
        runId: "run-for-entries",
        kind: "tool",
        title: "Updated tool call",
        text: "Reading files again",
        payload: { tool: "rg", args: ["updated"], count: 2 },
        createdAt: "2026-05-14T11:00:02.000Z",
      });

      const listed = yield* entries.listByRunId({ runId: "run-for-entries" });
      assert.deepStrictEqual(
        listed.map((entry) => entry.entryId),
        ["entry-a", "entry-b", "entry-c"],
      );
      assert.deepStrictEqual(listed[1]?.payload, {
        tool: "rg",
        args: ["updated"],
        count: 2,
      });
      assert.strictEqual(listed[1]?.title, "Updated tool call");

      const rows = yield* sql<{ readonly payloadJson: string }>`
        SELECT payload_json AS "payloadJson"
        FROM projection_thread_subagent_entries
        WHERE entry_id = 'entry-b'
      `;
      assert.strictEqual(
        rows[0]?.payloadJson,
        JSON.stringify({ tool: "rg", args: ["updated"], count: 2 }),
      );

      yield* entries.deleteByRunId({ runId: "run-for-entries" });
      assert.deepStrictEqual(yield* entries.listByRunId({ runId: "run-for-entries" }), []);

      yield* entries.upsert({
        entryId: "entry-delete-thread",
        runId: "run-for-entries",
        kind: "system",
        title: null,
        text: "Delete by thread",
        payload: { scope: "thread" },
        createdAt: "2026-05-14T11:00:03.000Z",
      });
      yield* entries.deleteByThreadId({ threadId });
      assert.deepStrictEqual(yield* entries.listByRunId({ runId: "run-for-entries" }), []);
    }),
  );
});
