import { Duration, Effect, Layer, ManagedRuntime, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  BeadsError,
  type BeadsIssueDetail,
  type BeadsSwarmStatus,
  type BeadsSwarmSupport,
  type BeadsSwarmValidation,
  CommandId,
  ProjectId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
  type OrchestrationSession,
  TurnId,
  type OrchestrationSwarmRun,
  type OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";
import {
  BeadsTrackerService,
  type BeadsTrackerServiceShape,
} from "../../beads/Services/BeadsTrackerService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { SwarmExecutionWorkflow } from "../Services/SwarmExecutionWorkflow.ts";
import { SwarmExecutionWorkflowLive } from "./SwarmExecutionWorkflow.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const now = "2026-04-06T13:00:00.000Z";

type TrackerState = {
  support: BeadsSwarmSupport;
  validation: BeadsSwarmValidation;
  status: BeadsSwarmStatus;
};

type HarnessOptions = {
  failUpdateIssueForIds?: ReadonlyArray<string>;
  failDispatchForCommandTypes?: ReadonlyArray<OrchestrationCommand["type"]>;
  beforeGetIssue?: (issueId: string) => Effect.Effect<void>;
  createEpicSwarmMode?: "succeed" | "fail";
  createEpicSwarmErrorMessage?: string;
};

function beadsError(message: string) {
  return new BeadsError({ message });
}

function relationIssue(id: string, priority: number | null) {
  return {
    id,
    title: id,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  } as const;
}

function makeTrackerState(overrides?: Partial<TrackerState>): TrackerState {
  const swarm = {
    swarmId: "SWARM-1",
    epicId: "EPIC-1",
    epicTitle: "Epic 1",
    totalIssueCount: 2,
    completedIssueCount: 0,
    activeIssueCount: 0,
    readyIssueCount: 1,
    blockedIssueCount: 0,
    activeWorkerCount: 0,
  } as const;

  return {
    support: {
      supported: true,
      reason: null,
      backend: {
        kind: "dolt",
        doltMode: "remote",
        database: "beads",
        projectId: "proj",
        role: "primary",
        bdVersion: "1.0.0",
      },
    },
    validation: {
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      swarm,
      valid: true,
      errors: [],
      warnings: [],
      readyFronts: [[relationIssue("TASK-1", 1)]],
      estimatedWorkerSessions: 1,
      maxParallelism: 1,
    },
    status: {
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      swarm,
      completed: [],
      active: [],
      ready: [relationIssue("TASK-1", 1)],
      blocked: [],
    },
    ...overrides,
  };
}

function makeIssueDetail(
  overrides: Partial<BeadsIssueDetail> & Pick<BeadsIssueDetail, "id" | "title">,
): BeadsIssueDetail {
  const { id, title, ...rest } = overrides;

  return {
    id,
    title,
    description: "Implement the task.",
    notes: null,
    status: "open",
    priority: 1,
    issueType: "task",
    assignee: null,
    owner: "issue-owner",
    createdAt: now,
    createdBy: "tester",
    updatedAt: now,
    labels: [],
    parent: { id: "EPIC-1", title: "Epic 1" },
    dependencies: [],
    comments: [],
    history: [],
    ...rest,
  };
}

function makeCompletedLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

function makeRunningLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: null,
  };
}

function makeReadySession(threadId: ThreadId): OrchestrationSession {
  return {
    threadId,
    status: "ready",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: now,
  };
}

function makeIdleSession(threadId: ThreadId): OrchestrationSession {
  return {
    threadId,
    status: "idle",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: now,
  };
}

function makeRunningSession(
  threadId: ThreadId,
  activeTurnId = "turn-running",
): OrchestrationSession {
  return {
    threadId,
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.makeUnsafe(activeTurnId),
    lastError: null,
    updatedAt: now,
  };
}

function makeErroredLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "error",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

function makeInterruptedLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "interrupted",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

function makeErroredSession(
  threadId: ThreadId,
  lastError: string,
  activeTurnId = "turn-error",
): OrchestrationSession {
  return {
    threadId,
    status: "error",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.makeUnsafe(activeTurnId),
    lastError,
    updatedAt: now,
  };
}

function makeStoppedSession(threadId: ThreadId): OrchestrationSession {
  return {
    threadId,
    status: "stopped",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: now,
  };
}

function createEmptyReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    planImplementationLaunches: [],
    swarmRuns: [],
    swarmTaskExecutions: [],
    updatedAt: now,
  };
}

