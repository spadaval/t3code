// @ts-nocheck
import { Duration, Effect, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointRef,
  CommandId,
  ProjectId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SwarmExecutionWorkflow } from "../Services/SwarmExecutionWorkflow.ts";
import {
  applyCommand,
  createSwarmExecutionWorkflowHarness,
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
  type SwarmExecutionWorkflowHarnessRuntime,
} from "./SwarmExecutionWorkflow.testHarness.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

describe("SwarmExecutionWorkflow", () => {
  let harnessRuntime: SwarmExecutionWorkflowHarnessRuntime | null = null;
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | SwarmExecutionWorkflow,
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
    harnessRuntime = await createSwarmExecutionWorkflowHarness(initialTrackerState, options);
    runtime = harnessRuntime.runtime;
    return harnessRuntime.harness;
  }

  it("starts a swarm run and keeps duplicate starts on the same non-terminal run", async () => {
    const harness = await createHarness();

    const first = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const second = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe("running");

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const runsForEpic = snapshot.swarmRuns.filter((run) => run.epicIssueId === "EPIC-1");
    expect(runsForEpic).toHaveLength(1);
    expect(runsForEpic[0]?.provider).toBe("codex");
    expect(runsForEpic[0]?.model).toBe("gpt-5-codex");
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.swarmTaskExecutions[0]?.issueId).toBe("TASK-1");
    expect(snapshot.swarmTaskExecutions[0]?.status).toBe("requested");
    expect(snapshot.swarmTaskExecutions[0]?.startedAt).toBeNull();
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.title).toBe("TASK-1: Task 1 (Swarm worker)");
    expect(snapshot.threads[0]?.issueLink?.issueId).toBe("TASK-1");

    const issue = harness.getIssue("TASK-1");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("keeps requested execution pending before timeout when launch has been requested but not observed", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const reconciledExecution = snapshot.swarmTaskExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(reconciledExecution?.status).toBe("requested");
    expect(reconciledExecution?.startedAt).toBeNull();
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  });

  it("deterministically keeps one shared-workspace run and fails the loser when another starts", async () => {
    const harness = await createHarness();

    const first = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    const second = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-2",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const firstRun = snapshot.swarmRuns.find((entry) => entry.runId === first.runId);
    const secondRun = snapshot.swarmRuns.find((entry) => entry.runId === second.runId);

    expect(secondRun?.status).toBe("running");
    expect(firstRun?.status).toBe("failed");
    expect(firstRun?.lastError).toContain(`Run '${second.runId}'`);
    expect(firstRun?.lastError).toContain(`Run '${first.runId}'`);
  });

  it("allows shared-workspace runs from different projects even when epic ids match", async () => {
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    const second = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: secondProjectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    expect(second.runId).not.toBe(first.runId);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.swarmRuns).toHaveLength(2);
    expect(snapshot.swarmRuns.find((entry) => entry.runId === first.runId)?.projectId).toBe(
      harness.projectId,
    );
    expect(snapshot.swarmRuns.find((entry) => entry.runId === second.runId)?.projectId).toBe(
      secondProjectId,
    );
  });

  it("auto-creates a missing swarm before starting a run", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          swarm: null,
        },
        status: {
          ...baseline.status,
          swarm: null,
        },
      }),
    );

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    expect(started.status).toBe("running");
    expect(harness.getCreateEpicSwarmCallCount()).toBe(1);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.swarmRuns).toHaveLength(1);
    expect(snapshot.swarmRuns[0]?.epicIssueId).toBe("EPIC-1");
  });

  it("rejects repeated run-next signals for a run that is already running", async () => {
    const harness = await createHarness(undefined, {
      beforeGetIssue: () => Effect.sleep(Duration.millis(100)),
    });

    harness.patchReadModel((current) =>
      applyCommand(
        current,
        {
          type: "swarm-run.request",
          commandId: CommandId.makeUnsafe("cmd-run-requested"),
          runId: SwarmRunId.makeUnsafe("run-storm"),
          projectId: harness.projectId,
          epicIssueId: "EPIC-1",
          swarmId: "SWARM-1",
          schedulerMode: "automatic",
          workspaceMode: "shared",
          provider: "codex",
          model: "gpt-5-codex",
          runtimeMode: "full-access",
          createdAt: now,
        },
        1,
      ),
    );
    harness.patchReadModel((current) =>
      applyCommand(
        current,
        {
          type: "swarm-run.mark-started",
          commandId: CommandId.makeUnsafe("cmd-run-started"),
          runId: SwarmRunId.makeUnsafe("run-storm"),
          createdAt: now,
        },
        2,
      ),
    );

    const runId = SwarmRunId.makeUnsafe("run-storm");
    const attempts = Array.from({ length: 8 }, () =>
      runtime!.runPromise(
        harness.workflow.runNextSwarmTask({
          runId,
        }),
      ),
    );

    const results = await Promise.allSettled(attempts);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(results).toHaveLength(8);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(String(result.reason)).toContain("cannot manually advance from status 'running'");
      }
    }
    expect(snapshot.swarmTaskExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("rejects starting a run when swarm validation fails", async () => {
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
        harness.workflow.startSwarmRun({
          projectId: harness.projectId,
          epicIssueId: "EPIC-1",
          schedulerMode: "automatic",
          workspaceMode: "shared",
          runtimeMode: "full-access",
        }),
      ),
    ).rejects.toThrow("Cannot start swarm for EPIC-1: Swarm graph is invalid.");
    expect(harness.getCreateEpicSwarmCallCount()).toBe(0);
  });

  it("does not auto-create a swarm when one already exists", async () => {
    const harness = await createHarness();

    await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    expect(harness.getCreateEpicSwarmCallCount()).toBe(0);
  });

  it("preserves explicit swarm creation failures when auto-create cannot recover", async () => {
    const baseline = makeTrackerState();
    const harness = await createHarness(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          swarm: null,
        },
        status: {
          ...baseline.status,
          swarm: null,
        },
      }),
      {
        createEpicSwarmMode: "fail",
        createEpicSwarmErrorMessage:
          "Failed to create swarm for EPIC-1: swarm was still missing after create completed.",
      },
    );

    await expect(
      runtime!.runPromise(
        harness.workflow.startSwarmRun({
          projectId: harness.projectId,
          epicIssueId: "EPIC-1",
          schedulerMode: "automatic",
          workspaceMode: "shared",
          runtimeMode: "full-access",
        }),
      ),
    ).rejects.toThrow(
      "Failed to create swarm for EPIC-1: swarm was still missing after create completed.",
    );
    expect(harness.getCreateEpicSwarmCallCount()).toBe(1);
  });

  it("blocks a running swarm when no ready issue remains and blocked work exists", async () => {
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === result.runId);
    expect(run?.status).toBe("blocked");
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = snapshot.swarmTaskExecutions[0];
    const firstIssue = harness.getIssue("TASK-1");
    const secondIssue = harness.getIssue("TASK-2");

    expect(started.status).toBe("running");
    expect(execution?.issueId).toBe("TASK-2");
    expect(firstIssue?.status).toBe("open");
    expect(firstIssue?.assignee).toBeNull();
    expect(secondIssue?.status).toBe("open");
    expect(secondIssue?.assignee).toBeNull();
  });

  it("does not claim validation-only issues after launchable-state recheck", async () => {
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(snapshot.swarmTaskExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
    expect(run?.status).toBe("completed");
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(snapshot.swarmTaskExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
    expect(run?.status).toBe("blocked");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  });

  it("rejects continuing a run while an execution is already active", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    await expect(
      runtime!.runPromise(
        harness.workflow.runNextSwarmTask({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("already has a non-terminal task execution");
  });

  it("fails completed worker turns when the issue was not closed by the worker", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toContain("issue 'TASK-1' is still 'open'");
    expect(run?.lastError).toContain("must close their assigned Beads issue");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
    });
    expect(failedExecution?.status).toBe("failed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("issue 'TASK-1' is still 'open'");
  });

  it("idles semi-automatic runs after a completed task when ready work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "semi-automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("idle");
    expect(completedExecution?.status).toBe("completed");
    expect(issue?.status).toBe("closed");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker completed.");
  });

  it("does not treat pending checkpoint capture state as a worker interruption", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );

    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
  });

  it("ignores legacy missing checkpoint placeholders when worker lifecycle is otherwise completed", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );

    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
  });

  it("automatically launches the next worker thread after a completed task when ready work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === initialExecution.executionId,
    );
    const nextExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId !== initialExecution.executionId,
    );
    const nextThread =
      nextExecution?.workerThreadId === null || nextExecution?.workerThreadId === undefined
        ? null
        : (snapshot.threads.find((thread) => thread.id === nextExecution.workerThreadId) ?? null);
    const initialIssue = harness.getIssue("TASK-1");
    const nextIssue = harness.getIssue("TASK-2");

    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(completedExecution?.status).toBe("completed");
    expect(nextExecution?.status).toBe("requested");
    expect(nextExecution?.issueId).toBe("TASK-2");
    expect(nextExecution?.workerThreadId).toBeTruthy();
    expect(snapshot.swarmTaskExecutions).toHaveLength(2);
    expect(snapshot.threads).toHaveLength(2);
    expect(nextThread?.title).toBe("TASK-2: Task 2 (Swarm worker)");
    expect(nextThread?.issueLink?.issueId).toBe("TASK-2");
    expect(initialIssue?.status).toBe("closed");
    expect(initialIssue?.assignee).toBeNull();
    expect(initialIssue?.comments.at(-1)?.text).toContain("Swarm worker completed.");
    expect(nextIssue?.status).toBe("open");
    expect(nextIssue?.assignee).toBeNull();
    expect(nextIssue?.comments).toHaveLength(0);
  });

  it("resumes semi-automatic paused runs back to idle instead of implicitly continuing", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "semi-automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    await runtime!.runPromise(
      harness.workflow.pauseSwarmRun({
        runId: started.runId,
      }),
    );

    const resumed = await runtime!.runPromise(
      harness.workflow.resumePausedSwarmRun({
        runId: started.runId,
      }),
    );

    expect(resumed.status).toBe("idle");
  });

  it("rejects resuming cancelled runs", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const cancelled = await runtime!.runPromise(
      harness.workflow.cancelSwarmRun({
        runId: started.runId,
      }),
    );
    expect(cancelled.status).toBe("cancelled");

    await expect(
      runtime!.runPromise(
        harness.workflow.resumePausedSwarmRun({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("is not paused and cannot be resumed");
  });

  it("rejects continuing a paused run that must be resumed", async () => {
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

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const paused = await runtime!.runPromise(
      harness.workflow.pauseSwarmRun({
        runId: started.runId,
      }),
    );
    expect(paused.status).toBe("paused");

    await expect(
      runtime!.runPromise(
        harness.workflow.runNextSwarmTask({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("must be resumed before running the next task");
  });

  it("keeps the higher-priority paused shared-workspace run and fails the lower-priority rival", async () => {
    const harness = await createHarness();

    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "swarm-run.request",
        commandId: CommandId.makeUnsafe("cmd-swarm-run-paused-request"),
        runId: SwarmRunId.makeUnsafe("run-paused"),
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        swarmId: "SWARM-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5-codex",
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );
    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "swarm-run.mark-started",
        commandId: CommandId.makeUnsafe("cmd-swarm-run-paused-started"),
        runId: SwarmRunId.makeUnsafe("run-paused"),
        createdAt: now,
      }),
    );
    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "swarm-run.pause",
        commandId: CommandId.makeUnsafe("cmd-swarm-run-paused"),
        runId: SwarmRunId.makeUnsafe("run-paused"),
        createdAt: now,
      }),
    );

    const blockingRunId = SwarmRunId.makeUnsafe("run-blocking");
    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "swarm-run.request",
        commandId: CommandId.makeUnsafe("cmd-swarm-run-blocking"),
        runId: blockingRunId,
        projectId: harness.projectId,
        epicIssueId: "EPIC-2",
        swarmId: "SWARM-2",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        provider: "codex",
        model: "gpt-5-codex",
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    const resumed = await runtime!.runPromise(
      harness.workflow.resumePausedSwarmRun({
        runId: SwarmRunId.makeUnsafe("run-paused"),
      }),
    );
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const pausedRun = snapshot.swarmRuns.find(
      (entry) => entry.runId === SwarmRunId.makeUnsafe("run-paused"),
    );
    const blockingRun = snapshot.swarmRuns.find((entry) => entry.runId === blockingRunId);

    expect(resumed.status).toBe("running");
    expect(pausedRun?.status).toBe("running");
    expect(blockingRun?.status).toBe("failed");
    expect(blockingRun?.lastError).toContain("Shared-workspace swarm scheduling invariant failed");
    expect(blockingRun?.lastError).toContain(`Run '${pausedRun?.runId}'`);
  });

  it("completes automatic runs when the last task finishes and no work remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);
    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
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
    const completed = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(completed?.status).toBe("completed");
  });

  it("reconciles failed worker threads on startup and restores tracker ownership", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toBe("Worker crashed");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
    });
    expect(failedExecution?.status).toBe("failed");
    expect(failedExecution?.lastError).toBe("Worker crashed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("Worker crashed");
  });

  it("keeps active swarm executions running when the worker turn is still active", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const activeExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(run?.lastError).toBeNull();
    expect(activeExecution?.status).toBe("active");
    expect(activeExecution?.lastError).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("includes observed worker state when a task stops without an upstream error reason", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toContain(`Worker thread '${execution.workerThreadId}' stopped`);
    expect(run?.lastError).toContain("Observed session status: stopped.");
    expect(run?.lastError).toContain("Observed latest turn state: interrupted.");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
    });
    expect(failedExecution?.status).toBe("failed");
    expect(failedExecution?.lastError).toContain(`Worker thread '${execution.workerThreadId}'`);
    expect(issue?.comments.at(-1)?.text).toContain("Observed session status: stopped.");
  });

  it("blocks the run when task launch setup fails after tracker validation succeeds", async () => {
    const harness = await createHarness(makeTrackerState(), {
      failDispatchForCommandTypes: ["thread.turn.start"],
    });

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("failed");
    expect(run?.lastError).toContain("Simulated dispatch failure for command 'thread.turn.start'.");
    expect(run?.blockedContext).toBeNull();
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.swarmTaskExecutions[0]?.status).toBe("requested");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments).toHaveLength(0);
  });

  it("restores the exact tracker status and assignee when requested launch reconciliation fails", async () => {
    const harness = await createHarness(makeTrackerState());
    harness.patchIssue("TASK-1", {
      status: "open",
      assignee: "issue-owner",
    });

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const initialExecution = initialSnapshot.swarmTaskExecutions[0];
    if (!initialExecution?.workerThreadId) {
      return;
    }

    harness.patchThread(initialExecution.workerThreadId, {
      latestTurn: null,
      session: makeReadySession(initialExecution.workerThreadId),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const execution = snapshot.swarmTaskExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toContain("never reported a started turn");
    expect(execution?.status).toBe("failed");
    expect(execution?.startedAt).toBeNull();
    expect(execution?.originalStatus).toBe("open");
    expect(execution?.originalAssignee).toBeNull();
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker failed.");
  });

  it("fails requested execution after timeout when no session or turn progress appears", async () => {
    const harness = await createHarness(makeTrackerState());

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const thread = snapshot.threads.find((entry) => entry.id === execution.workerThreadId);

    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
    });
    expect(run?.lastError).toContain("timed out while launching");
    expect(run?.lastError).toContain("never reached an active turn before timeout");
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
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
    const timedOutExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(timedOutExecution?.status).toBe("failed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker failed.");
    expect(issue?.comments.at(-1)?.text).toContain("timed out while launching");
  });

  it("fails shared-workspace runs when reconciliation finds multiple non-terminal worker executions", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchReadModel((current) => ({
      ...current,
      swarmTaskExecutions: [
        ...current.swarmTaskExecutions,
        {
          executionId: SwarmTaskExecutionId.makeUnsafe("execution-duplicate"),
          runId: started.runId,
          issueId: "TASK-2",
          workerThreadId: ThreadId.makeUnsafe("thread-duplicate"),
          sequenceNumber: 2,
          status: "active",
          originalStatus: "open",
          originalAssignee: null,
          lastError: null,
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          failedAt: null,
          cancelledAt: null,
          updatedAt: now,
        },
      ],
    }));

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(run?.status).toBe("failed");
    expect(run?.lastError).toContain("multiple non-terminal task executions");
    expect(run?.lastError).toContain(String(execution.executionId));
    expect(run?.lastError).toContain("execution-duplicate");
  });

  it("rejects continuing blocked runs when hidden non-terminal execution drift remains", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
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
      swarmTaskExecutions: current.swarmTaskExecutions.map((entry) =>
        entry.executionId === execution.executionId
          ? { ...entry, status: "active", failedAt: null, lastError: null, updatedAt: now }
          : entry,
      ),
    }));

    await expect(
      runtime!.runPromise(
        harness.workflow.runNextSwarmTask({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("already has a non-terminal task execution");

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
    });
  });

  it("rejects resume on blocked runs with continue-specific error", async () => {
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

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    await expect(
      runtime!.runPromise(
        harness.workflow.resumePausedSwarmRun({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("is not paused and cannot be resumed");
  });

  it("fails shared-workspace runs when cancel sees duplicate active worker executions", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchReadModel((current) => ({
      ...current,
      swarmTaskExecutions: [
        ...current.swarmTaskExecutions,
        {
          executionId: SwarmTaskExecutionId.makeUnsafe("execution-shadow"),
          runId: started.runId,
          issueId: "TASK-2",
          workerThreadId: ThreadId.makeUnsafe("thread-shadow"),
          sequenceNumber: 2,
          status: "active",
          originalStatus: "open",
          originalAssignee: null,
          lastError: null,
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          failedAt: null,
          cancelledAt: null,
          updatedAt: now,
        },
      ],
    }));

    const cancelled = await runtime!.runPromise(
      harness.workflow.cancelSwarmRun({
        runId: started.runId,
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(cancelled.status).toBe("failed");
    expect(run?.lastError).toContain("multiple non-terminal task executions");
    expect(run?.lastError).toContain("execution-shadow");
  });

  it("cancels an active worker and restores tracker ownership", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const cancelled = await runtime!.runPromise(
      harness.workflow.cancelSwarmRun({
        runId: started.runId,
      }),
    );
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = snapshot.swarmTaskExecutions[0];
    const issue = harness.getIssue("TASK-1");

    expect(cancelled.status).toBe("cancelled");
    expect(execution?.status).toBe("cancelled");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker cancelled.");
  });

  it("leaves the run non-terminal when cancellation cannot confirm the worker stopped", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeRunningLatestTurn("turn-worker-running"),
      session: makeRunningSession(execution.workerThreadId, "turn-worker-running"),
    });

    await expect(
      runtime!.runPromise(
        harness.workflow.cancelSwarmRun({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("could not confirm that worker thread");

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const currentExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("running");
    expect(currentExecution?.status).toBe("requested");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
  }, 10_000);

  it("keeps a worker-failure run blocked until tracker invariants are repaired", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [],
        },
        status: {
          ...baseline.status,
          ready: [],
          blocked: [relationIssue("TASK-1", 1)],
        },
      }),
    );

    const continued = await runtime!.runPromise(
      harness.workflow.runNextSwarmTask({
        runId: started.runId,
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(continued.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "tracker_waiting",
      issueId: null,
      executionId: null,
      workerThreadId: null,
    });
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
  });

  it("continues blocked worker-failure runs once tracker state exposes another ready issue", async () => {
    const harness = await createHarness();

    const started = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const initialSnapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const baseline = makeTrackerState();
    harness.patchIssue("TASK-1", {
      status: "closed",
    });
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
          blocked: [],
        },
      }),
    );

    const continued = await runtime!.runPromise(
      harness.workflow.runNextSwarmTask({
        runId: started.runId,
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const nextExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId !== execution.executionId,
    );
    const nextIssue = harness.getIssue("TASK-2");

    expect(continued.status).toBe("running");
    expect(run?.status).toBe("running");
    expect(run?.blockedContext).toBeNull();
    expect(nextExecution?.status).toBe("requested");
    expect(nextExecution?.issueId).toBe("TASK-2");
    expect(nextIssue?.status).toBe("open");
  });

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
    const firstExecution = snapshot.swarmTaskExecutions[0];

    expect(started.status).toBe("running");
    expect(firstExecution?.issueId).toBe("TASK-1");
    expect(firstExecution?.sequenceNumber).toBe(1);
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]?.issueLink?.issueId).toBe("TASK-1");
    expect(harness.getIssue("TASK-1")?.status).toBe("open");
    expect(harness.getIssue("TASK-2")?.status).toBe("open");
  });

  it("does not relaunch an already attempted issue when another ready issue is available", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const initialSnapshot = await harness.getSnapshot();
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchWorkerThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await harness.startSchedulerService();

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-1", 1), relationIssue("TASK-2", 2)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-1", 1), relationIssue("TASK-2", 2)],
          blocked: [],
        },
      }),
    );

    const continued = await harness.continueRun(started.runId);
    await harness.drainScheduler();

    const snapshot = await harness.getSnapshot();
    const nextExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId !== execution.executionId,
    );

    expect(continued.status).toBe("running");
    expect(nextExecution?.issueId).toBe("TASK-2");
    expect(nextExecution?.sequenceNumber).toBe(2);
    expect(harness.getIssue("TASK-1")?.status).toBe("open");
    expect(harness.getIssue("TASK-2")?.status).toBe("open");
  });

  it("retries the requested failed execution instead of selecting a different ready issue", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const initialSnapshot = await harness.getSnapshot();
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchWorkerThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await harness.startSchedulerService();

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-2", 2), relationIssue("TASK-1", 1)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-2", 2), relationIssue("TASK-1", 1)],
          blocked: [],
        },
      }),
    );

    const retried = await harness.retryExecution({
      runId: started.runId,
      executionId: execution.executionId,
    });
    await harness.drainScheduler();

    const snapshot = await harness.getSnapshot();
    const retriedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId !== execution.executionId,
    );

    expect(retried.status).toBe("running");
    expect(retriedExecution?.issueId).toBe("TASK-1");
    expect(retriedExecution?.sequenceNumber).toBe(2);
    expect(harness.getIssue("TASK-1")?.status).toBe("open");
    expect(harness.getIssue("TASK-2")?.status).toBe("open");
  });

  it("blocks with ready-exhaustion detail when every live ready issue was already attempted", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const initialSnapshot = await harness.getSnapshot();
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchWorkerThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await harness.startSchedulerService();

    const baseline = makeTrackerState();
    harness.setTrackerState(
      makeTrackerState({
        validation: {
          ...baseline.validation,
          readyFronts: [[relationIssue("TASK-1", 1)]],
        },
        status: {
          ...baseline.status,
          ready: [relationIssue("TASK-1", 1)],
          blocked: [],
        },
      }),
    );

    const continued = await harness.continueRun(started.runId);
    const snapshot = await harness.getSnapshot();
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(continued.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(run?.lastError).toContain("every live ready issue was already attempted");
    expect(run?.lastError).toContain("Previously attempted ready issues: TASK-1.");
  });

  it("blocks with retry-specific detail when the requested execution issue is no longer ready", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const initialSnapshot = await harness.getSnapshot();
    const execution = initialSnapshot.swarmTaskExecutions[0];
    expect(execution?.workerThreadId).toBeTruthy();
    if (!execution?.workerThreadId) {
      return;
    }

    harness.patchWorkerThread(execution.workerThreadId, {
      latestTurn: makeErroredLatestTurn("turn-worker-error"),
      session: makeErroredSession(execution.workerThreadId, "Worker crashed"),
    });

    await harness.startSchedulerService();

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
          blocked: [],
        },
      }),
    );

    const retried = await harness.retryExecution({
      runId: started.runId,
      executionId: execution.executionId,
    });
    const snapshot = await harness.getSnapshot();
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(retried.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "tracker_waiting",
      issueId: null,
      executionId: null,
      workerThreadId: null,
    });
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(run?.lastError).toContain(
      "cannot retry issue 'TASK-1' because it is not currently live-ready",
    );
    expect(run?.lastError).toContain("Ready issues: TASK-2.");
  });

  it("blocks immediately when only external blockers remain and does not dispatch a worker", async () => {
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

    const started = await harness.startRun();
    const snapshot = await harness.getSnapshot();
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(started.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "tracker_waiting",
      issueId: null,
      executionId: null,
      workerThreadId: null,
    });
    expect(run?.lastError).toContain("externally blocked issue");
    expect(snapshot.swarmTaskExecutions).toHaveLength(0);
    expect(snapshot.threads).toHaveLength(0);
  });

  it("rejects duplicate manual continue attempts while the first worker is still launching", async () => {
    const harness = await createHarness();

    const started = await harness.startRun();
    await harness.drainScheduler();

    const attempts = Array.from({ length: 4 }, () => harness.continueRun(started.runId));
    const results = await Promise.allSettled(attempts);
    const snapshot = await harness.getSnapshot();

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(String(result.reason)).toContain("already has a non-terminal task execution");
      }
    }
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.swarmTaskExecutions[0]?.status).toBe("requested");
    expect(snapshot.threads).toHaveLength(1);
  });
});
