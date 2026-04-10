import { Effect, Layer, ManagedRuntime, Stream } from "effect";

import {
  BeadsError,
  type BeadsIssueDetail,
  type BeadsSwarmStatus,
  type BeadsSwarmSupport,
  type BeadsSwarmValidation,
  CommandId,
  ProjectId,
  EpicIssueExecutionId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationStartEpicRunInput,
  type OrchestrationEpicRunControlResult,
  type OrchestrationEpicRun,
  type OrchestrationEpicIssueExecution,
  type EpicRunId,
  TurnId,
} from "@t3tools/contracts";
import { createSwarmFailureContext } from "@t3tools/shared/swarm";
import {
  BeadsTrackerService,
  type BeadsTrackerServiceShape,
} from "../../beads/Services/BeadsTrackerService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  SwarmExecutionWorkflow,
  type SwarmExecutionWorkflowShape,
} from "../Services/SwarmExecutionWorkflow.ts";
import { SwarmExecutionWorkflowLive } from "./SwarmExecutionWorkflow.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

export const now = "2026-04-06T13:00:00.000Z";

export type TrackerState = {
  support: BeadsSwarmSupport;
  validation: BeadsSwarmValidation;
  status: BeadsSwarmStatus;
};

export type TrackerStateOverrides = Partial<Omit<TrackerState, "validation" | "status">> & {
  validation?: Partial<BeadsSwarmValidation>;
  status?: Partial<BeadsSwarmStatus>;
};

export type HarnessOptions = {
  failUpdateIssueForIds?: ReadonlyArray<string>;
  failDispatchForCommandTypes?: ReadonlyArray<OrchestrationCommand["type"]>;
  beforeGetIssue?: (issueId: string) => Effect.Effect<void>;
  createEpicSwarmMode?: "succeed" | "fail";
  createEpicSwarmErrorMessage?: string;
};

function beadsError(message: string) {
  return new BeadsError({ message });
}

export function relationIssue(id: string, priority: number | null) {
  const title =
    id === "TASK-1" ? "Task 1" : id === "TASK-2" ? "Task 2" : id === "EPIC-1" ? "Epic 1" : id;
  return {
    id,
    title,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  } as const;
}

export function makeTrackerState(overrides?: TrackerStateOverrides): TrackerState {
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
      ...overrides?.support,
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
      ...overrides?.validation,
    },
    status: {
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      swarm,
      completed: [],
      active: [],
      ready: [relationIssue("TASK-1", 1)],
      blocked: [],
      blockedBreakdown: {
        internal: [],
        external: [],
        unknown: [],
      },
      ...overrides?.status,
    },
  };
}

export function makeIssueDetail(
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
    ...rest,
  };
}

export function makeCompletedLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

export function makeRunningLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: null,
  };
}

