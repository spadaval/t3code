import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BeadsContext,
  BeadsEpicCoordinatorSnapshot,
  BeadsIssueGraph,
  BeadsProjectCoordinatorSnapshot,
  BeadsSessionActivityEntry,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsSwarmValidation,
} from "./beads";

const decodeBeadsContext = Schema.decodeUnknownEffect(BeadsContext);
const decodeBeadsEpicCoordinatorSnapshot = Schema.decodeUnknownEffect(BeadsEpicCoordinatorSnapshot);
const decodeBeadsIssueGraph = Schema.decodeUnknownEffect(BeadsIssueGraph);
const decodeBeadsProjectCoordinatorSnapshot = Schema.decodeUnknownEffect(
  BeadsProjectCoordinatorSnapshot,
);
const decodeBeadsSessionActivityEntry = Schema.decodeUnknownEffect(BeadsSessionActivityEntry);
const decodeBeadsStartEpicCoordinationPrepInput = Schema.decodeUnknownEffect(
  BeadsStartEpicCoordinationPrepInput,
);
const decodeBeadsStartWorkflowInput = Schema.decodeUnknownEffect(BeadsStartWorkflowInput);
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

it.effect("accepts coordination-prep workflow activity entries", () =>
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
      workflowKind: "coordination-prep",
      threadId: "thread-1",
    });

    assert.strictEqual(parsed.workflowKind, "coordination-prep");
  }),
);

it.effect("accepts plan-implementation workflow launches", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsStartWorkflowInput({
      cwd: "/tmp/repo",
      projectId: "project-1",
      issueId: "TASK-1",
      workflow: "plan-implementation",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
      runtimeMode: "full-access",
    });

    assert.strictEqual(parsed.workflow, "plan-implementation");
  }),
);

it.effect("accepts epic coordination prep launches", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsStartEpicCoordinationPrepInput({
      cwd: "/tmp/repo",
      projectId: "project-1",
      epicIssueId: "EPIC-1",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
      runtimeMode: "full-access",
    });

    assert.strictEqual(parsed.epicIssueId, "EPIC-1");
  }),
);

it.effect("defaults coordinator snapshot collections", () =>
  Effect.gen(function* () {
    const project = yield* decodeBeadsProjectCoordinatorSnapshot({
      projectId: "project-1",
      support: {
        supported: true,
        backend: {
          kind: "dolt",
        },
      },
    });
    const epic = yield* decodeBeadsEpicCoordinatorSnapshot({
      projectId: "project-1",
      support: {
        supported: true,
        backend: {
          kind: "dolt",
        },
      },
      epic: {
        epicId: "epic-1",
        epicTitle: "Epic",
        fetchLifecycle: { kind: "ready" },
        stateKind: "ready",
        primaryAction: {
          kind: "start_swarm",
          label: "Start swarm",
          busyLabel: "Starting...",
          disabled: false,
        },
      },
    });

    assert.deepStrictEqual(project.epics, []);
    assert.strictEqual(epic.epic.issue, null);
    assert.deepStrictEqual(epic.epic.runs, []);
    assert.deepStrictEqual(epic.epic.executions, []);
    assert.strictEqual(epic.epic.activeExecution, null);
  }),
);
