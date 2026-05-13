// @ts-nocheck
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointRef,
  CommandId,
  MessageId,
  ProjectId,
  EpicIssueExecutionId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { EpicRunScheduler } from "../Services/EpicRunScheduler.ts";
import { buildEpicRunWorkerPrompt } from "../epicRunWorker.ts";
import {
  createEpicRunSchedulerHarness,
  type HarnessOptions,
  makeCompletedLatestTurn,
  makeErroredLatestTurn,
  makeErroredSession,
  makeIdleSession,
  makeInterruptedLatestTurn,
  makeReadySession,
  makeRunningLatestTurn,
  makeRunningSession,
  makeStoppedSession,
  makeTrackerState,
  now,
  relationIssue,
  type EpicRunSchedulerHarnessRuntime,
} from "./EpicRunScheduler.testHarness.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

function failureMessage(
  input: { failureContext: { message: string } | null } | null | undefined,
): string | null {
  return input?.failureContext?.message ?? null;
}

describe("EpicRunScheduler", () => {
  let harnessRuntime: EpicRunSchedulerHarnessRuntime | null = null;
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | EpicRunScheduler,
    unknown
  > | null = null;

  afterEach(async () => {
    if (harnessRuntime) {
      await harnessRuntime.dispose();
    }
    harnessRuntime = null;
    runtime = null;
  });

  async function createHarness(
    initialTrackerState = makeTrackerState(),
    options: HarnessOptions = {},
  ) {
    harnessRuntime = await createEpicRunSchedulerHarness(initialTrackerState, options);
    runtime = harnessRuntime.runtime;
    return harnessRuntime.harness;
  }

  it("starts an epic run and keeps duplicate starts on the same non-terminal run", async () => {
    const harness = await createHarness();

    const first = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const second = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe("running");

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const runsForEpic = snapshot.epicRuns.filter((run) => run.epicIssueId === "EPIC-1");
    expect(runsForEpic).toHaveLength(1);
    expect(runsForEpic[0]?.provider).toBe("codex");
    expect(runsForEpic[0]?.model).toBe("gpt-5-codex");
    expect(runsForEpic[0]?.modelOptions).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "fastMode", value: true },
    ]);
    expect(snapshot.epicIssueExecutions).toHaveLength(1);
    expect(snapshot.epicIssueExecutions[0]?.issueId).toBe("TASK-1");
    expect(snapshot.epicIssueExecutions[0]?.status).toBe("launching");
    expect(snapshot.epicIssueExecutions[0]?.startedAt).toBeNull();
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.title).toBe("TASK-1: Task 1 (Epic-run worker)");
    expect(snapshot.threads[0]?.issueLink?.issueId).toBe("TASK-1");
    expect(snapshot.threads[0]?.modelSelection.options).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "fastMode", value: true },
    ]);
    const workerTurnStart = harness
      .getDispatchedCommands()
      .find((command) => command.type === "thread.turn.start");
    expect(workerTurnStart?.modelSelection?.options).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "fastMode", value: true },
    ]);

    const issue = harness.getIssue("TASK-1");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("keeps explicit fast mode false on epic run worker selections", async () => {
    const harness = await createHarness();

    await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        modelOptions: [{ id: "fastMode", value: false }],
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns[0];
    const workerThread = snapshot.threads[0];
    const workerTurnStart = harness
      .getDispatchedCommands()
      .find((command) => command.type === "thread.turn.start");

    expect(run?.modelOptions).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "fastMode", value: false },
    ]);
    expect(workerThread?.modelSelection.options).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "fastMode", value: false },
    ]);
    expect(workerTurnStart?.modelSelection?.options).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "fastMode", value: false },
    ]);
  });

  it("rejects starting a new epic run when the project worktree is dirty", async () => {
    const harness = await createHarness(makeTrackerState(), {
      git: {
        changedFiles: ["apps/server/src/dirty.ts"],
      },
    });

    await expect(
      runtime!.runPromise(
        harness.workflow.startEpicRun({
          projectId: harness.projectId,
          epicIssueId: "EPIC-1",
          runtimeMode: "full-access",
        }),
      ),
    ).rejects.toThrow(
      "Cannot start epic run for EPIC-1 because /repo/project has uncommitted changes.",
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.epicRuns).toHaveLength(0);
    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("keeps requested execution pending before timeout when launch has been requested but not observed", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: null,
      session: null,
    });
    harness.patchExecution(execution.executionId, {
      requestedAt: new Date(Date.now() - Duration.toMillis(Duration.seconds(30))).toISOString(),
    });
    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const reconciledExecution = snapshot.epicIssueExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(reconciledExecution?.status).toBe("launching");
    expect(reconciledExecution?.startedAt).toBeNull();
    expect(snapshot.epicIssueExecutions).toHaveLength(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  });

  it("wakes the scheduler when a worker thread reports a state change", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const initialSnapshot = await harness.getSnapshot();
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      throw new Error("Expected a worker thread for the requested execution.");
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-failed"),
      session: makeErroredSession(execution.workerThreadId, "Provider worker crashed."),
    });

    await runtime!.runPromise(harness.workflow.notifyWorkerStateChanged(execution.workerThreadId));

    await expect
      .poll(
        async () => {
          await harness.drainScheduler();
          const nextSnapshot = await harness.getSnapshot();
          return nextSnapshot.epicRuns.find((entry) => entry.runId === started.runId)?.status;
        },
        { timeout: 500, interval: 20 },
      )
      .toBe("failed");

    const snapshot = await harness.getSnapshot();
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const settledExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain("Provider worker crashed.");
    expect(settledExecution?.status).toBe("failed");
    expect(failureMessage(settledExecution)).toContain("Provider worker crashed.");
  });

  it("ignores worker state change wakeups for unrelated threads", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const unrelatedThreadId = ThreadId.makeUnsafe("thread-unrelated");
    await runtime!.runPromise(harness.workflow.notifyWorkerStateChanged(unrelatedThreadId));
    await harness.drainScheduler();

    const snapshot = await harness.getSnapshot();
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const execution = snapshot.epicIssueExecutions[0];

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(execution?.status).toBe("launching");
    expect(execution?.failureContext).toBeNull();
  });

  it("deterministically keeps one admitted epic run and fails the loser when another starts", async () => {
    const harness = await createHarness();

    const first = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    const second = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-2",
        runtimeMode: "full-access",
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const firstRun = snapshot.epicRuns.find((entry) => entry.runId === first.runId);
    const secondRun = snapshot.epicRuns.find((entry) => entry.runId === second.runId);

    expect(firstRun?.status).toBe("running");
    expect(secondRun?.status).toBe("failed");
    expect(failureMessage(secondRun)).toContain(`Run '${first.runId}'`);
    expect(failureMessage(secondRun)).toContain(`Run '${second.runId}'`);
  });

  it("allows admitted epic runs from different projects even when epic ids match", async () => {
    const harness = await createHarness();
    const secondProjectId = asProjectId("project-2");

    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-2"),
        projectId: secondProjectId,
        title: "Project 2",
        workspaceRoot: "/repo/project-2",
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt: now,
      }),
    );

    const first = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    const second = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: secondProjectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    expect(second.runId).not.toBe(first.runId);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.epicRuns).toHaveLength(2);
    expect(snapshot.epicRuns.find((entry) => entry.runId === first.runId)?.projectId).toBe(
      harness.projectId,
    );
    expect(snapshot.epicRuns.find((entry) => entry.runId === second.runId)?.projectId).toBe(
      secondProjectId,
    );
  });

  it("starts a run without requiring any persisted coordination artifact", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          summary: null,
        },
        status: {
          ...baseline.status,
          summary: null,
        },
      }),
    );

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    expect(started.status).toBe("running");

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.epicRuns).toHaveLength(1);
    expect(snapshot.epicRuns[0]?.epicIssueId).toBe("EPIC-1");
  });

  it("rejects starting a run when coordination validation fails", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          valid: false,
          errors: ["Swarm graph is invalid."],
        },
      }),
    );

    await expect(
      runtime!.runPromise(
        harness.workflow.startEpicRun({
          projectId: harness.projectId,
          epicIssueId: "EPIC-1",
          runtimeMode: "full-access",
        }),
      ),
    ).rejects.toThrow("Cannot start epic run for EPIC-1: Swarm graph is invalid.");
  });

  it("keeps a running epic run active when no ready issue remains and blocked work exists", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-9", 2)],
        },
      }),
    );

    const result = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === result.runId);
    expect(run?.status).toBe("running");
  });

  it("starts execution from live ready status when validation exposes extra candidates", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-1", 1), relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2)],
        },
      }),
    );

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = snapshot.epicIssueExecutions[0];
    const firstIssue = harness.getIssue("TASK-1");
    const secondIssue = harness.getIssue("TASK-2");

    expect(started.status).toBe("running");
    expect(execution?.issueId).toBe("TASK-2");
    expect(firstIssue?.status).toBe("open");
    expect(firstIssue?.assignee).toBeNull();
    expect(secondIssue?.status).toBe("open");
    expect(secondIssue?.assignee).toBeNull();
  });

  it("keeps the run running when tracker completion is not proven", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness();
    harness.setTrackerStateSequence([
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-1", 1)]],
        },
        status: {
          ...baseline.status,
          ready: [],
        },
      }),
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          active: [],
          blocked: [],
        },
      }),
    ]);

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
    expect(run?.status).toBe("running");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  });

  it("blocks instead of dispatching when ready issue disappears and active or blocked work remains", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness();
    harness.setTrackerStateSequence([
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-1", 1)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-1", 1)],
        },
      }),
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-9", 2)],
        },
      }),
    ]);

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
    expect(run?.status).toBe("running");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  });

  it("keeps duplicate starts from spawning another execution while one is already active", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const repeatedStart = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(repeatedStart.runId).toBe(started.runId);
    expect(repeatedStart.status).toBe("running");
    expect(snapshot.epicIssueExecutions).toHaveLength(1);
  });

  it("fails completed worker turns with issue_incomplete when the issue was not closed", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-worker-completed"),
      session: makeReadySession(execution.workerThreadId),
    });

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain("issue 'TASK-1' is still 'open'");
    expect(failureMessage(run)).toContain("must close their assigned Beads issue");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "issue_incomplete",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
    expect(failedExecution?.status).toBe("failed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("issue 'TASK-1' is still 'open'");
  });

  it("idles semi-automatic runs after a completed task when ready work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2)],
        },
      }),
    );
    harness.patchIssue("TASK-1", {
      status: "closed",
    });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-1"),
      session: makeReadySession(execution.workerThreadId),
    });

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(completedExecution?.status).toBe("completed");
    expect(issue?.status).toBe("closed");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker completed.");
  });

  it("does not treat pending checkpoint capture state as a worker interruption", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2)],
        },
      }),
    );
    harness.patchIssue("TASK-1", { status: "closed" });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-worker-completed"),
      session: makeReadySession(execution.workerThreadId),
    });
    harness.patchReadModel((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === execution.workerThreadId
          ? {
              ...thread,
              pendingCheckpointCaptures: [
                {
                  turnId: TurnId.makeUnsafe("turn-worker-completed"),
                  checkpointTurnCount: 1,
                  assistantMessageId: null,
                  requestedAt: now,
                },
              ],
            }
          : thread,
      ),
    }));

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
  });

  it("ignores legacy missing checkpoint placeholders when worker lifecycle is otherwise completed", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2)],
        },
      }),
    );
    harness.patchIssue("TASK-1", { status: "closed" });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-worker-completed"),
      session: makeReadySession(execution.workerThreadId),
    });
    harness.patchReadModel((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === execution.workerThreadId
          ? {
              ...thread,
              checkpoints: [
                {
                  turnId: TurnId.makeUnsafe("turn-worker-completed"),
                  checkpointTurnCount: 1,
                  checkpointRef: CheckpointRef.makeUnsafe(
                    "refs/t3/checkpoints/thread-worker/turn/1",
                  ),
                  status: "missing",
                  files: [],
                  assistantMessageId: null,
                  completedAt: now,
                },
                {
                  turnId: TurnId.makeUnsafe("turn-worker-completed"),
                  checkpointTurnCount: 1,
                  checkpointRef: CheckpointRef.makeUnsafe(
                    "refs/t3/checkpoints/thread-worker/turn/1",
                  ),
                  status: "ready",
                  files: [],
                  assistantMessageId: null,
                  completedAt: now,
                },
              ],
            }
          : thread,
      ),
    }));

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
  });

  it("automatically launches the next worker thread after a completed task when ready work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.epicIssueExecutions[0];
    expect(initialExecution?.workerThreadId).toBeTruthy();
    if (!initialExecution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          completed: [relationIssue("TASK-1", 1)],
          ready: [relationIssue("TASK-2", 2)],
          active: [],
          blocked: [],
        },
      }),
    );
    harness.patchIssue("TASK-1", {
      status: "closed",
    });
    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-1"),
      session: makeReadySession(initialExecution.workerThreadId),
    });

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === initialExecution.executionId,
    );
    const nextExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId !== initialExecution.executionId,
    );
    const nextThread =
      nextExecution?.workerThreadId === null || nextExecution?.workerThreadId === undefined
        ? null
        : (snapshot.threads.find((thread) => thread.id === nextExecution.workerThreadId) ?? null);
    const initialIssue = harness.getIssue("TASK-1");
    const nextIssue = harness.getIssue("TASK-2");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
    expect(nextExecution?.status).toBe("launching");
    expect(nextExecution?.issueId).toBe("TASK-2");
    expect(nextExecution?.workerThreadId).toBeTruthy();
    expect(snapshot.epicIssueExecutions).toHaveLength(2);
    expect(snapshot.threads).toHaveLength(2);
    expect(nextThread?.title).toBe("TASK-2: Task 2 (Epic-run worker)");
    expect(nextThread?.issueLink?.issueId).toBe("TASK-2");
    expect(initialIssue?.status).toBe("closed");
    expect(initialIssue?.assignee).toBeNull();
    expect(initialIssue?.comments.at(-1)?.text).toContain("Epic-run worker completed.");
    expect(nextIssue?.status).toBe("open");
    expect(nextIssue?.assignee).toBeNull();
    expect(nextIssue?.comments).toHaveLength(0);
  });

  it("commits dirty shared-worktree changes before completing a closed worker issue", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.epicIssueExecutions[0];
    expect(initialExecution?.workerThreadId).toBeTruthy();
    if (!initialExecution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          completed: [relationIssue("TASK-1", 1)],
          ready: [relationIssue("TASK-2", 2)],
          active: [],
          blocked: [],
        },
      }),
    );
    harness.setGitChangedFiles(["apps/server/src/worker-change.ts"]);
    harness.patchIssue("TASK-1", { status: "closed" });
    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-commit-worker"),
      session: makeReadySession(initialExecution.workerThreadId),
    });

    await runtime!.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* harness.workflow.start;
          yield* harness.workflow.drain;
        }),
      ),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === initialExecution.executionId,
    );
    const nextExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId !== initialExecution.executionId,
    );
    const commitCalls = harness.getGitCommitCalls();

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
    expect(nextExecution?.issueId).toBe("TASK-2");
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]?.action).toBe("commit");
    expect(commitCalls[0]?.commitMessage).toContain(
      "chore(epic-run): persist TASK-1 worker changes",
    );
    expect(commitCalls[0]?.commitMessage).toContain(`Run: ${started.runId}`);
  });

  it("skips settlement commits when the closed worker leaves a clean worktree", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          summary: {
            ...baseline.validation.summary!,
            totalIssueCount: 1,
            completedIssueCount: 1,
            readyIssueCount: 0,
            activeIssueCount: 0,
            blockedIssueCount: 0,
          },
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          summary: {
            ...baseline.status.summary!,
            totalIssueCount: 1,
            completedIssueCount: 1,
            readyIssueCount: 0,
            activeIssueCount: 0,
            blockedIssueCount: 0,
          },
          ready: [],
          completed: [relationIssue("TASK-1", 1)],
        },
      }),
    );
    harness.patchIssue("TASK-1", { status: "closed" });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-clean-worker"),
      session: makeReadySession(execution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const completed = snapshot.epicRuns.find((entry) => entry.runId === started.runId);

    expect(completed?.status).toBe("completed");
    expect(harness.getGitCommitCalls()).toHaveLength(0);
  });

  it("fails the run and reopens the closed issue when settlement commit fails", async () => {
    const harness = await createHarness(makeTrackerState(), {
      git: {
        failCommitWith: "pre-commit hook rejected worker changes",
      },
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          completed: [relationIssue("TASK-1", 1)],
          ready: [relationIssue("TASK-2", 2)],
        },
      }),
    );
    harness.setGitChangedFiles(["apps/server/src/failing-change.ts"]);
    harness.patchIssue("TASK-1", { status: "closed" });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-failing-commit"),
      session: makeReadySession(execution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const nextExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId !== execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain("pre-commit hook rejected worker changes");
    expect(failedExecution?.status).toBe("failed");
    expect(nextExecution).toBeUndefined();
    expect(issue?.status).toBe("open");
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("pre-commit hook rejected worker changes");
  });

  it("fails the run when the worktree becomes dirty before launching the next worker", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-2", 2)],
        },
      }),
    );

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2)],
          active: [],
          blocked: [],
        },
      }),
    );
    harness.setGitChangedFiles(["apps/server/src/prelaunch-dirty.ts"]);

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain(
      "Cannot continue epic run for EPIC-1 because /repo/project has uncommitted changes.",
    );
    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("completes automatic runs when the last task finishes and no work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          summary: {
            ...baseline.validation.summary!,
            totalIssueCount: 1,
            completedIssueCount: 1,
            readyIssueCount: 0,
            activeIssueCount: 0,
            blockedIssueCount: 0,
          },
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          summary: {
            ...baseline.status.summary!,
            totalIssueCount: 1,
            completedIssueCount: 1,
            readyIssueCount: 0,
            activeIssueCount: 0,
            blockedIssueCount: 0,
          },
          ready: [],
          completed: [relationIssue("TASK-1", 1)],
        },
      }),
    );
    harness.patchIssue("TASK-1", {
      status: "closed",
    });
    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeCompletedLatestTurn("turn-2"),
      session: makeReadySession(execution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const completed = snapshot.epicRuns.find((entry) => entry.runId === started.runId);

    expect(completed?.status).toBe("completed");
  });

  it("reconciles failed worker threads on startup", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toBe("Worker crashed");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "worker_failure",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
    expect(failedExecution?.status).toBe("failed");
    expect(failureMessage(failedExecution)).toBe("Worker crashed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("Worker crashed");
  });

  it("keeps active coordination executions running when the worker turn is still active", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeRunningLatestTurn("turn-worker-running"),
      session: makeErroredSession(
        execution.workerThreadId,
        "Transient runtime error while retrying worker stream",
        "turn-worker-running",
      ),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const activeExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(failureMessage(run)).toBeNull();
    expect(activeExecution?.status).toBe("running");
    expect(failureMessage(activeExecution)).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("does not fail an active execution from graceful session exit without authoritative turn settlement", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeRunningLatestTurn("turn-worker-running"),
      session: {
        ...makeStoppedSession(execution.workerThreadId),
        status: "interrupted",
        lastError: null,
      },
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const activeExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(failureMessage(run)).toBeNull();
    expect(activeExecution?.status).toBe("running");
    expect(failureMessage(activeExecution)).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("includes observed worker state when a task stops without an upstream error reason", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeInterruptedLatestTurn("turn-worker-interrupted"),
      session: makeStoppedSession(execution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain(`Worker thread '${execution.workerThreadId}' stopped`);
    expect(failureMessage(run)).toContain("Observed session status: stopped.");
    expect(failureMessage(run)).toContain("Observed latest turn state: interrupted.");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "environment_failure",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
    expect(failedExecution?.status).toBe("failed");
    expect(failureMessage(failedExecution)).toContain(
      `Worker thread '${execution.workerThreadId}'`,
    );
    expect(issue?.comments.at(-1)?.text).toContain("Observed session status: stopped.");
  });

  it("fails the run with launch_failure when task launch setup fails after tracker validation succeeds", async () => {
    const harness = await createHarness(makeTrackerState(), {
      failDispatchForCommandTypes: ["thread.turn.start"],
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain(
      "Simulated dispatch failure for command 'thread.turn.start'.",
    );
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "launch_failure",
      }),
    );
    expect(snapshot.epicIssueExecutions).toHaveLength(1);
    expect(snapshot.epicIssueExecutions[0]?.status).toBe("launching");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("keeps requested execution pending before timeout when session reports ready without turn progress", async () => {
    const harness = await createHarness(makeTrackerState());
    harness.patchIssue("TASK-1", {
      status: "open",
      assignee: "issue-owner",
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.epicIssueExecutions[0];
    if (!initialExecution?.workerThreadId) {
      return;
    }

    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: null,
      session: makeReadySession(initialExecution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const execution = snapshot.epicIssueExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(failureMessage(run)).toBeNull();
    expect(execution?.status).toBe("launching");
    expect(execution?.startedAt).toBeNull();
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBe("issue-owner");
    expect(issue?.comments).toHaveLength(0);
  });

  it("does not settle the run from a non-authoritative completed worker turn", async () => {
    const harness = await createHarness(makeTrackerState());
    harness.patchIssue("TASK-1", {
      status: "open",
      assignee: "issue-owner",
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.epicIssueExecutions[0];
    if (!initialExecution?.workerThreadId) {
      return;
    }

    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-worker-message-only"),
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        assistantMessageId: MessageId.makeUnsafe("assistant-message-only"),
      },
      session: makeReadySession(initialExecution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const execution = snapshot.epicIssueExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(failureMessage(run)).toBeNull();
    expect(execution?.status).toBe("launching");
    expect(execution?.startedAt).toBeNull();
    expect(issue?.status).toBe("open");
    expect(issue?.comments).toHaveLength(0);
  });

  it("keeps requested execution pending before timeout when session reports an error without turn progress", async () => {
    const harness = await createHarness(makeTrackerState());
    harness.patchIssue("TASK-1", {
      status: "open",
      assignee: "issue-owner",
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.epicIssueExecutions[0];
    if (!initialExecution?.workerThreadId) {
      return;
    }

    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: null,
      session: {
        ...makeStoppedSession(initialExecution.workerThreadId),
        status: "error",
        lastError: "runtime noise before any turn existed",
      },
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const execution = snapshot.epicIssueExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.failureContext).toBeNull();
    expect(failureMessage(run)).toBeNull();
    expect(execution?.status).toBe("launching");
    expect(execution?.startedAt).toBeNull();
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBe("issue-owner");
    expect(issue?.comments).toHaveLength(0);
  });

  it("fails requested execution after timeout when no session or turn progress appears", async () => {
    const harness = await createHarness(makeTrackerState());

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: null,
      session: null,
    });
    harness.patchExecution(execution.executionId, {
      requestedAt: new Date(Date.now() - Duration.toMillis(Duration.seconds(61))).toISOString(),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const thread = snapshot.threads.find((entry) => entry.id === execution.workerThreadId);

    expect(run?.status).toBe("failed");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "launch_failure",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
    expect(failureMessage(run)).toContain("timed out while launching");
    expect(failureMessage(run)).toContain("never reached an active turn before timeout");
    expect(failedExecution?.status).toBe("failed");
    expect(thread?.deletedAt).toBe(now);
  });

  it("restores issue snapshot on requested execution timeout", async () => {
    const harness = await createHarness(makeTrackerState());
    harness.patchIssue("TASK-1", {
      status: "open",
      assignee: "issue-owner",
    });

    await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: null,
      session: makeIdleSession(execution.workerThreadId),
    });
    harness.patchExecution(execution.executionId, {
      requestedAt: new Date(Date.now() - Duration.toMillis(Duration.seconds(61))).toISOString(),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const timedOutExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(timedOutExecution?.status).toBe("failed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBe("issue-owner");
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("timed out while launching");
  });

  it("fails epic runs when reconciliation finds multiple non-terminal worker executions", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchReadModel((current) => ({
      ...current,
      epicIssueExecutions: [
        ...current.epicIssueExecutions,
        {
          executionId: EpicIssueExecutionId.makeUnsafe("execution-duplicate"),
          runId: started.runId,
          issueId: "TASK-2",
          workerThreadId: ThreadId.makeUnsafe("thread-duplicate"),
          sequenceNumber: 2,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: now,
          startedAt: now,
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: now,
        },
      ],
    }));

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);

    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain("multiple non-terminal task executions");
    expect(failureMessage(run)).toContain(String(execution.executionId));
    expect(failureMessage(run)).toContain("execution-duplicate");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "invariant_violation",
      }),
    );
  });

  it("starts a new run after worker-failure recovery state has become terminal", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });
    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    harness.patchReadModel((current) => ({
      ...current,
      epicIssueExecutions: current.epicIssueExecutions.map((entry) =>
        entry.executionId === execution.executionId
          ? { ...entry, status: "running", failedAt: null, failureContext: null, updatedAt: now }
          : entry,
      ),
    }));

    const restarted = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const originalRun = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const restartedRun = snapshot.epicRuns.find((entry) => entry.runId === restarted.runId);

    expect(restarted.runId).not.toBe(started.runId);
    expect(restartedRun?.status).toBe("running");
    expect(originalRun?.status).toBe("failed");
    expect(originalRun?.failureContext).toEqual(
      expect.objectContaining({
        kind: "worker_failure",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
  });

  it("fails epic runs when stop sees duplicate active worker executions", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchReadModel((current) => ({
      ...current,
      epicIssueExecutions: [
        ...current.epicIssueExecutions,
        {
          executionId: EpicIssueExecutionId.makeUnsafe("execution-shadow"),
          runId: started.runId,
          issueId: "TASK-2",
          workerThreadId: ThreadId.makeUnsafe("thread-shadow"),
          sequenceNumber: 2,
          status: "running",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: now,
          startedAt: now,
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: now,
        },
      ],
    }));

    const cancelled = await runtime!.runPromise(
      harness.workflow.stopEpicRun({
        runId: started.runId,
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);

    expect(cancelled.status).toBe("failed");
    expect(failureMessage(run)).toContain("multiple non-terminal task executions");
    expect(failureMessage(run)).toContain("execution-shadow");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "invariant_violation",
      }),
    );
  });

  it("cancels an active worker and restores tracker ownership", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const cancelled = await runtime!.runPromise(
      harness.workflow.stopEpicRun({
        runId: started.runId,
      }),
    );
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = snapshot.epicIssueExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(cancelled.status).toBe("stopped");
    expect(execution?.status).toBe("stopped");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker cancelled.");
  });

  it("treats stop as settled when the active execution fails during cancellation", async () => {
    let shouldInjectFailure = false;
    let injectedFailure = false;
    let targetExecutionId: EpicIssueExecutionId | null = null;
    let targetRunId: string | null = null;
    let harness;

    harness = await createHarness(makeTrackerState(), {
      beforeGetIssue: () =>
        Effect.sync(() => {
          if (!shouldInjectFailure || injectedFailure || targetExecutionId === null) {
            return;
          }

          injectedFailure = true;
          harness.patchReadModel((current) => ({
            ...current,
            epicRuns: current.epicRuns.map((run) =>
              run.runId !== targetRunId
                ? run
                : {
                    ...run,
                    status: "failed",
                    failureContext: {
                      kind: "environment_failure",
                      message: "Worker failed while stop was in progress.",
                      issueId: "TASK-1",
                      executionId: targetExecutionId,
                      workerThreadId: null,
                    },
                    failedAt: now,
                    updatedAt: now,
                  },
            ),
            epicIssueExecutions: current.epicIssueExecutions.map((execution) =>
              execution.executionId !== targetExecutionId
                ? execution
                : {
                    ...execution,
                    status: "failed",
                    failureContext: {
                      kind: "environment_failure",
                      message: "Worker failed while stop was in progress.",
                      issueId: execution.issueId,
                      executionId: execution.executionId,
                      workerThreadId: execution.workerThreadId,
                    },
                    failedAt: now,
                    updatedAt: now,
                  },
            ),
          }));
        }),
    });

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution) {
      return;
    }

    targetRunId = started.runId;
    targetExecutionId = execution.executionId;
    shouldInjectFailure = true;

    const stopped = await runtime!.runPromise(
      harness.workflow.stopEpicRun({
        runId: started.runId,
      }),
    );

    const stopExecutionCommands = harness
      .getDispatchedCommands()
      .filter((command) => command.type === "epic-issue-execution.stop");

    expect(stopped.status).toBe("failed");
    expect(stopExecutionCommands).toHaveLength(0);
  });

  it("fails the run with environment_failure when stop cannot confirm the worker stopped", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startEpicRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.epicIssueExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeRunningLatestTurn("turn-worker-running"),
      session: makeRunningSession(execution.workerThreadId, "turn-worker-running"),
    });

    const stopped = await runtime!.runPromise(
      harness.workflow.stopEpicRun({
        runId: started.runId,
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.epicRuns.find((entry) => entry.runId === started.runId);
    const currentExecution = snapshot.epicIssueExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(stopped.status).toBe("failed");
    expect(run?.status).toBe("failed");
    expect(failureMessage(run)).toContain("could not confirm that worker thread");
    expect(run?.failureContext).toEqual(
      expect.objectContaining({
        kind: "environment_failure",
        issueId: "TASK-1",
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      }),
    );
    expect(currentExecution?.status).toBe("failed");
    expect(failureMessage(currentExecution)).toContain("could not confirm that worker thread");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Epic-run worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("could not confirm that worker thread");
  }, 10_000);

  it("automatically schedules the lowest-priority ready issue first", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2), relationIssue("TASK-1", 1)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2), relationIssue("TASK-1", 1)],
        },
      }),
    );

    const started = await harness.startRun();
    await harness.drainScheduler();

    const snapshot = await harness.getSnapshot();
    const firstExecution = snapshot.epicIssueExecutions[0];

    expect(started.status).toBe("running");
    expect(firstExecution?.issueId).toBe("TASK-1");
    expect(firstExecution?.sequenceNumber).toBe(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.issueLink?.issueId).toBe("TASK-1");
    expect(harness.getIssue("TASK-1")?.status).toBe("open");
    expect(harness.getIssue("TASK-2")?.status).toBe("open");
  });

  it("refuses to start when external blockers exist and does not dispatch a worker", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-9", 9)],
          blockedBreakdown: {
            internal: [],
            external: [relationIssue("TASK-9", 9)],
            unknown: [],
          },
        },
      }),
    );

    await expect(harness.startRun()).rejects.toThrow(
      "Cannot start epic run for EPIC-1: Cannot start epic. External blockers: TASK-9.",
    );
    const snapshot = await harness.getSnapshot();

    expect(snapshot.epicRuns).toHaveLength(0);
    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("refuses to start when unknown dependency blockers exist and does not dispatch a worker", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          valid: false,
          errors: [
            "Blocked child TASK-7 has an open dependency that could not be identified. Fix dependency metadata before starting the epic.",
          ],
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-7", 7)],
          blockedBreakdown: {
            internal: [],
            external: [],
            unknown: [relationIssue("TASK-7", 7)],
          },
        },
      }),
    );

    await expect(harness.startRun()).rejects.toThrow(
      "Cannot start epic run for EPIC-1: Blocked child TASK-7 has an open dependency that could not be identified. Fix dependency metadata before starting the epic.",
    );
    const snapshot = await harness.getSnapshot();

    expect(snapshot.epicRuns).toHaveLength(0);
    expect(snapshot.epicIssueExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("deduplicates repeated starts while the first worker is still launching", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const attempts = Array.from({ length: 4 }, () => harness.startRun());
    const results = await Promise.all(attempts);
    const snapshot = await harness.getSnapshot();

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.runId).toBe(started.runId);
      expect(result.status).toBe("running");
    }
    expect(snapshot.epicIssueExecutions).toHaveLength(1);
    expect(snapshot.epicIssueExecutions[0]?.status).toBe("launching");
    expect(snapshot.threads).toHaveLength(1);
  });
});

describe("buildEpicRunWorkerPrompt", () => {
  it("instructs epic workers to commit all uncommitted files before closing", () => {
    const prompt = buildEpicRunWorkerPrompt({
      issueId: "TASK-1",
      issueTitle: "Task 1",
      epicIssueId: "EPIC-1",
      runId: "run-1" as never,
      executionId: "execution-1" as never,
      sequenceNumber: 1,
    });

    expect(prompt).toContain("git status --short");
    expect(prompt).toContain("git add -A");
    expect(prompt).toContain("all uncommitted files");
  });
});