function updateRun(
  readModel: OrchestrationReadModel,
  runId: string,
  transform: (run: OrchestrationSwarmRun) => OrchestrationSwarmRun,
): OrchestrationReadModel {
  return {
    ...readModel,
    swarmRuns: readModel.swarmRuns.map((run) => (run.runId === runId ? transform(run) : run)),
  };
}

function updateExecution(
  readModel: OrchestrationReadModel,
  executionId: string,
  transform: (execution: OrchestrationSwarmTaskExecution) => OrchestrationSwarmTaskExecution,
): OrchestrationReadModel {
  return {
    ...readModel,
    swarmTaskExecutions: readModel.swarmTaskExecutions.map((execution) =>
      execution.executionId === executionId ? transform(execution) : execution,
    ),
  };
}

function applyCommand(
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
  sequence: number,
): OrchestrationReadModel {
  switch (command.type) {
    case "project.create":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        projects: [
          ...readModel.projects,
          {
            id: command.projectId,
            title: command.title,
            workspaceRoot: command.workspaceRoot,
            defaultModelSelection: command.defaultModelSelection ?? null,
            scripts: [],
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            deletedAt: null,
          },
        ],
      };

    case "thread.create":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        threads: [
          ...readModel.threads,
          {
            id: command.threadId,
            projectId: command.projectId,
            title: command.title,
            modelSelection: command.modelSelection,
            runtimeMode: command.runtimeMode,
            interactionMode: command.interactionMode,
            branch: command.branch,
            worktreePath: command.worktreePath,
            issueLink: command.issueLink ?? null,
            latestTurn: null,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
            archivedAt: null,
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
        ],
      };

    case "thread.turn.start":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        threads: readModel.threads.map((thread) =>
          thread.id !== command.threadId
            ? thread
            : {
                ...thread,
                updatedAt: command.createdAt,
                messages: [
                  ...thread.messages,
                  {
                    id: command.message.messageId,
                    role: "user",
                    text: command.message.text,
                    attachments: command.message.attachments,
                    turnId: null,
                    streaming: false,
                    createdAt: command.createdAt,
                    updatedAt: command.createdAt,
                  },
                ],
              },
        ),
      };

    case "thread.turn.interrupt":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
      };

    case "thread.session.stop":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        threads: readModel.threads.map((thread) =>
          thread.id !== command.threadId
            ? thread
            : {
                ...thread,
                updatedAt: command.createdAt,
                session:
                  thread.session === null
                    ? null
                    : {
                        ...thread.session,
                        status: "stopped",
                        activeTurnId: null,
                        updatedAt: command.createdAt,
                      },
              },
        ),
      };

    case "thread.delete":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: now,
        threads: readModel.threads.map((thread) =>
          thread.id === command.threadId ? { ...thread, deletedAt: now, updatedAt: now } : thread,
        ),
      };

    case "swarm-run.request":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        swarmRuns: [
          ...readModel.swarmRuns,
          {
            runId: command.runId,
            projectId: command.projectId,
            epicIssueId: command.epicIssueId,
            status: "requested",
            schedulerMode: command.schedulerMode,
            workspaceMode: command.workspaceMode,
            provider: command.provider ?? null,
            model: command.model ?? null,
            modelOptions: command.modelOptions ?? null,
            providerOptions: command.providerOptions ?? null,
            assistantDeliveryMode: command.assistantDeliveryMode ?? null,
            runtimeMode: command.runtimeMode,
            lastError: null,
            requestedAt: command.createdAt,
            startedAt: null,
            idledAt: null,
            pausedAt: null,
            blockedAt: null,
            blockedContext: null,
            failedAt: null,
            cancelledAt: null,
            completedAt: null,
            updatedAt: command.createdAt,
          },
        ],
      };

    case "swarm-run.mark-started":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "running",
          startedAt: command.createdAt,
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.mark-idle":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "idle",
          idledAt: command.createdAt,
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.pause":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "paused",
          pausedAt: command.createdAt,
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.resume":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "running",
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.block":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "blocked",
          blockedAt: command.createdAt,
          lastError: command.reason,
          blockedContext: command.blockedContext,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.fail":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "failed",
          failedAt: command.createdAt,
          lastError: command.reason,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.cancel":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "cancelled",
          cancelledAt: command.createdAt,
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-run.complete":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "completed",
          completedAt: command.createdAt,
          lastError: null,
          blockedContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-task-execution.request":
      return {
        ...updateRun(
          {
            ...readModel,
            snapshotSequence: sequence,
            updatedAt: command.createdAt,
          },
          command.runId,
          (run) => ({
            ...run,
            updatedAt: command.createdAt,
          }),
        ),
        swarmTaskExecutions: [
          ...readModel.swarmTaskExecutions,
          {
            executionId: command.executionId,
            runId: command.runId,
            issueId: command.issueId,
            workerThreadId: command.workerThreadId,
            sequenceNumber: command.sequenceNumber,
            status: "requested",
            originalStatus: command.originalStatus,
            originalAssignee: command.originalAssignee,
            lastError: null,
            requestedAt: command.createdAt,
            startedAt: null,
            completedAt: null,
            failedAt: null,
            cancelledAt: null,
            updatedAt: command.createdAt,
          },
        ],
      };

    case "swarm-task-execution.start":
      return updateExecution(
        updateRun(
          {
            ...readModel,
            snapshotSequence: sequence,
            updatedAt: command.createdAt,
          },
          command.runId,
          (run) => ({
            ...run,
            updatedAt: command.createdAt,
          }),
        ),
        command.executionId,
        (execution) => ({
          ...execution,
          status: "active",
          startedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-task-execution.complete":
      return updateExecution(
        updateRun(
          {
            ...readModel,
            snapshotSequence: sequence,
            updatedAt: command.createdAt,
          },
          command.runId,
          (run) => ({
            ...run,
            updatedAt: command.createdAt,
          }),
        ),
        command.executionId,
        (execution) => ({
          ...execution,
          status: "completed",
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-task-execution.fail":
      return updateExecution(
        updateRun(
          {
            ...readModel,
            snapshotSequence: sequence,
            updatedAt: command.createdAt,
          },
          command.runId,
          (run) => ({
            ...run,
            updatedAt: command.createdAt,
          }),
        ),
        command.executionId,
        (execution) => ({
          ...execution,
          status: "failed",
          lastError: command.reason,
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "swarm-task-execution.cancel":
      return updateExecution(
        updateRun(
          {
            ...readModel,
            snapshotSequence: sequence,
            updatedAt: command.createdAt,
          },
          command.runId,
          (run) => ({
            ...run,
            updatedAt: command.createdAt,
          }),
        ),
        command.executionId,
        (execution) => ({
          ...execution,
          status: "cancelled",
          cancelledAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    default:
      return readModel;
  }
}

describe("SwarmExecutionWorkflow", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | SwarmExecutionWorkflow,
    unknown
  > | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness(
    initialTrackerState = makeTrackerState(),
    options: HarnessOptions = {},
  ) {
    let trackerState = initialTrackerState;
    let trackerStateSequence: ReadonlyArray<TrackerState> | null = null;
    let pendingTrackerStateSnapshot: TrackerState | null = null;
    let pendingTrackerStateReadsRemaining = 0;
    let createEpicSwarmCallCount = 0;
    let readModel = createEmptyReadModel();
    let readModelCallCount = 0;
    let sequence = 0;
    const issues = new Map<string, BeadsIssueDetail>([
      [
        "TASK-1",
        makeIssueDetail({
          id: "TASK-1",
          title: "Task 1",
        }),
      ],
      [
        "TASK-2",
        makeIssueDetail({
          id: "TASK-2",
          title: "Task 2",
          priority: 2,
        }),
      ],
    ]);

    const readTrackerStateSnapshot = (): TrackerState => {
      if (pendingTrackerStateSnapshot !== null) {
        const snapshot = pendingTrackerStateSnapshot;
        pendingTrackerStateReadsRemaining -= 1;
        if (pendingTrackerStateReadsRemaining === 0) {
          pendingTrackerStateSnapshot = null;
        }
        return snapshot;
      }

      const snapshot = trackerStateSequence?.[0] ?? trackerStateSequence?.at(-1) ?? trackerState;

      if (trackerStateSequence && trackerStateSequence.length > 1) {
        trackerStateSequence = trackerStateSequence.slice(1);
      }

      pendingTrackerStateSnapshot = snapshot;
      pendingTrackerStateReadsRemaining = 2;
      return snapshot;
    };

    const trackerService: BeadsTrackerServiceShape = {
      queryIssues: () => Effect.fail(beadsError("unexpected queryIssues call")),
      getIssue: ({ issueId }) =>
        Effect.suspend(() => {
          const beforeGetIssue = options.beforeGetIssue?.(issueId) ?? Effect.void;
          const issue = issues.get(issueId);
          if (!issue) {
            return Effect.fail(beadsError(`Unknown issue '${issueId}'.`));
          }
          return beforeGetIssue.pipe(Effect.flatMap(() => Effect.succeed(issue)));
        }),
      updateIssue: (input) =>
        Effect.suspend(() => {
          if (options.failUpdateIssueForIds?.includes(input.issueId)) {
            return Effect.fail(
              beadsError(`Simulated updateIssue failure for issue '${input.issueId}'.`),
            );
          }
          const existing = issues.get(input.issueId);
          if (!existing) {
            return Effect.fail(beadsError(`Unknown issue '${input.issueId}'.`));
          }
          const updated = {
            ...existing,
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.assignee !== undefined ? { assignee: input.assignee ?? null } : {}),
            updatedAt: now,
          } satisfies BeadsIssueDetail;
          issues.set(input.issueId, updated);
          return Effect.succeed(updated);
        }),
      commentIssue: (input) =>
        Effect.suspend(() => {
          const existing = issues.get(input.issueId);
          if (!existing) {
            return Effect.fail(beadsError(`Unknown issue '${input.issueId}'.`));
          }
          const updated = {
            ...existing,
            comments: [
              ...existing.comments,
              {
                id: `comment-${existing.comments.length + 1}`,
                issueId: input.issueId,
                author: "swarm",
                text: input.text,
                createdAt: now,
              },
            ],
            updatedAt: now,
          } satisfies BeadsIssueDetail;
          issues.set(input.issueId, updated);
          return Effect.succeed(updated);
        }),
      getContext: () => Effect.fail(beadsError("unexpected getContext call")),
      getSwarmSupport: () => Effect.succeed(readTrackerStateSnapshot().support),
      getIssueGraph: () => Effect.fail(beadsError("unexpected getIssueGraph call")),
      getEpicSwarm: () => Effect.succeed(readTrackerStateSnapshot().validation.swarm),
      validateEpicSwarm: () => Effect.succeed(readTrackerStateSnapshot().validation),
      getEpicSwarmStatus: () => Effect.succeed(readTrackerStateSnapshot().status),
      listSwarms: () =>
        Effect.sync(() => {
          const currentTrackerState = readTrackerStateSnapshot();
          return {
            swarms: currentTrackerState.validation.swarm
              ? [currentTrackerState.validation.swarm]
              : [],
          };
        }),
      createEpicSwarm: ({ epicIssueId }) =>
        Effect.suspend(() => {
          createEpicSwarmCallCount += 1;

          if (options.createEpicSwarmMode === "fail") {
            return Effect.fail(
              beadsError(
                options.createEpicSwarmErrorMessage ??
                  `Failed to create swarm for ${epicIssueId}: simulated create failure.`,
              ),
            );
          }

          const currentSwarm = trackerState.validation.swarm ?? trackerState.status.swarm;
          const swarm = currentSwarm ?? {
            swarmId: `SWARM-${epicIssueId}`,
            epicId: epicIssueId,
            epicTitle: trackerState.validation.epicTitle,
            totalIssueCount:
              trackerState.status.completed.length +
              trackerState.status.active.length +
              trackerState.status.ready.length +
              trackerState.status.blocked.length,
            completedIssueCount: trackerState.status.completed.length,
            activeIssueCount: trackerState.status.active.length,
            readyIssueCount: trackerState.status.ready.length,
            blockedIssueCount: trackerState.status.blocked.length,
            activeWorkerCount: 0,
          };

          trackerState = {
            ...trackerState,
            validation: {
              ...trackerState.validation,
              swarm,
            },
            status: {
              ...trackerState.status,
              swarm,
            },
          };

          return Effect.succeed(swarm);
        }),
    };

    const engineService: OrchestrationEngineShape = {
      getReadModel: () =>
        Effect.sync(() => {
          readModelCallCount += 1;
          return readModel;
        }),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          if (options.failDispatchForCommandTypes?.includes(command.type)) {
            throw new Error(`Simulated dispatch failure for command '${command.type}'.`);
          }
          sequence += 1;
          readModel = applyCommand(readModel, command, sequence);
          return { sequence };
        }),
    };

    const layer = SwarmExecutionWorkflowLive.pipe(
      Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engineService)),
      Layer.provideMerge(Layer.succeed(BeadsTrackerService, trackerService)),
    );

    runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const workflow = await runtime.runPromise(Effect.service(SwarmExecutionWorkflow));
    const projectId = asProjectId("project-1");

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project"),
        projectId,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt: now,
      }),
    );

    return {
      engine,
      workflow,
      projectId,
      getIssue: (issueId: string) => issues.get(issueId) ?? null,
      patchIssue: (
        issueId: string,
        patch: Partial<Pick<BeadsIssueDetail, "status" | "assignee" | "owner" | "comments">>,
      ) => {
        const existing = issues.get(issueId);
        if (!existing) {
          return;
        }
        issues.set(issueId, {
          ...existing,
          ...patch,
          updatedAt: now,
        });
      },
      patchThread: (
        threadId: ThreadId,
        patch: {
          latestTurn?: OrchestrationLatestTurn | null;
          session?: OrchestrationSession | null;
        },
      ) => {
        const nextThreads = [...readModel.threads];
        const threadIndex = nextThreads.findIndex((thread) => thread.id === threadId);
        if (threadIndex >= 0) {
          const nextThread = { ...nextThreads[threadIndex]! };
          if (patch.latestTurn !== undefined) {
            nextThread.latestTurn = patch.latestTurn;
          }
          if (patch.session !== undefined) {
            nextThread.session = patch.session;
          }
          nextThreads[threadIndex] = nextThread;
        }
        readModel = {
          ...readModel,
          threads: nextThreads,
        };
      },
      setTrackerState: (next: TrackerState) => {
        trackerState = next;
        trackerStateSequence = null;
        pendingTrackerStateSnapshot = null;
        pendingTrackerStateReadsRemaining = 0;
      },
      setTrackerStateSequence: (next: ReadonlyArray<TrackerState>) => {
        trackerStateSequence = next;
        trackerState = next.at(-1) ?? trackerState;
        pendingTrackerStateSnapshot = null;
        pendingTrackerStateReadsRemaining = 0;
      },
      getCreateEpicSwarmCallCount: () => createEpicSwarmCallCount,
      getReadModelCallCount: () => readModelCallCount,
      patchReadModel: (transform: (current: OrchestrationReadModel) => OrchestrationReadModel) => {
        readModel = transform(readModel);
      },
      patchExecution: (
        executionId: SwarmTaskExecutionId,
        patch: Partial<OrchestrationSwarmTaskExecution>,
      ) => {
        readModel = updateExecution(readModel, executionId, (execution) => ({
          ...execution,
          ...patch,
        }));
      },
    };
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
    expect(issue?.status).toBe("in_progress");
    expect(issue?.assignee).toBe(`t3code-swarm/${first.runId}`);
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker started.");
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
    expect(issue?.status).toBe("in_progress");
    expect(issue?.assignee).toBe(`t3code-swarm/${started.runId}`);
  });

  it("rejects starting a shared-workspace run when the project already has another non-terminal run", async () => {
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

    await expect(
      runtime!.runPromise(
        harness.workflow.startSwarmRun({
          projectId: harness.projectId,
          epicIssueId: "EPIC-2",
          schedulerMode: "automatic",
          workspaceMode: "shared",
          runtimeMode: "full-access",
        }),
      ),
    ).rejects.toThrow(`blocked by run '${first.runId}'`);
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

    expect(started.status).toBe("requested");
    expect(harness.getCreateEpicSwarmCallCount()).toBe(1);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.swarmRuns).toHaveLength(1);
    expect(snapshot.swarmRuns[0]?.epicIssueId).toBe("EPIC-1");
  });

  it("coalesces repeated continue signals for the same running run", async () => {
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
        harness.workflow.continueSwarmRun({
          runId,
        }),
      ),
    );

    await Promise.all(attempts);
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.swarmTaskExecutions[0]?.issueId).toBe("TASK-1");
    expect(snapshot.threads).toHaveLength(1);
    expect(harness.getReadModelCallCount()).toBeLessThan(60);
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

    expect(started.status).toBe("requested");
    expect(execution?.issueId).toBe("TASK-2");
    expect(firstIssue?.status).toBe("open");
    expect(firstIssue?.assignee).toBeNull();
    expect(secondIssue?.status).toBe("in_progress");
    expect(secondIssue?.assignee).toBe(`t3code-swarm/${started.runId}`);
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
        harness.workflow.continueSwarmRun({
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

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const failedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toContain("issue 'TASK-1' is still 'in_progress'");
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
    expect(issue?.comments.at(-1)?.text).toContain("issue 'TASK-1' is still 'in_progress'");
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

    await runtime!.runPromise(Effect.scoped(harness.workflow.start));
    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const completedExecution = snapshot.swarmTaskExecutions.find(
      (entry) => entry.executionId === execution.executionId,
    );
    const issue = harness.getIssue("TASK-1");

    expect(run?.status).toBe("idle");
    expect(completedExecution?.status).toBe("completed");
    expect(issue?.status).toBe("closed");
    expect(issue?.assignee).toBe(`t3code-swarm/${started.runId}`);
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker completed.");
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
    expect(initialIssue?.assignee).toBe(`t3code-swarm/${started.runId}`);
    expect(initialIssue?.comments.at(-1)?.text).toContain("Swarm worker completed.");
    expect(nextIssue?.status).toBe("in_progress");
    expect(nextIssue?.assignee).toBe(`t3code-swarm/${started.runId}`);
    expect(nextIssue?.comments.at(-1)?.text).toContain("Swarm worker started.");
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
      harness.workflow.resumeSwarmRun({
        runId: started.runId,
      }),
    );

    expect(resumed.status).toBe("idle");
  });

  it("resumes cancelled runs by relaunching the next ready task", async () => {
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

    const resumed = await runtime!.runPromise(
      harness.workflow.resumeSwarmRun({
        runId: started.runId,
      }),
    );
    expect(resumed.status).toBe("running");

    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const latestRun = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);
    const latestExecution = snapshot.swarmTaskExecutions.at(-1);
    const issue = harness.getIssue("TASK-1");

    expect(latestRun?.status).toBe("running");
    expect(snapshot.swarmTaskExecutions).toHaveLength(2);
    expect(latestExecution?.issueId).toBe("TASK-1");
    expect(latestExecution?.status).toBe("requested");
    expect(issue?.status).toBe("in_progress");
    expect(issue?.assignee).toBe(`t3code-swarm/${started.runId}`);
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
        harness.workflow.continueSwarmRun({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("must be resumed, not continued");
  });

  it("rejects resuming a shared-workspace run when another project run is still non-terminal", async () => {
    const harness = await createHarness();

    const paused = await runtime!.runPromise(
      harness.workflow.startSwarmRun({
        projectId: harness.projectId,
        epicIssueId: "EPIC-1",
        schedulerMode: "automatic",
        workspaceMode: "shared",
        runtimeMode: "full-access",
      }),
    );

    await runtime!.runPromise(
      harness.workflow.pauseSwarmRun({
        runId: paused.runId,
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

    await expect(
      runtime!.runPromise(
        harness.workflow.resumeSwarmRun({
          runId: paused.runId,
        }),
      ),
    ).rejects.toThrow(`blocked by run '${blockingRunId}'`);
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
    expect(issue?.comments).toHaveLength(1);
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker started.");
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
      failUpdateIssueForIds: ["TASK-1"],
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

    expect(run?.status).toBe("blocked");
    expect(run?.lastError).toContain("Simulated updateIssue failure for issue 'TASK-1'.");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: expect.any(String),
      workerThreadId: expect.any(String),
    });
    expect(snapshot.swarmTaskExecutions).toHaveLength(1);
    expect(snapshot.swarmTaskExecutions[0]?.status).toBe("failed");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBeNull();
    expect(issue?.comments.at(-1)?.text).toContain("Swarm worker failed.");
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
    expect(execution?.originalAssignee).toBe("issue-owner");
    expect(issue?.status).toBe("open");
    expect(issue?.assignee).toBe("issue-owner");
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
    expect(issue?.assignee).toBe("issue-owner");
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
        harness.workflow.continueSwarmRun({
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
        harness.workflow.resumeSwarmRun({
          runId: started.runId,
        }),
      ),
    ).rejects.toThrow("must be continued, not resumed");
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
    expect(issue?.status).toBe("in_progress");
    expect(issue?.assignee).toBe(`t3code-swarm/${started.runId}`);
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
      harness.workflow.continueSwarmRun({
        runId: started.runId,
      }),
    );

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const run = snapshot.swarmRuns.find((entry) => entry.runId === started.runId);

    expect(continued.status).toBe("blocked");
    expect(run?.status).toBe("blocked");
    expect(run?.blockedContext).toEqual({
      kind: "worker_failure",
      issueId: "TASK-1",
      executionId: execution.executionId,
      workerThreadId: execution.workerThreadId,
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
      harness.workflow.continueSwarmRun({
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
    expect(nextIssue?.status).toBe("in_progress");
  });
});
