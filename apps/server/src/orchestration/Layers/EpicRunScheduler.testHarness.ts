import { Effect, Layer, ManagedRuntime, Stream } from "effect";

import {
  BeadsError,
  ProviderInstanceId,
  type BeadsIssueDetail,
  type BeadsIssueReferenceSummary,
  type BeadsEpicCoordinationStatus,
  type BeadsEpicCoordinationValidation,
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
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusLocalResult,
  TurnId,
} from "@t3tools/contracts";
import { createEpicRunFailureContext } from "@t3tools/shared/epicRun";
import { createModelCapabilities } from "@t3tools/shared/model";
import {
  BeadsTrackerService,
  type BeadsTrackerServiceShape,
} from "../../beads/Services/BeadsTrackerService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { EpicRunScheduler, type EpicRunSchedulerShape } from "../Services/EpicRunScheduler.ts";
import { GitManager, type GitManagerShape } from "../../git/GitManager.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { EpicRunSchedulerLive } from "./EpicRunScheduler.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

export const now = "2026-04-06T13:00:00.000Z";

export type TrackerState = {
  validation: BeadsEpicCoordinationValidation;
  status: BeadsEpicCoordinationStatus;
};

export type TrackerStateOverrides = {
  validation?: Partial<BeadsEpicCoordinationValidation>;
  status?: Partial<BeadsEpicCoordinationStatus>;
};