export function makeReadySession(threadId: ThreadId): OrchestrationSession {
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

export function makeIdleSession(threadId: ThreadId): OrchestrationSession {
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

export function makeRunningSession(
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

export function makeErroredLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "error",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

export function makeInterruptedLatestTurn(turnId: string): OrchestrationLatestTurn {
  return {
    turnId: TurnId.makeUnsafe(turnId),
    state: "interrupted",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: null,
  };
}

export function makeErroredSession(
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

export function makeStoppedSession(threadId: ThreadId): OrchestrationSession {
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
    epicRuns: [],
    epicIssueExecutions: [],
    updatedAt: now,
  };
}

function updateRun(
  readModel: OrchestrationReadModel,
  runId: string,
  transform: (run: OrchestrationEpicRun) => OrchestrationEpicRun,
): OrchestrationReadModel {
  return {
    ...readModel,
    epicRuns: readModel.epicRuns.map((run) => (run.runId === runId ? transform(run) : run)),
  };
}

function updateExecution(
  readModel: OrchestrationReadModel,
  executionId: string,
  transform: (execution: OrchestrationEpicIssueExecution) => OrchestrationEpicIssueExecution,
): OrchestrationReadModel {
  return {
    ...readModel,
    epicIssueExecutions: readModel.epicIssueExecutions.map((execution) =>
      execution.executionId === executionId ? transform(execution) : execution,
    ),
  };
}

export function applyCommand(
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
            pendingCheckpointCaptures: [],
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

    case "epic-run.request":
      return {
        ...readModel,
        snapshotSequence: sequence,
        updatedAt: command.createdAt,
        epicRuns: [
          ...readModel.epicRuns,
          {
            runId: command.runId,
            projectId: command.projectId,
            epicIssueId: command.epicIssueId,
            status: "pending",
            provider: command.provider ?? null,
            model: command.model ?? null,
            modelOptions: command.modelOptions ?? null,
            providerOptions: command.providerOptions ?? null,
            assistantDeliveryMode: command.assistantDeliveryMode ?? null,
            runtimeMode: command.runtimeMode,
            failureContext: null,
            requestedAt: command.createdAt,
            startedAt: null,
            stopRequestedAt: null,
            stoppedAt: null,
            failedAt: null,
            completedAt: null,
            updatedAt: command.createdAt,
          },
        ],
      };

    case "epic-run.mark-started":
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
          failureContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-run.mark-idle":
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
          updatedAt: command.createdAt,
        }),
      );

    case "epic-run.block":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: command.blockedContext?.kind === "tracker_waiting" ? "running" : "failed",
          failureContext:
            command.blockedContext?.kind === "tracker_waiting"
              ? null
              : createSwarmFailureContext({
                  reason: command.reason,
                  issueId: command.blockedContext?.issueId ?? null,
                  executionId: command.blockedContext?.executionId ?? null,
                  workerThreadId: command.blockedContext?.workerThreadId ?? null,
                }),
          failedAt:
            command.blockedContext?.kind === "tracker_waiting" ? run.failedAt : command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-run.fail":
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
          failureContext: createSwarmFailureContext({
            reason: command.reason,
          }),
          updatedAt: command.createdAt,
        }),
      );

    case "epic-run.stop":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => ({
          ...run,
          status: "stopped",
          stopRequestedAt: command.createdAt,
          stoppedAt: command.createdAt,
          failureContext: null,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-run.complete":
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
          failureContext: null,
          stopRequestedAt: null,
          stoppedAt: null,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-issue-execution.request":
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
        epicIssueExecutions: [
          ...readModel.epicIssueExecutions,
          {
            executionId: command.executionId,
            runId: command.runId,
            issueId: command.issueId,
            workerThreadId: command.workerThreadId,
            sequenceNumber: command.sequenceNumber,
            status: "launching",
            workspaceKey: "shared",
            workspacePath: null,
            failureContext: null,
            requestedAt: command.createdAt,
            startedAt: null,
            stopRequestedAt: null,
            stoppedAt: null,
            completedAt: null,
            failedAt: null,
            updatedAt: command.createdAt,
          },
        ],
      };

    case "epic-issue-execution.start":
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
          status: "running",
          startedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-issue-execution.complete":
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

    case "epic-issue-execution.fail":
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
          failureContext: createSwarmFailureContext({
            reason: command.reason,
            issueId: execution.issueId,
            executionId: execution.executionId,
            workerThreadId: execution.workerThreadId,
          }),
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    case "epic-issue-execution.stop":
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
          status: "stopped",
          stopRequestedAt: command.createdAt,
          stoppedAt: command.createdAt,
          updatedAt: command.createdAt,
        }),
      );

    default:
      return readModel;
  }
}

type SwarmExecutionWorkflowTestHarness = {
  engine: Omit<OrchestrationEngineShape, "getReadModel"> & {
    getReadModel: () => Effect.Effect<OrchestrationReadModel, never, never>;
  };
  workflow: SwarmExecutionWorkflowShape;
  projectId: ProjectId;
  runPromise: <A, E, R extends OrchestrationEngineService | SwarmExecutionWorkflow>(
    effect: Effect.Effect<A, E, R>,
  ) => Promise<A>;
  startSchedulerService: () => Promise<void>;
  startRun: (
    input?: Partial<OrchestrationStartEpicRunInput>,
  ) => Promise<OrchestrationEpicRunControlResult>;
  drainScheduler: () => Promise<void>;
  cancelRun: (runId: EpicRunId) => Promise<OrchestrationEpicRunControlResult>;
  getSnapshot: () => Promise<OrchestrationReadModel>;
  getIssue: (issueId: string) => BeadsIssueDetail | null;
  patchIssue: (
    issueId: string,
    patch: Partial<
      Pick<BeadsIssueDetail, "status" | "assignee" | "owner" | "comments" | "priority">
    >,
  ) => void;
  patchThread: (
    threadId: ThreadId,
    patch: {
      latestTurn?: OrchestrationLatestTurn | null;
      session?: OrchestrationSession | null;
    },
  ) => void;
  patchWorkerThread: (
    threadId: ThreadId,
    patch: {
      latestTurn?: OrchestrationLatestTurn | null;
      session?: OrchestrationSession | null;
    },
  ) => void;
  setTrackerState: (next: TrackerState) => void;
  setTrackerStateSequence: (next: ReadonlyArray<TrackerState>) => void;
  getCreateEpicSwarmCallCount: () => number;
  getReadModelCallCount: () => number;
  patchReadModel: (transform: (current: OrchestrationReadModel) => OrchestrationReadModel) => void;
  patchExecution: (
    executionId: EpicIssueExecutionId,
    patch: Partial<OrchestrationEpicIssueExecution>,
  ) => void;
  injectExecutionDrift: (execution: OrchestrationEpicIssueExecution) => void;
};

