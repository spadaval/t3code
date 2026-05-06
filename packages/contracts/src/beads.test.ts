import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  BeadsContext,
  BeadsEpicIssueSummaries,
  BeadsEpicCoordinationDetail,
  BeadsIssueGraph,
  BeadsResolveIssueRefsInput,
  BeadsResolveIssueRefsResult,
  BeadsIssueSummary,
  BeadsQueryIssuesInput,
  BeadsProjectRunSummary,
  BeadsSessionActivityEntry,
  BeadsStartBacklogGroomingInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
} from "./beads.ts";

const decodeBeadsContext = Schema.decodeUnknownEffect(BeadsContext);
const decodeBeadsEpicIssueSummaries = Schema.decodeUnknownEffect(BeadsEpicIssueSummaries);
const decodeBeadsEpicCoordinationDetail = Schema.decodeUnknownEffect(BeadsEpicCoordinationDetail);
const decodeBeadsIssueGraph = Schema.decodeUnknownEffect(BeadsIssueGraph);
const decodeBeadsResolveIssueRefsInput = Schema.decodeUnknownEffect(BeadsResolveIssueRefsInput);
const decodeBeadsResolveIssueRefsResult = Schema.decodeUnknownEffect(BeadsResolveIssueRefsResult);
const decodeBeadsIssueSummary = Schema.decodeUnknownEffect(BeadsIssueSummary);
const decodeBeadsQueryIssuesInput = Schema.decodeUnknownEffect(BeadsQueryIssuesInput);
const decodeBeadsProjectRunSummary = Schema.decodeUnknownEffect(BeadsProjectRunSummary);
const decodeBeadsSessionActivityEntry = Schema.decodeUnknownEffect(BeadsSessionActivityEntry);
const decodeBeadsStartBacklogGroomingInput = Schema.decodeUnknownEffect(
  BeadsStartBacklogGroomingInput,
);
const decodeBeadsStartEpicCoordinationPrepInput = Schema.decodeUnknownEffect(
  BeadsStartEpicCoordinationPrepInput,
);
const decodeBeadsStartWorkflowInput = Schema.decodeUnknownEffect(BeadsStartWorkflowInput);
const decodeBeadsEpicCoordinationStatus = Schema.decodeUnknownEffect(BeadsEpicCoordinationStatus);
const decodeBeadsEpicCoordinationValidation = Schema.decodeUnknownEffect(
  BeadsEpicCoordinationValidation,
);

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

it.effect("defaults missing issue summary dependency refs for historical payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsIssueSummary({
      id: "TASK-1",
      title: "Task",
      description: null,
      notes: null,
      status: "open",
      priority: 2,
      issueType: "task",
      assignee: null,
      owner: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
      labels: [],
      parent: null,
    });

    assert.deepStrictEqual(parsed.dependencyRefs, []);
  }),
);

it.effect("decodes beads issue reference resolution inputs and partial results", () =>
  Effect.gen(function* () {
    const input = yield* decodeBeadsResolveIssueRefsInput({
      cwd: "/tmp/repo",
      issueIds: ["t3code-dci", "t3code-missing"],
    });
    const result = yield* decodeBeadsResolveIssueRefsResult({
      issues: [
        {
          id: "t3code-dci",
          title: "Merge nightly",
          status: "open",
          issueType: "task",
        },
      ],
      missingIssueIds: ["t3code-missing"],
      loadErrors: [
        {
          issueId: "t3code-bad",
          message: "Failed to run bd: permission denied.",
        },
      ],
    });

    assert.deepStrictEqual(input.issueIds, ["t3code-dci", "t3code-missing"]);
    assert.strictEqual(result.issues[0]?.title, "Merge nightly");
    assert.deepStrictEqual(result.missingIssueIds, ["t3code-missing"]);
    assert.strictEqual(result.loadErrors[0]?.message, "Failed to run bd: permission denied.");
  }),
);

it.effect("accepts created/title issue sorting inputs", () =>
  Effect.gen(function* () {
    const parsedCreated = yield* decodeBeadsQueryIssuesInput({
      cwd: "/tmp/repo",
      sortBy: "created",
    });
    const parsedTitle = yield* decodeBeadsQueryIssuesInput({
      cwd: "/tmp/repo",
      sortBy: "title",
    });

    assert.strictEqual(parsedCreated.sortBy, "created");
    assert.strictEqual(parsedTitle.sortBy, "title");
  }),
);

it.effect("defaults optional coordination validation metadata", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsEpicCoordinationValidation({
      epicId: "epic-1",
      epicTitle: "Epic",
      valid: true,
    });

    assert.strictEqual(parsed.summary, null);
    assert.deepStrictEqual(parsed.errors, []);
    assert.deepStrictEqual(parsed.warnings, []);
    assert.deepStrictEqual(parsed.readyFronts, []);
    assert.strictEqual(parsed.estimatedWorkerSessions, null);
    assert.strictEqual(parsed.maxParallelism, null);
  }),
);

it.effect("defaults coordination status blocked breakdown for historical payloads", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsEpicCoordinationStatus({
      epicId: "epic-1",
      epicTitle: "Epic",
      completed: [],
      active: [],
      ready: [],
      blocked: [{ id: "TASK-2", title: "Task 2", status: "blocked", issueType: "task" }],
    });

    assert.deepStrictEqual(parsed.blockedBreakdown, {
      internal: [],
      external: [],
      unknown: [],
    });
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

it.effect("accepts backlog grooming launches", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeBeadsStartBacklogGroomingInput({
      cwd: "/tmp/repo",
      projectId: "project-1",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4-mini",
      },
      runtimeMode: "full-access",
    });

    assert.strictEqual(parsed.projectId, "project-1");
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

it.effect("defaults focused coordinator collections", () =>
  Effect.gen(function* () {
    const project = yield* decodeBeadsProjectRunSummary({
      projectId: "project-1",
    });
    const summaries = yield* decodeBeadsEpicIssueSummaries({
      epicId: "epic-1",
      epicTitle: "Epic",
      progress: {
        totalIssueCount: 0,
        completedIssueCount: 0,
        readyIssueCount: 0,
        activeIssueCount: 0,
        blockedIssueCount: 0,
        internalBlockedIssueCount: 0,
        externalBlockedIssueCount: 0,
        unknownBlockedIssueCount: 0,
        activeWorkerCount: 0,
        isComplete: false,
      },
    });
    const detail = yield* decodeBeadsEpicCoordinationDetail({
      epicId: "epic-1",
      coordinationLoadState: "ready",
      validationState: "valid",
      coordinationState: "not_started",
      execution: {
        state: "ready",
        summary: "Epic is ready to launch.",
        blockingReason: null,
        nextIssue: null,
      },
      commands: [
        {
          kind: "start_epic_run",
          label: "Start run",
          busyLabel: "Starting...",
          disabled: false,
          disabledReason: null,
        },
      ],
    });

    assert.deepStrictEqual(project.epics, []);
    assert.deepStrictEqual(summaries.issues, []);
    assert.strictEqual(detail.coordinationLoadDetail, null);
    assert.deepStrictEqual(detail.validationErrors, []);
    assert.strictEqual(detail.summary, null);
    assert.strictEqual(detail.validation, null);
    assert.strictEqual(detail.status, null);
  }),
);
