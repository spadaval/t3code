// @ts-nocheck
import {
  CommandId,
  EventId,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt: string;
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  commandId: string | null;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : input.aggregateKind === "thread"
          ? ThreadId.makeUnsafe(input.aggregateId)
          : input.aggregateKind === "epicRun"
            ? EpicRunId.makeUnsafe(input.aggregateId)
            : input.aggregateKind === "epicIssueExecution"
              ? EpicIssueExecutionId.makeUnsafe(input.aggregateId)
              : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

async function projectEvents(
  model: ReturnType<typeof createEmptyReadModel>,
  events: ReadonlyArray<OrchestrationEvent>,
) {
  let current = model;
  for (const event of events) {
    current = await Effect.runPromise(projectEvent(current, event));
  }
  return current;
}

function makeThreadCreatedEvent(input: {
  sequence: number;
  threadId: string;
  projectId?: string;
  occurredAt: string;
}): OrchestrationEvent {
  return makeEvent({
    sequence: input.sequence,
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: input.occurredAt,
    commandId: `cmd-thread-create-${input.threadId}`,
    payload: {
      threadId: input.threadId,
      projectId: input.projectId ?? "project-1",
      title: "demo",
      modelSelection: {
        provider: ProviderDriverKind.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  });
}

function makeSubagentRun(input: {
  id: string;
  threadId: string;
  turnId: string;
  startedAt: string;
  entries?: ReadonlyArray<{
    readonly id: string;
    readonly runId: string;
    readonly createdAt: string;
    readonly text?: string;
  }>;
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    turnId: input.turnId,
    parentItemId: `item-${input.id}`,
    provider: ProviderDriverKind.make("codex"),
    description: null,
    prompt: "inspect",
    agentType: "explorer",
    model: "gpt-5-codex",
    reasoningEffort: null,
    config: {},
    status: "running",
    startedAt: input.startedAt,
    completedAt: null,
    updatedAt: input.startedAt,
    entries: (input.entries ?? []).map((entry) => ({
      id: entry.id,
      runId: entry.runId,
      kind: "assistant",
      title: null,
      text: entry.text ?? entry.id,
      payload: { id: entry.id },
      createdAt: entry.createdAt,
    })),
  };
}

describe("orchestration projector", () => {
  it("applies thread.created events", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    expect(next.snapshotSequence).toBe(1);
    expect(next.threads).toEqual([
      {
        id: "thread-1",
        projectId: "project-1",
        title: "demo",
        modelSelection: {
          instanceId: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        issueLink: null,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        subagentRuns: [],
        activities: [],
        checkpoints: [],
        pendingCheckpointCaptures: [],
        session: null,
      },
    ]);
  });

  it("projects subagent runs and entries in deterministic order", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);
    const thread = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: { provider: ProviderDriverKind.make("codex"), model: "gpt-5-codex" },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    const withRun = await Effect.runPromise(
      projectEvent(
        thread,
        makeEvent({
          sequence: 2,
          type: "thread.subagent-run-upserted",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: "2026-01-01T00:00:01.000Z",
          commandId: "cmd-run",
          payload: {
            threadId: "thread-1",
            run: {
              id: "run-1",
              threadId: "thread-1",
              turnId: "turn-1",
              parentItemId: "item-1",
              provider: ProviderDriverKind.make("codex"),
              description: null,
              prompt: "inspect",
              agentType: "explorer",
              model: "gpt-5-codex",
              reasoningEffort: null,
              config: { depth: 1 },
              status: "running",
              startedAt: "2026-01-01T00:00:01.000Z",
              completedAt: null,
              updatedAt: "2026-01-01T00:00:01.000Z",
              entries: [],
            },
          },
        }),
      ),
    );

    const withEntry = await Effect.runPromise(
      projectEvent(
        withRun,
        makeEvent({
          sequence: 3,
          type: "thread.subagent-entry-appended",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: "2026-01-01T00:00:02.000Z",
          commandId: "cmd-entry",
          payload: {
            threadId: "thread-1",
            runId: "run-1",
            entry: {
              id: "entry-1",
              runId: "run-1",
              kind: "assistant",
              title: null,
              text: "done",
              payload: { ok: true },
              createdAt: "2026-01-01T00:00:02.000Z",
            },
          },
        }),
      ),
    );

    expect(withEntry.threads[0]?.subagentRuns).toEqual([
      {
        id: "run-1",
        threadId: "thread-1",
        turnId: "turn-1",
        parentItemId: "item-1",
        provider: "codex",
        description: null,
        prompt: "inspect",
        agentType: "explorer",
        model: "gpt-5-codex",
        reasoningEffort: null,
        config: { depth: 1 },
        status: "running",
        startedAt: "2026-01-01T00:00:01.000Z",
        completedAt: null,
        updatedAt: "2026-01-01T00:00:01.000Z",
        entries: [
          {
            id: "entry-1",
            runId: "run-1",
            kind: "assistant",
            title: null,
            text: "done",
            payload: { ok: true },
            createdAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      },
    ]);
  });

  it("caps projected subagent runs at the latest 300 in deterministic order", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-run-cap";
    const events: OrchestrationEvent[] = [
      makeThreadCreatedEvent({ sequence: 1, threadId, occurredAt: now }),
    ];

    for (let index = 0; index < 301; index += 1) {
      const runId = `run-${String(index).padStart(3, "0")}`;
      const startedAt = new Date(
        Date.parse("2026-01-01T00:00:01.000Z") + index * 1_000,
      ).toISOString();
      events.push(
        makeEvent({
          sequence: index + 2,
          type: "thread.subagent-run-upserted",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: startedAt,
          commandId: `cmd-${runId}`,
          payload: {
            threadId,
            run: makeSubagentRun({
              id: runId,
              threadId,
              turnId: `turn-${index}`,
              startedAt,
            }),
          },
        }),
      );
    }

    const finalState = await projectEvents(createEmptyReadModel(now), events);
    const runIds = finalState.threads[0]?.subagentRuns.map((run) => run.id);

    expect(runIds).toHaveLength(300);
    expect(runIds?.[0]).toBe("run-001");
    expect(runIds?.at(-1)).toBe("run-300");
  });

  it("caps projected subagent entries at the latest 500 and upserts by entry id", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-entry-cap";
    const runId = "run-entry-cap";
    const events: OrchestrationEvent[] = [
      makeThreadCreatedEvent({ sequence: 1, threadId, occurredAt: now }),
      makeEvent({
        sequence: 2,
        type: "thread.subagent-run-upserted",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:00:01.000Z",
        commandId: "cmd-run-entry-cap",
        payload: {
          threadId,
          run: makeSubagentRun({
            id: runId,
            threadId,
            turnId: "turn-entry-cap",
            startedAt: "2026-01-01T00:00:01.000Z",
          }),
        },
      }),
    ];

    for (let index = 0; index < 501; index += 1) {
      const entryId = `entry-${String(index).padStart(3, "0")}`;
      const createdAt = new Date(
        Date.parse("2026-01-01T00:00:02.000Z") + index * 1_000,
      ).toISOString();
      events.push(
        makeEvent({
          sequence: index + 3,
          type: "thread.subagent-entry-appended",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: createdAt,
          commandId: `cmd-${entryId}`,
          payload: {
            threadId,
            runId,
            entry: {
              id: entryId,
              runId,
              kind: "assistant",
              title: null,
              text: entryId,
              payload: { index },
              createdAt,
            },
          },
        }),
      );
    }

    events.push(
      makeEvent({
        sequence: 504,
        type: "thread.subagent-entry-appended",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:10:00.000Z",
        commandId: "cmd-entry-250-updated",
        payload: {
          threadId,
          runId,
          entry: {
            id: "entry-250",
            runId,
            kind: "assistant",
            title: "Updated",
            text: "updated text",
            payload: { updated: true },
            createdAt: "2026-01-01T00:10:00.000Z",
          },
        },
      }),
    );

    const finalState = await projectEvents(createEmptyReadModel(now), events);
    const entries = finalState.threads[0]?.subagentRuns[0]?.entries ?? [];

    expect(entries).toHaveLength(500);
    expect(entries[0]?.id).toBe("entry-001");
    expect(entries.at(-1)).toEqual(
      expect.objectContaining({
        id: "entry-250",
        text: "updated text",
        payload: { updated: true },
      }),
    );
    expect(entries.filter((entry) => entry.id === "entry-250")).toHaveLength(1);
  });

  it("retains only subagent runs for retained turns after revert", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = "thread-revert-subagents";
    const events: OrchestrationEvent[] = [
      makeThreadCreatedEvent({ sequence: 1, threadId, occurredAt: now }),
    ];

    for (let turn = 1; turn <= 3; turn += 1) {
      events.push(
        makeEvent({
          sequence: turn + 1,
          type: "thread.turn-diff-completed",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: `2026-01-01T00:00:0${turn}.000Z`,
          commandId: `cmd-checkpoint-${turn}`,
          payload: {
            threadId,
            turnId: `turn-${turn}`,
            checkpointTurnCount: turn,
            checkpointRef: `refs/t3/checkpoints/${threadId}/turn/${turn}`,
            status: "ready",
            files: [],
            assistantMessageId: `assistant-${turn}`,
            completedAt: `2026-01-01T00:00:0${turn}.000Z`,
          },
        }),
        makeEvent({
          sequence: turn + 10,
          type: "thread.subagent-run-upserted",
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt: `2026-01-01T00:01:0${turn}.000Z`,
          commandId: `cmd-run-${turn}`,
          payload: {
            threadId,
            run: makeSubagentRun({
              id: `run-${turn}`,
              threadId,
              turnId: `turn-${turn}`,
              startedAt: `2026-01-01T00:01:0${turn}.000Z`,
            }),
          },
        }),
      );
    }

    events.push(
      makeEvent({
        sequence: 20,
        type: "thread.reverted",
        aggregateKind: "thread",
        aggregateId: threadId,
        occurredAt: "2026-01-01T00:02:00.000Z",
        commandId: "cmd-revert",
        payload: {
          threadId,
          turnCount: 2,
          revertedAt: "2026-01-01T00:02:00.000Z",
        },
      }),
    );

    const finalState = await projectEvents(createEmptyReadModel(now), events);

    expect(finalState.threads[0]?.subagentRuns.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(finalState.threads[0]?.checkpoints.map((checkpoint) => checkpoint.turnId)).toEqual([
      "turn-1",
      "turn-2",
    ]);
  });

  it("fails when event payload cannot be decoded by runtime schema", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    await expect(
      Effect.runPromise(
        projectEvent(
          model,
          makeEvent({
            sequence: 1,
            type: "thread.created",
            aggregateKind: "thread",
            aggregateId: "thread-1",
            occurredAt: now,
            commandId: "cmd-invalid",
            payload: {
              // missing required threadId
              projectId: "project-1",
              title: "demo",
              modelSelection: {
                provider: ProviderDriverKind.make("codex"),
                model: "gpt-5-codex",
              },
              branch: null,
              worktreePath: null,
              createdAt: now,
              updatedAt: now,
            },
          }),
        ),
      ),
    ).rejects.toBeDefined();
  });

  it("treats legacy missing checkpoint replay as pending work without interrupting the turn", async () => {
    const createdAt = "2026-02-25T10:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-legacy-missing",
        occurredAt: createdAt,
        commandId: "cmd-create-thread",
        payload: {
          threadId: "thread-legacy-missing",
          projectId: "project-1",
          title: "demo",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-legacy-missing",
        occurredAt: "2026-02-25T10:00:01.000Z",
        commandId: "cmd-session-running",
        payload: {
          threadId: "thread-legacy-missing",
          session: {
            threadId: "thread-legacy-missing",
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: "turn-legacy",
            lastError: null,
            updatedAt: "2026-02-25T10:00:01.000Z",
          },
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-legacy-missing",
        occurredAt: "2026-02-25T10:00:02.000Z",
        commandId: "cmd-assistant-complete",
        payload: {
          threadId: "thread-legacy-missing",
          messageId: "assistant-legacy",
          role: "assistant",
          text: "done",
          turnId: "turn-legacy",
          streaming: false,
          createdAt: "2026-02-25T10:00:02.000Z",
          updatedAt: "2026-02-25T10:00:02.000Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-legacy-missing",
        occurredAt: "2026-02-25T10:00:03.000Z",
        commandId: "cmd-legacy-missing",
        payload: {
          threadId: "thread-legacy-missing",
          turnId: "turn-legacy",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-legacy-missing/turn/1",
          status: "missing",
          files: [],
          assistantMessageId: "assistant-legacy",
          completedAt: "2026-02-25T10:00:03.000Z",
        },
      }),
    ];

    const finalState = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(model),
    );

    const thread = finalState.threads.find((entry) => entry.id === "thread-legacy-missing");
    expect(thread?.latestTurn?.state).toBe("running");
    expect(thread?.checkpoints).toHaveLength(0);
    expect(thread?.pendingCheckpointCaptures).toEqual([
      {
        turnId: "turn-legacy",
        checkpointTurnCount: 1,
        assistantMessageId: "assistant-legacy",
        requestedAt: "2026-02-25T10:00:03.000Z",
      },
    ]);
  });

  it("preserves terminal latest turn state when later checkpoint data arrives after a session error", async () => {
    const createdAt = "2026-02-25T11:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-preserve-turn-state",
        occurredAt: createdAt,
        commandId: "cmd-create-thread",
        payload: {
          threadId: "thread-preserve-turn-state",
          projectId: "project-1",
          title: "demo",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-preserve-turn-state",
        occurredAt: "2026-02-25T11:00:01.000Z",
        commandId: "cmd-session-running",
        payload: {
          threadId: "thread-preserve-turn-state",
          session: {
            threadId: "thread-preserve-turn-state",
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: "turn-1",
            lastError: null,
            updatedAt: "2026-02-25T11:00:01.000Z",
          },
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-preserve-turn-state",
        occurredAt: "2026-02-25T11:00:02.000Z",
        commandId: "cmd-session-error",
        payload: {
          threadId: "thread-preserve-turn-state",
          session: {
            threadId: "thread-preserve-turn-state",
            status: "error",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: "provider exploded",
            updatedAt: "2026-02-25T11:00:02.000Z",
          },
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-preserve-turn-state",
        occurredAt: "2026-02-25T11:00:03.000Z",
        commandId: "cmd-checkpoint-ready",
        payload: {
          threadId: "thread-preserve-turn-state",
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-preserve-turn-state/turn/1",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-1",
          completedAt: "2026-02-25T11:00:03.000Z",
        },
      }),
    ];

    const finalState = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(model),
    );

    const thread = finalState.threads.find((entry) => entry.id === "thread-preserve-turn-state");
    expect(thread?.latestTurn?.state).toBe("error");
    expect(thread?.latestTurn?.turnId).toBe("turn-1");
    expect(thread?.checkpoints).toHaveLength(1);
    expect(thread?.checkpoints[0]?.checkpointTurnCount).toBe(1);
  });

  it("applies authoritative settled turns from thread.session-set without mutating unrelated session-only updates", async () => {
    const createdAt = "2026-02-25T11:30:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-settled-turn",
        occurredAt: createdAt,
        commandId: "cmd-create-thread",
        payload: {
          threadId: "thread-settled-turn",
          projectId: "project-1",
          title: "demo",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-settled-turn",
        occurredAt: "2026-02-25T11:30:01.000Z",
        commandId: "cmd-session-running",
        payload: {
          threadId: "thread-settled-turn",
          session: {
            threadId: "thread-settled-turn",
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: "turn-1",
            lastError: null,
            updatedAt: "2026-02-25T11:30:01.000Z",
          },
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-settled-turn",
        occurredAt: "2026-02-25T11:30:02.000Z",
        commandId: "cmd-assistant-complete",
        payload: {
          threadId: "thread-settled-turn",
          messageId: "assistant-1",
          role: "assistant",
          text: "done",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-02-25T11:30:02.000Z",
          updatedAt: "2026-02-25T11:30:02.000Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-settled-turn",
        occurredAt: "2026-02-25T11:30:03.000Z",
        commandId: "cmd-session-ready-settled",
        payload: {
          threadId: "thread-settled-turn",
          session: {
            threadId: "thread-settled-turn",
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-02-25T11:30:03.000Z",
          },
          settledTurn: {
            turnId: "turn-1",
            state: "completed",
            completedAt: "2026-02-25T11:30:03.000Z",
          },
        },
      }),
    ];

    const finalState = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(model),
    );

    const thread = finalState.threads.find((entry) => entry.id === "thread-settled-turn");
    expect(thread?.latestTurn).toEqual(
      expect.objectContaining({
        turnId: "turn-1",
        state: "completed",
        assistantMessageId: "assistant-1",
        terminalSource: "turn_completed",
      }),
    );
  });

  it("settles the latest turn when thread.session-set ends a running session without an explicit settledTurn", async () => {
    const createdAt = "2026-02-25T11:30:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 1,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-session-error",
        occurredAt: createdAt,
        commandId: "cmd-create-thread-error",
        payload: {
          threadId: "thread-session-error",
          projectId: "project-1",
          title: "demo",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
          },
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-session-error",
        occurredAt: "2026-02-25T11:30:01.000Z",
        commandId: "cmd-session-running-error",
        payload: {
          threadId: "thread-session-error",
          session: {
            threadId: "thread-session-error",
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: "turn-1",
            lastError: null,
            updatedAt: "2026-02-25T11:30:01.000Z",
          },
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.session-set",
        aggregateKind: "thread",
        aggregateId: "thread-session-error",
        occurredAt: "2026-02-25T11:30:04.000Z",
        commandId: "cmd-session-error",
        payload: {
          threadId: "thread-session-error",
          session: {
            threadId: "thread-session-error",
            status: "error",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: "provider process exited unexpectedly",
            updatedAt: "2026-02-25T11:30:04.000Z",
          },
        },
      }),
    ];

    const finalState = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(model),
    );

    const thread = finalState.threads.find((entry) => entry.id === "thread-session-error");
    expect(thread?.session?.status).toBe("error");
    expect(thread?.latestTurn).toEqual(
      expect.objectContaining({
        turnId: "turn-1",
        state: "error",
        completedAt: "2026-02-25T11:30:04.000Z",
      }),
    );
  });

  it("applies thread.archived and thread.unarchived events", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const later = "2026-01-01T00:00:01.000Z";
    const created = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(now),
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: now,
          commandId: "cmd-thread-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ),
    );

    const archived = await Effect.runPromise(
      projectEvent(
        created,
        makeEvent({
          sequence: 2,
          type: "thread.archived",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: later,
          commandId: "cmd-thread-archive",
          payload: {
            threadId: "thread-1",
            archivedAt: later,
            updatedAt: later,
          },
        }),
      ),
    );
    expect(archived.threads[0]?.archivedAt).toBe(later);

    const unarchived = await Effect.runPromise(
      projectEvent(
        archived,
        makeEvent({
          sequence: 3,
          type: "thread.unarchived",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: later,
          commandId: "cmd-thread-unarchive",
          payload: {
            threadId: "thread-1",
            updatedAt: later,
          },
        }),
      ),
    );
    expect(unarchived.threads[0]?.archivedAt).toBeNull();
  });

  it("keeps projector forward-compatible for unhandled event types", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const model = createEmptyReadModel(now);

    const next = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 7,
          type: "thread.turn-start-requested",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: "2026-01-01T00:00:00.000Z",
          commandId: "cmd-unhandled",
          payload: {
            threadId: "thread-1",
            messageId: "message-1",
            runtimeMode: "approval-required",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ),
    );

    expect(next.snapshotSequence).toBe(7);
    expect(next.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(next.threads).toEqual([]);
  });

  it("projects swarm runs and task executions into the read model", async () => {
    const requestedAt = "2026-04-06T00:00:00.000Z";
    const startedAt = "2026-04-06T00:00:01.000Z";
    const completedAt = "2026-04-06T00:00:02.000Z";

    const afterRequested = await Effect.runPromise(
      projectEvent(
        createEmptyReadModel(requestedAt),
        makeEvent({
          sequence: 1,
          type: "epic-run.requested",
          aggregateKind: "epicRun",
          aggregateId: "run-1",
          occurredAt: requestedAt,
          commandId: "cmd-swarm-requested",
          payload: {
            runId: "run-1",
            projectId: "project-1",
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
        }),
      ),
    );

    const afterExecutionRequested = await Effect.runPromise(
      projectEvent(
        afterRequested,
        makeEvent({
          sequence: 2,
          type: "epic-issue-execution.requested",
          aggregateKind: "epicIssueExecution",
          aggregateId: "execution-1",
          occurredAt: requestedAt,
          commandId: "cmd-execution-requested",
          payload: {
            executionId: "execution-1",
            runId: "run-1",
            issueId: "TASK-1",
            workerThreadId: "thread-1",
            sequenceNumber: 1,
            requestedAt,
            updatedAt: requestedAt,
          },
        }),
      ),
    );

    const afterStarted = await Effect.runPromise(
      projectEvent(
        afterExecutionRequested,
        makeEvent({
          sequence: 3,
          type: "epic-issue-execution.started",
          aggregateKind: "epicIssueExecution",
          aggregateId: "execution-1",
          occurredAt: startedAt,
          commandId: "cmd-execution-started",
          payload: {
            executionId: "execution-1",
            runId: "run-1",
            startedAt,
            updatedAt: startedAt,
          },
        }),
      ),
    );

    const afterCompleted = await Effect.runPromise(
      projectEvent(
        afterStarted,
        makeEvent({
          sequence: 4,
          type: "epic-issue-execution.completed",
          aggregateKind: "epicIssueExecution",
          aggregateId: "execution-1",
          occurredAt: completedAt,
          commandId: "cmd-execution-completed",
          payload: {
            executionId: "execution-1",
            runId: "run-1",
            completedAt,
            updatedAt: completedAt,
          },
        }),
      ),
    );

    expect(afterCompleted.epicRuns).toEqual([
      {
        runId: "run-1",
        projectId: "project-1",
        epicIssueId: "EPIC-1",
        status: "pending",
        provider: "codex",
        model: "gpt-5.4",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "streaming",
        runtimeMode: "full-access",
        failureContext: null,
        requestedAt,
        startedAt: null,
        stopRequestedAt: null,
        stoppedAt: null,
        failedAt: null,
        completedAt: null,
        updatedAt: completedAt,
      },
    ]);
    expect(afterCompleted.epicIssueExecutions).toEqual([
      {
        executionId: "execution-1",
        runId: "run-1",
        issueId: "TASK-1",
        workerThreadId: "thread-1",
        sequenceNumber: 1,
        status: "completed",
        workspaceKey: "shared",
        workspacePath: null,
        failureContext: null,
        requestedAt,
        startedAt,
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt,
        failedAt: null,
        updatedAt: completedAt,
      },
    ]);
  });

  it("tracks latest turn id from session lifecycle events", async () => {
    const createdAt = "2026-02-23T08:00:00.000Z";
    const startedAt = "2026-02-23T08:00:05.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const afterRunning = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "thread.session-set",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: startedAt,
          commandId: "cmd-running",
          payload: {
            threadId: "thread-1",
            session: {
              threadId: "thread-1",
              status: "running",
              providerName: "codex",
              providerSessionId: "session-1",
              providerThreadId: "provider-thread-1",
              runtimeMode: "approval-required",
              activeTurnId: "turn-1",
              lastError: null,
              updatedAt: startedAt,
            },
          },
        }),
      ),
    );

    const thread = afterRunning.threads[0];
    expect(thread?.latestTurn?.turnId).toBe("turn-1");
    expect(thread?.session?.status).toBe("running");
  });

  it("updates canonical thread runtime mode from thread.runtime-mode-set", async () => {
    const createdAt = "2026-02-23T08:00:00.000Z";
    const updatedAt = "2026-02-23T08:00:05.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const afterUpdate = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "thread.runtime-mode-set",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: updatedAt,
          commandId: "cmd-runtime-mode-set",
          payload: {
            threadId: "thread-1",
            runtimeMode: "approval-required",
            updatedAt,
          },
        }),
      ),
    );

    expect(afterUpdate.threads[0]?.runtimeMode).toBe("approval-required");
    expect(afterUpdate.threads[0]?.updatedAt).toBe(updatedAt);
  });

  it("marks assistant messages completed with non-streaming updates", async () => {
    const createdAt = "2026-02-23T09:00:00.000Z";
    const deltaAt = "2026-02-23T09:00:01.000Z";
    const completeAt = "2026-02-23T09:00:03.500Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const afterDelta = await Effect.runPromise(
      projectEvent(
        afterCreate,
        makeEvent({
          sequence: 2,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: deltaAt,
          commandId: "cmd-delta",
          payload: {
            threadId: "thread-1",
            messageId: "assistant:msg-1",
            role: "assistant",
            text: "hello",
            turnId: "turn-1",
            streaming: true,
            createdAt: deltaAt,
            updatedAt: deltaAt,
          },
        }),
      ),
    );

    const afterComplete = await Effect.runPromise(
      projectEvent(
        afterDelta,
        makeEvent({
          sequence: 3,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: completeAt,
          commandId: "cmd-complete",
          payload: {
            threadId: "thread-1",
            messageId: "assistant:msg-1",
            role: "assistant",
            text: "",
            turnId: "turn-1",
            streaming: false,
            createdAt: completeAt,
            updatedAt: completeAt,
          },
        }),
      ),
    );

    const message = afterComplete.threads[0]?.messages[0];
    expect(message?.id).toBe("assistant:msg-1");
    expect(message?.text).toBe("hello");
    expect(message?.streaming).toBe(false);
    expect(message?.updatedAt).toBe(completeAt);
    expect(afterComplete.threads[0]?.latestTurn?.state).toBe("running");
  });

  it("prunes reverted turn messages from in-memory thread snapshot", async () => {
    const createdAt = "2026-02-23T10:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-1",
          occurredAt: createdAt,
          commandId: "cmd-create",
          payload: {
            threadId: "thread-1",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 2,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:01.000Z",
        commandId: "cmd-user-1",
        payload: {
          threadId: "thread-1",
          messageId: "user-msg-1",
          role: "user",
          text: "First edit",
          turnId: null,
          streaming: false,
          createdAt: "2026-02-23T10:00:01.000Z",
          updatedAt: "2026-02-23T10:00:01.000Z",
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.000Z",
        commandId: "cmd-assistant-1",
        payload: {
          threadId: "thread-1",
          messageId: "assistant-msg-1",
          role: "assistant",
          text: "Updated README to v2.\n",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-02-23T10:00:02.000Z",
          updatedAt: "2026-02-23T10:00:02.000Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.500Z",
        commandId: "cmd-turn-1-complete",
        payload: {
          threadId: "thread-1",
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-1/turn/1",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-msg-1",
          completedAt: "2026-02-23T10:00:02.500Z",
        },
      }),
      makeEvent({
        sequence: 5,
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:02.750Z",
        commandId: "cmd-activity-1",
        payload: {
          threadId: "thread-1",
          activity: {
            id: "activity-1",
            tone: "tool",
            kind: "tool.started",
            summary: "Edit file started",
            payload: { toolKind: "command" },
            turnId: "turn-1",
            createdAt: "2026-02-23T10:00:02.750Z",
          },
        },
      }),
      makeEvent({
        sequence: 6,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:03.000Z",
        commandId: "cmd-user-2",
        payload: {
          threadId: "thread-1",
          messageId: "user-msg-2",
          role: "user",
          text: "Second edit",
          turnId: null,
          streaming: false,
          createdAt: "2026-02-23T10:00:03.000Z",
          updatedAt: "2026-02-23T10:00:03.000Z",
        },
      }),
      makeEvent({
        sequence: 7,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.000Z",
        commandId: "cmd-assistant-2",
        payload: {
          threadId: "thread-1",
          messageId: "assistant-msg-2",
          role: "assistant",
          text: "Updated README to v3.\n",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-23T10:00:04.000Z",
          updatedAt: "2026-02-23T10:00:04.000Z",
        },
      }),
      makeEvent({
        sequence: 8,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.500Z",
        commandId: "cmd-turn-2-complete",
        payload: {
          threadId: "thread-1",
          turnId: "turn-2",
          checkpointTurnCount: 2,
          checkpointRef: "refs/t3/checkpoints/thread-1/turn/2",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-msg-2",
          completedAt: "2026-02-23T10:00:04.500Z",
        },
      }),
      makeEvent({
        sequence: 9,
        type: "thread.activity-appended",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:04.750Z",
        commandId: "cmd-activity-2",
        payload: {
          threadId: "thread-1",
          activity: {
            id: "activity-2",
            tone: "tool",
            kind: "tool.completed",
            summary: "Edit file complete",
            payload: { toolKind: "command" },
            turnId: "turn-2",
            createdAt: "2026-02-23T10:00:04.750Z",
          },
        },
      }),
      makeEvent({
        sequence: 10,
        type: "thread.reverted",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: "2026-02-23T10:00:05.000Z",
        commandId: "cmd-revert",
        payload: {
          threadId: "thread-1",
          turnCount: 1,
        },
      }),
    ];

    const afterRevert = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const thread = afterRevert.threads[0];
    expect(thread?.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual(
      [
        { role: "user", text: "First edit" },
        { role: "assistant", text: "Updated README to v2.\n" },
      ],
    );
    expect(
      thread?.activities.map((activity) => ({ id: activity.id, turnId: activity.turnId })),
    ).toEqual([{ id: "activity-1", turnId: "turn-1" }]);
    expect(thread?.checkpoints.map((checkpoint) => checkpoint.checkpointTurnCount)).toEqual([1]);
    expect(thread?.latestTurn?.turnId).toBe("turn-1");
  });

  it("does not fallback-retain messages tied to removed turn IDs", async () => {
    const createdAt = "2026-02-26T12:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-revert",
          occurredAt: createdAt,
          commandId: "cmd-create-revert",
          payload: {
            threadId: "thread-revert",
            projectId: "project-1",
            title: "demo",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5.3-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const events: ReadonlyArray<OrchestrationEvent> = [
      makeEvent({
        sequence: 2,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:01.000Z",
        commandId: "cmd-turn-1",
        payload: {
          threadId: "thread-revert",
          turnId: "turn-1",
          checkpointTurnCount: 1,
          checkpointRef: "refs/t3/checkpoints/thread-revert/turn/1",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-keep",
          completedAt: "2026-02-26T12:00:01.000Z",
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:01.100Z",
        commandId: "cmd-assistant-keep",
        payload: {
          threadId: "thread-revert",
          messageId: "assistant-keep",
          role: "assistant",
          text: "kept",
          turnId: "turn-1",
          streaming: false,
          createdAt: "2026-02-26T12:00:01.100Z",
          updatedAt: "2026-02-26T12:00:01.100Z",
        },
      }),
      makeEvent({
        sequence: 4,
        type: "thread.turn-diff-completed",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.000Z",
        commandId: "cmd-turn-2",
        payload: {
          threadId: "thread-revert",
          turnId: "turn-2",
          checkpointTurnCount: 2,
          checkpointRef: "refs/t3/checkpoints/thread-revert/turn/2",
          status: "ready",
          files: [],
          assistantMessageId: "assistant-remove",
          completedAt: "2026-02-26T12:00:02.000Z",
        },
      }),
      makeEvent({
        sequence: 5,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.050Z",
        commandId: "cmd-user-remove",
        payload: {
          threadId: "thread-revert",
          messageId: "user-remove",
          role: "user",
          text: "removed",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-26T12:00:02.050Z",
          updatedAt: "2026-02-26T12:00:02.050Z",
        },
      }),
      makeEvent({
        sequence: 6,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:02.100Z",
        commandId: "cmd-assistant-remove",
        payload: {
          threadId: "thread-revert",
          messageId: "assistant-remove",
          role: "assistant",
          text: "removed",
          turnId: "turn-2",
          streaming: false,
          createdAt: "2026-02-26T12:00:02.100Z",
          updatedAt: "2026-02-26T12:00:02.100Z",
        },
      }),
      makeEvent({
        sequence: 7,
        type: "thread.reverted",
        aggregateKind: "thread",
        aggregateId: "thread-revert",
        occurredAt: "2026-02-26T12:00:03.000Z",
        commandId: "cmd-revert",
        payload: {
          threadId: "thread-revert",
          turnCount: 1,
        },
      }),
    ];

    const afterRevert = await events.reduce<Promise<ReturnType<typeof createEmptyReadModel>>>(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const thread = afterRevert.threads[0];
    expect(
      thread?.messages.map((message) => ({
        id: message.id,
        role: message.role,
        turnId: message.turnId,
      })),
    ).toEqual([{ id: "assistant-keep", role: "assistant", turnId: "turn-1" }]);
  });

  it("caps message and checkpoint retention for long-lived threads", async () => {
    const createdAt = "2026-03-01T10:00:00.000Z";
    const model = createEmptyReadModel(createdAt);

    const afterCreate = await Effect.runPromise(
      projectEvent(
        model,
        makeEvent({
          sequence: 1,
          type: "thread.created",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: createdAt,
          commandId: "cmd-create-capped",
          payload: {
            threadId: "thread-capped",
            projectId: "project-1",
            title: "capped",
            modelSelection: {
              provider: ProviderDriverKind.make("codex"),
              model: "gpt-5-codex",
            },
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt,
            updatedAt: createdAt,
          },
        }),
      ),
    );

    const messageEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
      { length: 2_100 },
      (_, index) =>
        makeEvent({
          sequence: index + 2,
          type: "thread.message-sent",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
          commandId: `cmd-message-${index}`,
          payload: {
            threadId: "thread-capped",
            messageId: `msg-${index}`,
            role: "assistant",
            text: `message-${index}`,
            turnId: `turn-${index}`,
            streaming: false,
            createdAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
            updatedAt: `2026-03-01T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
          },
        }),
    );
    const afterMessages = await messageEvents.reduce<
      Promise<ReturnType<typeof createEmptyReadModel>>
    >(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterCreate),
    );

    const checkpointEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
      { length: 600 },
      (_, index) =>
        makeEvent({
          sequence: index + 2_102,
          type: "thread.turn-diff-completed",
          aggregateKind: "thread",
          aggregateId: "thread-capped",
          occurredAt: `2026-03-01T10:30:${String(index % 60).padStart(2, "0")}.000Z`,
          commandId: `cmd-checkpoint-${index}`,
          payload: {
            threadId: "thread-capped",
            turnId: `turn-${index}`,
            checkpointTurnCount: index + 1,
            checkpointRef: `refs/t3/checkpoints/thread-capped/turn/${index + 1}`,
            status: "ready",
            files: [],
            assistantMessageId: `msg-${index}`,
            completedAt: `2026-03-01T10:30:${String(index % 60).padStart(2, "0")}.000Z`,
          },
        }),
    );
    const finalState = await checkpointEvents.reduce<
      Promise<ReturnType<typeof createEmptyReadModel>>
    >(
      (statePromise, event) =>
        statePromise.then((state) => Effect.runPromise(projectEvent(state, event))),
      Promise.resolve(afterMessages),
    );

    const thread = finalState.threads[0];
    expect(thread?.messages).toHaveLength(2_000);
    expect(thread?.messages[0]?.id).toBe("msg-100");
    expect(thread?.messages.at(-1)?.id).toBe("msg-2099");
    expect(thread?.checkpoints).toHaveLength(500);
    expect(thread?.checkpoints[0]?.turnId).toBe("turn-100");
    expect(thread?.checkpoints.at(-1)?.turnId).toBe("turn-599");
  });
});