export type SwarmExecutionWorkflowHarnessRuntime = {
  runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | SwarmExecutionWorkflow,
    unknown
  >;
  harness: SwarmExecutionWorkflowTestHarness;
  dispose: () => Promise<void>;
};

export async function createSwarmExecutionWorkflowHarness(
  initialTrackerState = makeTrackerState(),
  options: HarnessOptions = {},
): Promise<SwarmExecutionWorkflowHarnessRuntime> {
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
    listCoordinatorEpics: () =>
      Effect.sync(() =>
        [...issues.values()]
          .filter((issue) => issue.issueType === "epic" && issue.status !== "closed")
          .map((issue) => ({
            id: issue.id,
            title: issue.title,
            description: issue.description,
            notes: issue.notes,
            status: issue.status,
            priority: issue.priority,
            issueType: issue.issueType,
            assignee: issue.assignee,
            owner: issue.owner,
            createdAt: issue.createdAt,
            createdBy: issue.createdBy,
            updatedAt: issue.updatedAt,
            labels: issue.labels,
            parent: issue.parent,
            dependencyCount: issue.dependencyCount,
            dependentCount: issue.dependentCount,
            commentCount: issue.commentCount,
          })),
      ),
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
    listSwarmsWithSupport: () =>
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
    loadEpicCoordinatorTrackerState: ({ issueSummary }) =>
      Effect.sync(() => {
        const currentTrackerState = readTrackerStateSnapshot();
        return {
          issueSummary: issueSummary ?? null,
          validation: currentTrackerState.validation,
          status: currentTrackerState.status,
          validationError: null,
          statusError: null,
        };
      }),
    createIssue: () => Effect.fail(beadsError("unexpected createIssue call")),
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

  const runtime = ManagedRuntime.make(layer);
  const runPromise = <A, E, R extends OrchestrationEngineService | SwarmExecutionWorkflow>(
    effect: Effect.Effect<A, E, R>,
  ) => runtime.runPromise(effect);
  const engine = await runPromise(Effect.service(OrchestrationEngineService));
  const workflow = await runPromise(Effect.service(SwarmExecutionWorkflow));
  const projectId = asProjectId("project-1");

  await runPromise(
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

  const harness: SwarmExecutionWorkflowTestHarness = {
    engine,
    workflow,
    projectId,
    runPromise,
    startSchedulerService: () => runPromise(Effect.scoped(workflow.start)),
    startRun: (input = {}) =>
      runPromise(
        workflow.startEpicRun({
          projectId,
          epicIssueId: "EPIC-1",
          schedulerMode: "automatic",
          workspaceMode: "shared",
          runtimeMode: "full-access",
          ...input,
        }),
      ),
    drainScheduler: () => runPromise(workflow.drain),
    cancelRun: (runId) => runPromise(workflow.stopEpicRun({ runId: runId as never })),
    getSnapshot: () => runPromise(engine.getReadModel()),
    getIssue: (issueId: string) => issues.get(issueId) ?? null,
    patchIssue: (issueId, patch) => {
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
    patchThread: (threadId, patch) => {
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
    patchWorkerThread: (threadId, patch) => {
      harness.patchThread(threadId, patch);
    },
    setTrackerState: (next) => {
      trackerState = next;
      trackerStateSequence = null;
      pendingTrackerStateSnapshot = null;
      pendingTrackerStateReadsRemaining = 0;
    },
    setTrackerStateSequence: (next) => {
      trackerStateSequence = next;
      trackerState = next.at(-1) ?? trackerState;
      pendingTrackerStateSnapshot = null;
      pendingTrackerStateReadsRemaining = 0;
    },
    getCreateEpicSwarmCallCount: () => createEpicSwarmCallCount,
    getReadModelCallCount: () => readModelCallCount,
    patchReadModel: (transform) => {
      readModel = transform(readModel);
    },
    patchExecution: (executionId, patch) => {
      readModel = updateExecution(readModel, executionId, (execution) => ({
        ...execution,
        ...patch,
      }));
    },
    injectExecutionDrift: (execution) => {
      readModel = {
        ...readModel,
        epicIssueExecutions: [...readModel.epicIssueExecutions, execution],
      };
    },
  };

  return {
    runtime,
    harness,
    dispose: () => runtime.dispose(),
  };
}