export type HarnessOptions = {
  failUpdateIssueForIds?: ReadonlyArray<string>;
  failDispatchForCommandTypes?: ReadonlyArray<OrchestrationCommand["type"]>;
  beforeGetIssue?: (issueId: string) => Effect.Effect<void>;
  git?: {
    isRepo?: boolean;
    changedFiles?: ReadonlyArray<string>;
    failCommitWith?: string;
    keepDirtyAfterCommit?: boolean;
  };
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
  const summary = {
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
    validation: {
      epicId: "EPIC-1",
      epicTitle: "Epic 1",
      summary,
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
      summary,
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
    dependencyRefs: [],
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
    terminalSource: "turn_completed",
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
    terminalSource: "turn_completed",
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
    terminalSource: "turn_completed",
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

    case "epic-run.fail":
      return updateRun(
        {
          ...readModel,
          snapshotSequence: sequence,
          updatedAt: command.createdAt,
        },
        command.runId,
        (run) => {
          const fallbackExecution =
            readModel.epicIssueExecutions
              .filter(
                (execution) => execution.runId === command.runId && execution.status === "failed",
              )
              .toSorted(
                (left, right) =>
                  right.sequenceNumber - left.sequenceNumber ||
                  right.updatedAt.localeCompare(left.updatedAt),
              )
              .at(0) ?? null;

          return {
            ...run,
            status: "failed",
            failedAt: command.createdAt,
            failureContext: createEpicRunFailureContext({
              reason: command.reason,
              issueId: command.issueId ?? fallbackExecution?.issueId ?? null,
              executionId: command.executionId ?? fallbackExecution?.executionId ?? null,
              workerThreadId: command.workerThreadId ?? fallbackExecution?.workerThreadId ?? null,
            }),
            updatedAt: command.createdAt,
          };
        },
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
          failureContext: createEpicRunFailureContext({
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

type EpicRunSchedulerTestHarness = {
  engine: Omit<OrchestrationEngineShape, "getReadModel"> & {
    getReadModel: () => Effect.Effect<OrchestrationReadModel, never, never>;
  };
  workflow: EpicRunSchedulerShape;
  projectId: ProjectId;
  runPromise: <A, E, R extends OrchestrationEngineService | EpicRunScheduler>(
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
  getReadModelCallCount: () => number;
  patchReadModel: (transform: (current: OrchestrationReadModel) => OrchestrationReadModel) => void;
  patchExecution: (
    executionId: EpicIssueExecutionId,
    patch: Partial<OrchestrationEpicIssueExecution>,
  ) => void;
  injectExecutionDrift: (execution: OrchestrationEpicIssueExecution) => void;
  setGitChangedFiles: (paths: ReadonlyArray<string>) => void;
  getGitCommitCalls: () => ReadonlyArray<GitRunStackedActionInput>;
  getDispatchedCommands: () => ReadonlyArray<OrchestrationCommand>;
  setGitCommitFailure: (message: string | null) => void;
  setGitKeepDirtyAfterCommit: (value: boolean) => void;
};

export type EpicRunSchedulerHarnessRuntime = {
  runtime: ManagedRuntime.ManagedRuntime<OrchestrationEngineService | EpicRunScheduler, unknown>;
  harness: EpicRunSchedulerTestHarness;
  dispose: () => Promise<void>;
};

export async function createEpicRunSchedulerHarness(
  initialTrackerState = makeTrackerState(),
  options: HarnessOptions = {},
): Promise<EpicRunSchedulerHarnessRuntime> {
  let trackerState = initialTrackerState;
  let trackerStateSequence: ReadonlyArray<TrackerState> | null = null;
  let pendingTrackerStateSnapshot: TrackerState | null = null;
  let pendingTrackerStateReadsRemaining = 0;
  let readModel = createEmptyReadModel();
  let readModelCallCount = 0;
  let sequence = 0;
  let gitChangedFiles = [...(options.git?.changedFiles ?? [])];
  let gitFailCommitWith = options.git?.failCommitWith ?? null;
  let gitKeepDirtyAfterCommit = options.git?.keepDirtyAfterCommit ?? false;
  const gitCommitCalls: GitRunStackedActionInput[] = [];
  const dispatchedCommands: OrchestrationCommand[] = [];
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

  const readTrackerStateSnapshot = (input?: { holdForPairedRead?: boolean }): TrackerState => {
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

    if (input?.holdForPairedRead) {
      pendingTrackerStateSnapshot = snapshot;
      pendingTrackerStateReadsRemaining = 2;
    }
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
            dependencyRefs: issue.dependencyRefs,
            dependencyCount: issue.dependencyCount,
            dependentCount: issue.dependentCount,
            commentCount: issue.commentCount,
          })),
      ),
    getIssueSummary: ({ issueId }) =>
      Effect.suspend(() => {
        const issue = issues.get(issueId);
        if (!issue) {
          return Effect.fail(beadsError(`Unknown issue '${issueId}'.`));
        }
        const { dependencies: _dependencies, comments: _comments, ...issueSummary } = issue;
        return Effect.succeed(issueSummary);
      }),
    getIssue: ({ issueId }) =>
      Effect.suspend(() => {
        const beforeGetIssue = options.beforeGetIssue?.(issueId) ?? Effect.void;
        const issue = issues.get(issueId);
        if (!issue) {
          return Effect.fail(beadsError(`Unknown issue '${issueId}'.`));
        }
        return beforeGetIssue.pipe(Effect.flatMap(() => Effect.succeed(issue)));
      }),
    getIssueWithoutComments: ({ issueId }) =>
      Effect.suspend(() => {
        const issue = issues.get(issueId);
        if (!issue) {
          return Effect.fail(beadsError(`Unknown issue '${issueId}'.`));
        }
        return Effect.succeed({
          ...issue,
          comments: [],
        });
      }),
    getIssuesWithoutComments: ({ issueIds }) =>
      Effect.gen(function* () {
        const result = [];
        for (const issueId of issueIds) {
          const issue = issues.get(issueId);
          if (!issue) {
            return yield* beadsError(`Unknown issue '${issueId}'.`);
          }
          result.push({
            ...issue,
            comments: [],
          });
        }
        return result;
      }),
    resolveIssueRefs: ({ issueIds }) =>
      Effect.sync(() => {
        const resolvedIssues: BeadsIssueReferenceSummary[] = [];
        const missingIssueIds: string[] = [];
        for (const issueId of issueIds) {
          const issue = issues.get(issueId);
          if (!issue) {
            missingIssueIds.push(issueId);
            continue;
          }
          resolvedIssues.push({
            id: issue.id,
            title: issue.title,
            status: issue.status,
            issueType: issue.issueType,
          });
        }
        return {
          issues: resolvedIssues,
          missingIssueIds,
          loadErrors: [],
        };
      }),
    getEpicIssueSummaries: ({ epicIssueId }) =>
      Effect.sync(() => {
        const currentTrackerState = readTrackerStateSnapshot();
        const summary = currentTrackerState.status.summary;

        return {
          epicId: epicIssueId,
          epicTitle: currentTrackerState.validation.epicTitle,
          progress: {
            totalIssueCount: summary?.totalIssueCount ?? 0,
            completedIssueCount: summary?.completedIssueCount ?? 0,
            readyIssueCount: summary?.readyIssueCount ?? 0,
            activeIssueCount: summary?.activeIssueCount ?? 0,
            blockedIssueCount: summary?.blockedIssueCount ?? 0,
            internalBlockedIssueCount: currentTrackerState.status.blockedBreakdown.internal.length,
            externalBlockedIssueCount: currentTrackerState.status.blockedBreakdown.external.length,
            unknownBlockedIssueCount: currentTrackerState.status.blockedBreakdown.unknown.length,
            activeWorkerCount: summary?.activeWorkerCount ?? 0,
            isComplete:
              (summary?.totalIssueCount ?? 0) > 0 &&
              (summary?.completedIssueCount ?? 0) >= (summary?.totalIssueCount ?? 0),
          },
          issues: [...issues.values()]
            .filter((issue) => issue.parent?.id === epicIssueId)
            .map(
              ({ dependencies: _dependencies, comments: _comments, ...issueSummary }) =>
                issueSummary,
            ),
        };
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
              author: "epic-run",
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
    getIssueGraph: () => Effect.fail(beadsError("unexpected getIssueGraph call")),
    validateEpicCoordination: () =>
      Effect.succeed(readTrackerStateSnapshot({ holdForPairedRead: true }).validation),
    getEpicCoordinationStatus: () =>
      Effect.succeed(readTrackerStateSnapshot({ holdForPairedRead: true }).status),
    loadEpicCoordinationState: ({ issueSummary }) =>
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

  const getReadModel = () =>
    Effect.sync(() => {
      readModelCallCount += 1;
      return readModel;
    });
  const engineService: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    dispatch: (command) =>
      Effect.sync(() => {
        if (options.failDispatchForCommandTypes?.includes(command.type)) {
          throw new Error(`Simulated dispatch failure for command '${command.type}'.`);
        }
        dispatchedCommands.push(command);
        sequence += 1;
        readModel = applyCommand(readModel, command, sequence);
        return { sequence };
      }),
  };

  const makeGitStatus = (): VcsStatusLocalResult => ({
    isRepo: options.git?.isRepo ?? true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/test",
    hasWorkingTreeChanges: gitChangedFiles.length > 0,
    workingTree: {
      files: gitChangedFiles.map((path) => ({
        path,
        insertions: 1,
        deletions: 0,
      })),
      insertions: gitChangedFiles.length,
      deletions: 0,
    },
  });

  const gitManagerService: GitManagerShape = {
    status: () =>
      Effect.succeed({
        ...makeGitStatus(),
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    localStatus: () => Effect.succeed(makeGitStatus()),
    remoteStatus: () =>
      Effect.succeed({
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    invalidateLocalStatus: () => Effect.void,
    invalidateRemoteStatus: () => Effect.void,
    invalidateStatus: () => Effect.void,
    resolvePullRequest: () => Effect.fail(new Error("unexpected resolvePullRequest call") as never),
    preparePullRequestThread: () =>
      Effect.fail(new Error("unexpected preparePullRequestThread call") as never),
    runStackedAction: (input) =>
      Effect.sync(() => {
        gitCommitCalls.push(input);
        if (gitFailCommitWith !== null) {
          throw new Error(gitFailCommitWith);
        }
        const hadChanges = gitChangedFiles.length > 0;
        if (!gitKeepDirtyAfterCommit) {
          gitChangedFiles = [];
        }
        return {
          action: input.action,
          branch: { status: "skipped_not_requested" },
          commit: hadChanges
            ? {
                status: "created",
                commitSha: "commit-sha-1",
                subject: input.commitMessage?.split("\n")[0] ?? "commit",
              }
            : { status: "skipped_no_changes" },
          push: { status: "skipped_not_requested" },
          pr: { status: "skipped_not_requested" },
          toast: {
            title: "Committed",
            cta: { kind: "none" },
          },
        } satisfies GitRunStackedActionResult;
      }),
  };

  const layer = EpicRunSchedulerLive.pipe(
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engineService)),
    Layer.provideMerge(
      Layer.succeed(ProjectionSnapshotQuery, {
        getCommandReadModel: getReadModel,
        getSnapshot: getReadModel,
        getShellSnapshot: () => Effect.die("unused"),
        getSnapshotSequence: () => Effect.succeed({ snapshotSequence: readModel.snapshotSequence }),
        getCounts: () => Effect.die("unused"),
        getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
        getProjectShellById: () => Effect.die("unused"),
        getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
        getThreadCheckpointContext: () => Effect.die("unused"),
        getThreadShellById: () => Effect.die("unused"),
        getThreadDetailById: () => Effect.die("unused"),
      }),
    ),
    Layer.provideMerge(Layer.succeed(BeadsTrackerService, trackerService)),
    Layer.provideMerge(Layer.succeed(GitManager, gitManagerService)),
    Layer.provideMerge(
      Layer.succeed(ProviderRegistry, {
        getProviders: Effect.succeed([
          {
            driver: "codex",
            instanceId: ProviderInstanceId.make("codex"),
            displayName: "Codex",
            enabled: true,
            installed: true,
            version: null,
            status: "ready",
            checkedAt: now,
            auth: { status: "authenticated", type: "apiKey", label: "OpenAI API Key" },
            models: [
              {
                slug: "gpt-5.4",
                name: "GPT-5.4",
                isCustom: false,
                capabilities: createModelCapabilities({
                  optionDescriptors: [
                    {
                      id: "reasoningEffort",
                      label: "Reasoning",
                      type: "select",
                      options: [
                        { id: "low", label: "Low" },
                        { id: "medium", label: "Medium", isDefault: true },
                      ],
                      currentValue: "medium",
                    },
                    {
                      id: "fastMode",
                      label: "Fast Mode",
                      type: "boolean",
                      currentValue: true,
                    },
                  ],
                }),
              },
            ],
            skills: [],
            slashCommands: [],
            showInteractionModeToggle: true,
          },
        ]),
        refresh: () => Effect.succeed([]),
        refreshInstance: () => Effect.succeed([]),
        streamChanges: Stream.never,
      } as any),
    ),
  );

  const runtime = ManagedRuntime.make(layer);
  const runPromise = <A, E, R extends OrchestrationEngineService | EpicRunScheduler>(
    effect: Effect.Effect<A, E, R>,
  ) => runtime.runPromise(effect);
  const engine = {
    ...(await runPromise(Effect.service(OrchestrationEngineService))),
    getReadModel,
  };
  const workflow = await runPromise(Effect.service(EpicRunScheduler));
  const projectId = asProjectId("project-1");

  await runPromise(
    engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-project"),
      projectId,
      title: "Project",
      workspaceRoot: "/repo/project",
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
      createdAt: now,
    }),
  );

  const harness: EpicRunSchedulerTestHarness = {
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
    setGitChangedFiles: (paths) => {
      gitChangedFiles = [...paths];
    },
    getGitCommitCalls: () => gitCommitCalls,
    getDispatchedCommands: () => dispatchedCommands,
    setGitCommitFailure: (message) => {
      gitFailCommitWith = message;
    },
    setGitKeepDirtyAfterCommit: (value) => {
      gitKeepDirtyAfterCommit = value;
    },
  };

  return {
    runtime,
    harness,
    dispose: () => runtime.dispose(),
  };
}
