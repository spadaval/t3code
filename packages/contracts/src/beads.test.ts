import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BeadsContext,
  BeadsIssueGraph,
  BeadsSessionActivityEntry,
  BeadsSwarmValidation,
} from "./beads";

const decodeBeadsContext = Schema.decodeUnknownEffect(BeadsContext);
const decodeBeadsIssueGraph = Schema.decodeUnknownEffect(BeadsIssueGraph);
const decodeBeadsSessionActivityEntry = Schema.decodeUnknownEffect(BeadsSessionActivityEntry);
const decodeBeadsSwarmValidation = Schema.decodeUnknownEffect(BeadsSwarmValidation);

it.effect("decodes beads context with backend metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsContext({
      beadsDir: "/tmp/repo/.beads",
      repoRoot: "/tmp/repo",
      cwdRepoRoot: "/tmp/repo",
      isRedirected: false,
      isWorktree: true,
      backend: {
        kind: "dolt",
        doltMode: "server",
        database: "repo",
        projectId: "project-1",
        role: "contributor",
        bdVersion: "1.0.0",
      },
    });

    assert.strictEqual(parsed.backend.kind, "dolt");
    assert.strictEqual(parsed.backend.doltMode, "server");
    assert.strictEqual(parsed.isWorktree, true);
  }),
);

it.effect("defaults missing issue graph relations for historical payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsIssueGraph({
      epic: {
        id: "epic-1",
        title: "Epic",
        description: null,
        notes: null,
        status: "open",
        priority: 2,
        issueType: "epic",
        assignee: null,
        owner: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
        labels: [],
        parent: null,
      },
    });

    assert.strictEqual(parsed.parent, null);
    assert.deepStrictEqual(parsed.children, []);
    assert.deepStrictEqual(parsed.dependencies, []);
    assert.deepStrictEqual(parsed.dependents, []);
  }),
);

it.effect("defaults optional swarm validation metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsSwarmValidation({
      epicId: "epic-1",
      epicTitle: "Epic",
      valid: true,
    });

    assert.strictEqual(parsed.swarm, null);
    assert.deepStrictEqual(parsed.errors, []);
    assert.deepStrictEqual(parsed.warnings, []);
    assert.deepStrictEqual(parsed.readyFronts, []);
    assert.strictEqual(parsed.estimatedWorkerSessions, null);
    assert.strictEqual(parsed.maxParallelism, null);
  }),
);

it.effect("accepts plan-implementation workflow activity entries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsSessionActivityEntry({
      kind: "workflow-started",
      issue: {
        id: "epic-1",
        title: "Epic",
        description: null,
        notes: null,
        status: "open",
        priority: 2,
        issueType: "epic",
        assignee: null,
        owner: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
        labels: [],
        parent: null,
      },
      createdAt: "2026-01-03T00:00:00.000Z",
      workflowKind: "plan-implementation",
      threadId: "thread-1",
    });

    assert.strictEqual(parsed.workflowKind, "plan-implementation");
  }),
);
