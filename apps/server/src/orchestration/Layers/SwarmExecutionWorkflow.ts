import {
  CommandId,
  DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE,
  DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationEpicRun,
  type OrchestrationSwarmRunBlockedContext,
  type OrchestrationEpicRunControlResult,
  type OrchestrationSwarmRunStatus,
  type OrchestrationEpicIssueExecution,
} from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import { deriveExecutionBlocking, deriveSwarmRunExecutionState } from "@t3tools/shared/swarm";
import { Cause, Deferred, Duration, Effect, Fiber, Layer } from "effect";
import type { Scope } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import {
  decideReconcileCurrentExecution,
  decideReconcileRequestedExecution,
  workerThreadLaunchWasObserved,
  workerThreadStillHasActiveTurn,
} from "../ExecutionReconciler.ts";
import {
  describeExecutionInvariantViolation,
  describeIssueNotClosedForCompletedExecution,
  describeRequestedExecutionLaunchFailure,
  isClosedIssueStatus,
  truncateSwarmFailureDetail,
} from "../FailurePolicy.ts";
import { SwarmSchedulerError } from "../Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SwarmScheduler, type SwarmSchedulerShape } from "../Services/SwarmScheduler.ts";
import {
  countLaunchableReadyIssues,
  describeReadyIssueExhaustion,
  describeSharedWorkspaceProjectInvariantViolation,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
  getAttemptedIssueIds,
  isBackgroundSwarmSchedulerTrigger,
  selectLaunchableReadyIssue,
  shouldIdleSemiAutomaticRun,
  type SwarmDriveRequest,
  type SwarmSchedulerTrigger,
} from "../swarmSchedulerPolicy.ts";
import {
  buildSwarmExecutionComment,
  buildSwarmIssueLink,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerThreadTitle,
} from "../swarmWorker.ts";

const RECONCILIATION_INTERVAL = Duration.seconds(15);
const WORKER_STOP_POLL_INTERVAL = Duration.millis(250);
const WORKER_INTERRUPT_CONFIRM_TIMEOUT = Duration.seconds(3);
const WORKER_SESSION_STOP_CONFIRM_TIMEOUT = Duration.seconds(5);
const REQUESTED_EXECUTION_TIMEOUT = Duration.seconds(60);

interface StartSwarmTaskExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
  readonly issueId: string;
  readonly workerThreadId?: ThreadId;
  readonly sequenceNumber: number;
}

interface CompleteSwarmTaskExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
}

interface FailSwarmTaskExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
  readonly reason: string;
}

interface CancelSwarmTaskExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
}

type QueuedSwarmDriveRequest = SwarmDriveRequest & {
  readonly completion?: Deferred.Deferred<void, never>;
};

function workflowError(operation: string, detail: string, cause?: unknown): SwarmSchedulerError {
  return new SwarmSchedulerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isWorkflowExecutionError(error: unknown): error is SwarmSchedulerError {
  return (
    typeof error === "object" &&
    error !== null &&
    "operation" in error &&
    "detail" in error &&
    typeof error.operation === "string" &&
    typeof error.detail === "string"
  );
}

function serverCommandId(tag: string): CommandId {
  return CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
}

function nextRunId(): EpicRunId {
  return EpicRunId.makeUnsafe(crypto.randomUUID());
}

function nextExecutionId(): EpicIssueExecutionId {
  return EpicIssueExecutionId.makeUnsafe(crypto.randomUUID());
}

function nextThreadId(): ThreadId {
  return ThreadId.makeUnsafe(crypto.randomUUID());
}

function messageId(tag: string): MessageId {
  return MessageId.makeUnsafe(`${tag}:${crypto.randomUUID()}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalRunStatus(status: OrchestrationSwarmRunStatus): boolean {
  return status === "failed" || status === "stopped" || status === "completed";
}

function isNonTerminalRunStatus(status: OrchestrationSwarmRunStatus): boolean {
  return !isTerminalRunStatus(status);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function asControlResult(run: OrchestrationEpicRun): OrchestrationEpicRunControlResult {
  return {
    runId: run.runId,
    status: run.status,
  };
}

function describeBlockedReason(input: {
  readonly internalBlockedCount: number;
  readonly externalBlockedCount: number;
  readonly unknownBlockedCount: number;
  readonly activeCount: number;
}): string {
  if (input.externalBlockedCount > 0) {
    return `Swarm has ${input.externalBlockedCount} externally blocked issue${input.externalBlockedCount === 1 ? "" : "s"} and execution is halted until those dependencies are resolved.`;
  }
  if (input.unknownBlockedCount > 0) {
    return `Swarm has ${input.unknownBlockedCount} blocked issue${input.unknownBlockedCount === 1 ? "" : "s"} with unclassified blocker provenance and execution is halted until tracker state is clarified.`;
  }
  if (input.activeCount > 0) {
    return `Swarm has ${input.activeCount} externally active issue${input.activeCount === 1 ? "" : "s"} and no ready issue is available.`;
  }
  if (input.internalBlockedCount > 0) {
    return `Swarm is waiting on ${input.internalBlockedCount} internally blocked issue${input.internalBlockedCount === 1 ? "" : "s"} and no ready issue is available.`;
  }
  return "Swarm has no ready issue available.";
}

function trackerWaitingBlockedContext(): OrchestrationSwarmRunBlockedContext {
  return {
    kind: "tracker_waiting",
    issueId: null,
    executionId: null,
    workerThreadId: null,
  };
}

function workerFailureBlockedContext(input: {
  readonly issueId: string;
  readonly executionId?: EpicIssueExecutionId;
  readonly workerThreadId?: ThreadId;
}): OrchestrationSwarmRunBlockedContext {
  return {
    kind: "worker_failure",
    issueId: input.issueId,
    executionId: input.executionId ?? null,
    workerThreadId: input.workerThreadId ?? null,
  };
}

function getRunSchedulerMode(): typeof DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE {
  return DEFAULT_ORCHESTRATION_SWARM_SCHEDULER_MODE;
}

function getRunWorkspaceMode(): typeof DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE {
  return DEFAULT_ORCHESTRATION_SWARM_WORKSPACE_MODE;
}

function workerTurnStopped(input: Parameters<typeof workerThreadStillHasActiveTurn>[0]): boolean {
  return !workerThreadStillHasActiveTurn(input);
}

function prioritizeDriveRequests(
  requests: ReadonlyArray<QueuedSwarmDriveRequest>,
): Array<QueuedSwarmDriveRequest> {
  const manual: Array<QueuedSwarmDriveRequest> = [];
  const lifecycle: Array<QueuedSwarmDriveRequest> = [];
  const background: Array<QueuedSwarmDriveRequest> = [];

  for (const request of requests) {
    if (isBackgroundSwarmSchedulerTrigger(request.trigger)) {
      background.push(request);
      continue;
    }

    if (request.trigger === "execution_settled" || request.trigger === "worker_state_changed") {
      lifecycle.push(request);
      continue;
    }

    manual.push(request);
  }

  return [...manual, ...lifecycle, ...background];
}

const makeSwarmScheduler = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const beadsTracker = yield* BeadsTrackerService;
  const activeProjectFibers = new Map<OrchestrationProject["id"], Fiber.Fiber<void, never>>();

  type DispatchInput = Parameters<typeof orchestrationEngine.dispatch>[0];

  const dispatchOrFail = (operation: string, command: DispatchInput) =>
    orchestrationEngine
      .dispatch(command)
      .pipe(
        Effect.mapError((error) =>
          workflowError(operation, truncateSwarmFailureDetail(toErrorMessage(error)), error),
        ),
      );

  const getReadModel = () => orchestrationEngine.getReadModel();
  let enqueueProjectRequest:
    | ((
        projectId: OrchestrationProject["id"],
        request: SwarmDriveRequest,
      ) => Effect.Effect<void, never, never>)
    | null = null;

  const scheduleDriveRequest = (
    projectId: OrchestrationProject["id"],
    request: SwarmDriveRequest,
  ) => (enqueueProjectRequest ? enqueueProjectRequest(projectId, request) : Effect.void);

  const getProjectById = (projectId: OrchestrationProject["id"]) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const project =
          readModel.projects.find((entry) => entry.id === projectId && entry.deletedAt === null) ??
          null;
        return project
          ? Effect.succeed(project)
          : Effect.fail(workflowError("getProjectById", `Project '${projectId}' was not found.`));
      }),
    );

  const getRunById = (runId: EpicRunId) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const run = readModel.epicRuns.find((entry) => entry.runId === runId) ?? null;
        return run
          ? Effect.succeed(run)
          : Effect.fail(workflowError("getRunById", `Swarm run '${runId}' was not found.`));
      }),
    );

  const getRunsForProject = (projectId: OrchestrationProject["id"]) =>
    getReadModel().pipe(
      Effect.map((readModel) => readModel.epicRuns.filter((run) => run.projectId === projectId)),
    );

  const getExecutionsForRun = (runId: EpicRunId) =>
    getReadModel().pipe(
      Effect.map((readModel) =>
        readModel.epicIssueExecutions.filter((execution) => execution.runId === runId),
      ),
    );

  const getExecutionById = (executionId: StartSwarmTaskExecutionInput["executionId"]) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const execution =
          readModel.epicIssueExecutions.find((entry) => entry.executionId === executionId) ?? null;
        return execution
          ? Effect.succeed(execution)
          : Effect.fail(
              workflowError(
                "getExecutionById",
                `Swarm task execution '${executionId}' was not found.`,
              ),
            );
      }),
    );

  const getRunExecutionState = (runId: EpicRunId) =>
    getReadModel().pipe(
      Effect.map((readModel) =>
        deriveSwarmRunExecutionState({
          runId,
          executions: readModel.epicIssueExecutions,
        }),
      ),
    );

  const enforceSharedWorkspaceExecutionInvariant = (operation: string, run: OrchestrationEpicRun) =>
    Effect.gen(function* () {
      const { nonTerminalExecutions } = yield* getRunExecutionState(run.runId);
      if (nonTerminalExecutions.length === 0) {
        return { ok: true as const };
      }

      if (nonTerminalExecutions.length !== 1) {
        const reason = describeExecutionInvariantViolation({
          runId: run.runId,
          nonTerminalExecutions,
        });
        yield* failRun(run.runId, reason);
        return { ok: false as const, run: yield* getRunById(run.runId) };
      }

      const [execution] = nonTerminalExecutions;
      return { ok: true as const, execution };
    }).pipe(
      Effect.mapError((error) =>
        isWorkflowExecutionError(error)
          ? error
          : workflowError(operation, truncateSwarmFailureDetail(toErrorMessage(error)), error),
      ),
    );

  const enforceSharedWorkspaceProjectInvariant = (
    operation: string,
    projectId: OrchestrationProject["id"],
  ) =>
    Effect.gen(function* () {
      const projectRuns = yield* getRunsForProject(projectId);
      const invariant = evaluateSharedWorkspaceProjectInvariant(projectRuns);
      const winner = invariant.winner;
      if (winner === null) {
        return { winner: null as OrchestrationEpicRun | null };
      }

      for (const loser of invariant.losers) {
        yield* failRun(
          loser.runId,
          describeSharedWorkspaceProjectInvariantViolation({
            projectId,
            winner,
            loser,
          }),
        );
      }

      return { winner: yield* getRunById(winner.runId) };
    }).pipe(
      Effect.mapError((error) =>
        isWorkflowExecutionError(error)
          ? error
          : workflowError(operation, truncateSwarmFailureDetail(toErrorMessage(error)), error),
      ),
    );

  const getThreadById = (threadId: ThreadId) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const thread =
          readModel.threads.find((entry) => entry.id === threadId && entry.deletedAt === null) ??
          null;
        return thread
          ? Effect.succeed(thread)
          : Effect.fail(workflowError("getThreadById", `Thread '${threadId}' was not found.`));
      }),
    );

  const getThreadByIdOption = (threadId: ThreadId) => Effect.option(getThreadById(threadId));

  const deleteWorkerThreadIfIdle = (threadId: ThreadId) =>
    getThreadByIdOption(threadId).pipe(
      Effect.flatMap((thread) => {
        if (thread._tag === "None") {
          return Effect.void;
        }

        if (
          workerThreadLaunchWasObserved({
            latestTurnState: thread.value.latestTurn?.state,
            sessionActiveTurnId: thread.value.session?.activeTurnId,
          })
        ) {
          return Effect.void;
        }

        return deleteWorkerThread(threadId).pipe(Effect.catch(() => Effect.void));
      }),
    );

  const awaitWorkerStopConfirmation = (input: {
    readonly threadId: ThreadId;
    readonly timeout: Duration.Duration;
  }) => {
    const deadline = Date.now() + Duration.toMillis(input.timeout);
    const poll = (): Effect.Effect<any, SwarmSchedulerError> =>
      getThreadByIdOption(input.threadId).pipe(
        Effect.flatMap((thread) => {
          if (thread._tag === "None") {
            return Effect.succeed(null);
          }

          if (
            workerTurnStopped({
              latestTurnState: thread.value.latestTurn?.state,
              sessionActiveTurnId: thread.value.session?.activeTurnId,
            })
          ) {
            return Effect.succeed(thread.value);
          }

          if (Date.now() >= deadline) {
            return Effect.fail(
              workflowError(
                "awaitWorkerStopConfirmation",
                `Worker thread '${input.threadId}' did not confirm stop before timeout.`,
              ),
            );
          }

          return Effect.sleep(WORKER_STOP_POLL_INTERVAL).pipe(Effect.flatMap(() => poll()));
        }),
        Effect.mapError((error) =>
          isWorkflowExecutionError(error)
            ? error
            : workflowError(
                "awaitWorkerStopConfirmation",
                truncateSwarmFailureDetail(toErrorMessage(error)),
                error,
              ),
        ),
      );

    return poll();
  };

  const confirmWorkerExecutionStopped = (input: {
    readonly operation: string;
    readonly runId: EpicRunId;
    readonly executionId: EpicIssueExecutionId;
    readonly workerThreadId: ThreadId | null;
  }) =>
    Effect.gen(function* () {
      if (input.workerThreadId === null) {
        return;
      }

      yield* interruptWorkerThread(input.workerThreadId).pipe(Effect.catch(() => Effect.void));

      const stoppedAfterInterrupt = yield* Effect.exit(
        awaitWorkerStopConfirmation({
          threadId: input.workerThreadId,
          timeout: WORKER_INTERRUPT_CONFIRM_TIMEOUT,
        }),
      );

      if (stoppedAfterInterrupt._tag === "Success") {
        return;
      }

      yield* stopWorkerThreadSession(input.workerThreadId).pipe(Effect.catch(() => Effect.void));

      const stoppedAfterSessionStop = yield* Effect.exit(
        awaitWorkerStopConfirmation({
          threadId: input.workerThreadId,
          timeout: WORKER_SESSION_STOP_CONFIRM_TIMEOUT,
        }),
      );

      if (stoppedAfterSessionStop._tag === "Success") {
        return;
      }

      return yield* workflowError(
        input.operation,
        `Swarm run '${input.runId}' could not confirm that worker thread '${input.workerThreadId}' for execution '${input.executionId}' stopped after interrupt and session-stop escalation.`,
      );
    });

  const getExistingRunForEpic = (input: {
    projectId: OrchestrationProject["id"];
    epicIssueId: string;
  }) =>
    getReadModel().pipe(
      Effect.map(
        (readModel) =>
          readModel.epicRuns.find(
            (run) =>
              run.projectId === input.projectId &&
              run.epicIssueId === input.epicIssueId &&
              isNonTerminalRunStatus(run.status),
          ) ?? null,
      ),
    );

  const getEffectiveModelSelection = (
    project: OrchestrationProject,
    input: SwarmSchedulerShape["startEpicRun"] extends (
      input: infer I,
    ) => Effect.Effect<any, any, any>
      ? I
      : never,
  ) => {
    const provider = input.provider ?? project.defaultModelSelection?.provider ?? "codex";
    const model =
      input.model ?? project.defaultModelSelection?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    return { provider, model } as const;
  };

  const getTrackerState = (input: { projectId: OrchestrationProject["id"]; epicIssueId: string }) =>
    Effect.gen(function* () {
      const project = yield* getProjectById(input.projectId);
      const cwd = project.workspaceRoot;
      const [support, validation, status] = yield* Effect.all(
        [
          beadsTracker.getSwarmSupport({ cwd }),
          beadsTracker.validateEpicSwarm({
            cwd,
            epicIssueId: input.epicIssueId,
          }),
          beadsTracker.getEpicSwarmStatus({
            cwd,
            epicIssueId: input.epicIssueId,
          }),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError((error) =>
          workflowError(
            "getTrackerState",
            truncateSwarmFailureDetail(toErrorMessage(error)),
            error,
          ),
        ),
      );

      return {
        project,
        support,
        validation,
        status,
        nextReadyIssue: selectLaunchableReadyIssue({
          readyIssues: status.ready,
          attemptedIssueIds: new Set(),
        }),
      } as const;
    });

  const getIssueById = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly issueId: string;
  }) =>
    beadsTracker
      .getIssue({
        cwd: input.cwd,
        issueId: input.issueId,
      })
      .pipe(
        Effect.mapError((error) =>
          workflowError(input.operation, truncateSwarmFailureDetail(toErrorMessage(error)), error),
        ),
      );

  const getWorkerExecutionContext = (runId: EpicRunId, executionId: EpicIssueExecutionId) =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      const project = yield* getProjectById(run.projectId);
      const execution = yield* getExecutionById(executionId);
      return {
        run,
        project,
        execution,
        cwd: project.workspaceRoot,
      } as const;
    });

  const restoreIssueFromExecutionSnapshot = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly execution: OrchestrationEpicIssueExecution;
  }) =>
    getIssueById({
      operation: `${input.operation}:getIssue`,
      cwd: input.cwd,
      issueId: input.execution.issueId,
    });

  const syncIssueForExecutionSettlement = (input: {
    readonly phase: "completed" | "failed" | "cancelled";
    readonly cwd: string;
    readonly run: OrchestrationEpicRun;
    readonly execution: OrchestrationEpicIssueExecution;
    readonly reason?: string;
  }) =>
    Effect.gen(function* () {
      if (input.phase !== "completed") {
        yield* restoreIssueFromExecutionSnapshot({
          operation: "syncIssueForExecutionSettlement:restoreIssue",
          cwd: input.cwd,
          execution: input.execution,
        });
      }

      if (input.execution.workerThreadId !== null) {
        yield* beadsTracker
          .commentIssue({
            cwd: input.cwd,
            issueId: input.execution.issueId,
            text: buildSwarmExecutionComment({
              phase: input.phase,
              epicIssueId: input.run.epicIssueId,
              runId: input.run.runId,
              executionId: input.execution.executionId,
              workerThreadId: input.execution.workerThreadId,
              schedulerMode: getRunSchedulerMode(),
              workspaceMode: getRunWorkspaceMode(),
              ...(input.reason ? { reason: input.reason } : {}),
            }),
          })
          .pipe(
            Effect.mapError((error) =>
              workflowError(
                "syncIssueForExecutionSettlement:commentIssue",
                truncateSwarmFailureDetail(toErrorMessage(error)),
                error,
              ),
            ),
          );
      }
    });

  const cleanupFailedRequestedExecutionLaunch = (input: {
    readonly run: OrchestrationEpicRun;
    readonly project: OrchestrationProject;
    readonly executionId: EpicIssueExecutionId;
    readonly issueId: string;
    readonly workerThreadId: ThreadId | null;
    readonly reason: string;
  }) =>
    Effect.gen(function* () {
      const execution = yield* Effect.option(getExecutionById(input.executionId));
      if (execution._tag === "Some") {
        yield* syncIssueForExecutionSettlement({
          phase: "failed",
          cwd: input.project.workspaceRoot,
          run: input.run,
          execution: execution.value,
          reason: input.reason,
        }).pipe(Effect.catch(() => Effect.void));

        yield* failTaskExecutionCommand({
          runId: input.run.runId,
          executionId: input.executionId,
          reason: input.reason,
        }).pipe(Effect.catch(() => Effect.void));

        if (input.workerThreadId !== null) {
          yield* deleteWorkerThreadIfIdle(input.workerThreadId);
        }
      } else {
        if (input.workerThreadId !== null) {
          yield* deleteWorkerThreadIfIdle(input.workerThreadId);
        }
      }

      yield* blockRun(
        input.run.runId,
        input.reason,
        workerFailureBlockedContext({
          issueId: input.issueId,
          executionId: input.executionId,
          ...(input.workerThreadId ? { workerThreadId: input.workerThreadId } : {}),
        }),
      );

      return yield* getRunById(input.run.runId);
    });

  const requireStartableTrackerState = (
    operation: string,
    input: { projectId: OrchestrationProject["id"]; epicIssueId: string },
  ) =>
    getTrackerState(input).pipe(
      Effect.flatMap((trackerState) => {
        if (!trackerState.support.supported) {
          return Effect.fail(
            workflowError(
              operation,
              trackerState.support.reason ?? "Swarm execution is not supported in this project.",
            ),
          );
        }

        if (!trackerState.validation.valid) {
          const detail = trackerState.validation.errors.join("; ") || "Swarm validation failed.";
          return Effect.fail(
            workflowError(operation, `Cannot start swarm for ${input.epicIssueId}: ${detail}`),
          );
        }

        return Effect.succeed(trackerState);
      }),
    );

  const markRunStarted = (runId: EpicRunId) =>
    dispatchOrFail("markRunStarted", {
      type: "swarm-run.mark-started",
      commandId: serverCommandId("swarm-run-mark-started"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const markRunIdle = (runId: EpicRunId) =>
    dispatchOrFail("markRunIdle", {
      type: "swarm-run.mark-idle",
      commandId: serverCommandId("swarm-run-mark-idle"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const blockRun = (
    runId: EpicRunId,
    reason: string,
    blockedContext: OrchestrationSwarmRunBlockedContext = trackerWaitingBlockedContext(),
  ) =>
    dispatchOrFail("blockRun", {
      type: "swarm-run.block",
      commandId: serverCommandId("swarm-run-block"),
      runId,
      reason: truncateSwarmFailureDetail(reason, 500),
      blockedContext,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const failRun = (runId: EpicRunId, reason: string) =>
    Effect.gen(function* () {
      const run = yield* Effect.option(getRunById(runId));
      if (run._tag === "Some" && isTerminalRunStatus(run.value.status)) {
        return;
      }

      yield* dispatchOrFail("failRun", {
        type: "swarm-run.fail",
        commandId: serverCommandId("swarm-run-fail"),
        runId,
        reason: truncateSwarmFailureDetail(reason, 500),
        createdAt: nowIso(),
      }).pipe(Effect.asVoid);
    });

  const completeRun = (runId: EpicRunId) =>
    dispatchOrFail("completeRun", {
      type: "swarm-run.complete",
      commandId: serverCommandId("swarm-run-complete"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const cancelRun = (runId: EpicRunId) =>
    dispatchOrFail("cancelRun", {
      type: "swarm-run.cancel",
      commandId: serverCommandId("swarm-run-cancel"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const requestTaskExecutionCommand = (input: {
    readonly runId: EpicRunId;
    readonly executionId: EpicIssueExecutionId;
    readonly issueId: string;
    readonly workerThreadId: ThreadId;
    readonly sequenceNumber: number;
    readonly originalStatus: string;
    readonly originalAssignee: string | null;
  }) =>
    dispatchOrFail("requestTaskExecutionCommand", {
      type: "swarm-task-execution.request",
      commandId: serverCommandId("swarm-task-execution-request"),
      executionId: input.executionId,
      runId: input.runId,
      issueId: input.issueId,
      workerThreadId: input.workerThreadId,
      sequenceNumber: input.sequenceNumber,
      originalStatus: input.originalStatus,
      originalAssignee: input.originalAssignee,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const startTaskExecutionCommand = (input: StartSwarmTaskExecutionInput) =>
    dispatchOrFail("startTaskExecutionCommand", {
      type: "swarm-task-execution.start",
      commandId: serverCommandId("swarm-task-execution-start"),
      executionId: input.executionId,
      runId: input.runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const promoteRequestedExecutionIfWorkerObserved = (input: {
    readonly runId: EpicRunId;
    readonly executionId: EpicIssueExecutionId;
    readonly issueId: string;
    readonly workerThreadId: ThreadId;
    readonly sequenceNumber: number;
  }) =>
    getThreadByIdOption(input.workerThreadId).pipe(
      Effect.flatMap((thread) => {
        if (thread._tag === "None") {
          return Effect.void;
        }

        if (
          !workerThreadStillHasActiveTurn({
            latestTurnState: thread.value.latestTurn?.state,
            sessionActiveTurnId: thread.value.session?.activeTurnId,
          })
        ) {
          return Effect.void;
        }

        return startTaskExecutionCommand({
          runId: input.runId,
          executionId: input.executionId,
          issueId: input.issueId,
          workerThreadId: input.workerThreadId,
          sequenceNumber: input.sequenceNumber,
        });
      }),
    );

  const completeTaskExecutionCommand = (input: CompleteSwarmTaskExecutionInput) =>
    dispatchOrFail("completeTaskExecutionCommand", {
      type: "swarm-task-execution.complete",
      commandId: serverCommandId("swarm-task-execution-complete"),
      executionId: input.executionId,
      runId: input.runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const failTaskExecutionCommand = (input: FailSwarmTaskExecutionInput) =>
    dispatchOrFail("failTaskExecutionCommand", {
      type: "swarm-task-execution.fail",
      commandId: serverCommandId("swarm-task-execution-fail"),
      executionId: input.executionId,
      runId: input.runId,
      reason: truncateSwarmFailureDetail(input.reason, 500),
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const cancelTaskExecutionCommand = (input: CancelSwarmTaskExecutionInput) =>
    dispatchOrFail("cancelTaskExecutionCommand", {
      type: "swarm-task-execution.cancel",
      commandId: serverCommandId("swarm-task-execution-cancel"),
      executionId: input.executionId,
      runId: input.runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const createWorkerThread = (input: {
    readonly run: OrchestrationEpicRun;
    readonly project: OrchestrationProject;
    readonly threadId: ThreadId;
    readonly issueLink: ReturnType<typeof buildSwarmIssueLink>;
    readonly title: string;
  }) => {
    const provider = input.run.provider ?? "codex";
    const model = input.run.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    return dispatchOrFail("createWorkerThread", {
      type: "thread.create",
      commandId: serverCommandId("swarm-worker-thread-create"),
      threadId: input.threadId,
      projectId: input.project.id,
      title: input.title,
      modelSelection: {
        provider,
        model,
      },
      runtimeMode: input.run.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      issueLink: input.issueLink,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);
  };

  const deleteWorkerThread = (threadId: ThreadId) =>
    dispatchOrFail("deleteWorkerThread", {
      type: "thread.delete",
      commandId: serverCommandId("swarm-worker-thread-delete"),
      threadId,
    }).pipe(Effect.asVoid);

  const interruptWorkerThread = (threadId: ThreadId) =>
    dispatchOrFail("interruptWorkerThread", {
      type: "thread.turn.interrupt",
      commandId: serverCommandId("swarm-worker-thread-interrupt"),
      threadId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const stopWorkerThreadSession = (threadId: ThreadId) =>
    dispatchOrFail("stopWorkerThreadSession", {
      type: "thread.session.stop",
      commandId: serverCommandId("swarm-worker-thread-session-stop"),
      threadId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const startWorkerThreadTurn = (input: {
    readonly run: OrchestrationEpicRun;
    readonly threadId: ThreadId;
    readonly promptText: string;
    readonly title: string;
  }) => {
    const provider = input.run.provider ?? "codex";
    const model = input.run.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    return dispatchOrFail("startWorkerThreadTurn", {
      type: "thread.turn.start",
      commandId: serverCommandId("swarm-worker-thread-turn-start"),
      threadId: input.threadId,
      message: {
        messageId: messageId("swarm-worker"),
        role: "user",
        text: input.promptText,
        attachments: [],
      },
      modelSelection: {
        provider,
        model,
      },
      titleSeed: input.title,
      runtimeMode: input.run.runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);
  };

  const nextExecutionSequenceNumber = (runId: EpicRunId) =>
    getReadModel().pipe(
      Effect.map(
        (readModel) =>
          readModel.epicIssueExecutions.filter((execution) => execution.runId === runId).length + 1,
      ),
    );

  const launchNextTaskExecution = (input: {
    readonly runId: EpicRunId;
    readonly trigger: SwarmSchedulerTrigger;
  }) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (isTerminalRunStatus(run.status) || currentExecution !== null) {
        return run;
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant(
        "launchNextTaskExecution",
        run,
      );
      if (!invariant.ok) {
        return invariant.run;
      }

      const project = yield* getProjectById(run.projectId);
      const trackerStatus = yield* beadsTracker
        .getEpicSwarmStatus({
          cwd: project.workspaceRoot,
          epicIssueId: run.epicIssueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "launchNextTaskExecution:getEpicSwarmStatus",
              truncateSwarmFailureDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

      const executionBlocking = deriveExecutionBlocking(trackerStatus);
      if (executionBlocking.hasExecutionBlockingIssues) {
        yield* blockRun(
          run.runId,
          describeBlockedReason({
            internalBlockedCount: executionBlocking.internalBlockedIssues.length,
            externalBlockedCount: executionBlocking.externalBlockedIssues.length,
            unknownBlockedCount: executionBlocking.unknownBlockedIssues.length,
            activeCount: trackerStatus.active.length,
          }),
          trackerWaitingBlockedContext(),
        );
        return yield* getRunById(run.runId);
      }

      if (trackerStatus.active.length > 0) {
        yield* blockRun(
          run.runId,
          describeBlockedReason({
            internalBlockedCount: executionBlocking.internalBlockedIssues.length,
            externalBlockedCount: executionBlocking.externalBlockedIssues.length,
            unknownBlockedCount: executionBlocking.unknownBlockedIssues.length,
            activeCount: trackerStatus.active.length,
          }),
          trackerWaitingBlockedContext(),
        );
        return yield* getRunById(run.runId);
      }

      const executions = yield* getExecutionsForRun(run.runId);
      const executionState = evaluateRunExecutionInvariant({
        runId: run.runId,
        executions,
      });
      const attemptedIssueIds = getAttemptedIssueIds(executions);

      if (
        shouldIdleSemiAutomaticRun({
          schedulerMode: null,
          latestExecution: executionState.latestExecution,
          trigger: input.trigger,
        })
      ) {
        if (run.status !== "running") {
          yield* markRunIdle(run.runId);
        }
        return yield* getRunById(run.runId);
      }

      const nextReadyIssue = selectLaunchableReadyIssue({
        readyIssues: trackerStatus.ready,
        attemptedIssueIds,
      });

      if (!nextReadyIssue) {
        if (
          trackerStatus.ready.length > 0 &&
          countLaunchableReadyIssues({
            readyIssues: trackerStatus.ready,
            attemptedIssueIds,
          }) === 0
        ) {
          yield* blockRun(
            run.runId,
            describeReadyIssueExhaustion({
              runId: run.runId,
              attemptedIssueIds,
              readyIssues: trackerStatus.ready,
            }),
            trackerWaitingBlockedContext(),
          );
          return yield* getRunById(run.runId);
        }

        if (trackerStatus.blocked.length > 0) {
          yield* blockRun(
            run.runId,
            describeBlockedReason({
              internalBlockedCount: executionBlocking.internalBlockedIssues.length,
              externalBlockedCount: executionBlocking.externalBlockedIssues.length,
              unknownBlockedCount: executionBlocking.unknownBlockedIssues.length,
              activeCount: trackerStatus.active.length,
            }),
            trackerWaitingBlockedContext(),
          );
          return yield* getRunById(run.runId);
        }

        yield* completeRun(run.runId);
        return yield* getRunById(run.runId);
      }

      yield* Effect.logDebug("swarm run launching next task execution").pipe(
        Effect.annotateLogs({
          runId: run.runId,
          issueId: nextReadyIssue.id,
          schedulerMode: getRunSchedulerMode(),
        }),
      );

      const issueId = nextReadyIssue.id;
      const cwd = project.workspaceRoot;
      const workerThreadId = nextThreadId();
      const executionId = nextExecutionId();
      const sequenceNumber = yield* nextExecutionSequenceNumber(run.runId);
      const threadTitle = buildSwarmWorkerThreadTitle(nextReadyIssue);

      let threadCreated = false;
      let executionRequested = false;
      let turnStartDispatched = false;

      const launchAttempt = Effect.gen(function* () {
        yield* createWorkerThread({
          run,
          project,
          threadId: workerThreadId,
          title: threadTitle,
          issueLink: buildSwarmIssueLink({
            issue: nextReadyIssue,
            cwd,
            linkedAt: nowIso(),
          }),
        });
        threadCreated = true;

        yield* requestTaskExecutionCommand({
          runId: run.runId,
          executionId,
          issueId,
          workerThreadId,
          sequenceNumber,
          originalStatus: nextReadyIssue.status,
          originalAssignee: nextReadyIssue.assignee,
        });
        executionRequested = true;

        yield* startWorkerThreadTurn({
          run,
          threadId: workerThreadId,
          title: threadTitle,
          promptText: buildSwarmWorkerPrompt({
            issueId,
            issueTitle: nextReadyIssue.title,
            epicIssueId: run.epicIssueId,
            runId: run.runId,
            executionId,
            schedulerMode: getRunSchedulerMode(),
            workspaceMode: getRunWorkspaceMode(),
            sequenceNumber,
          }),
        });
        turnStartDispatched = true;

        yield* promoteRequestedExecutionIfWorkerObserved({
          runId: run.runId,
          executionId,
          issueId,
          workerThreadId,
          sequenceNumber,
        });

        return yield* getRunById(run.runId);
      });

      return yield* launchAttempt.pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const detail = error.detail ?? toErrorMessage(error);
            const reason = truncateSwarmFailureDetail(
              describeRequestedExecutionLaunchFailure({
                executionId,
                issueId,
                workerThreadId: threadCreated ? workerThreadId : null,
                reason: detail,
              }),
              500,
            );

            if (executionRequested && !turnStartDispatched) {
              return yield* cleanupFailedRequestedExecutionLaunch({
                run,
                project,
                executionId,
                issueId,
                workerThreadId,
                reason,
              });
            }

            if (!executionRequested && threadCreated) {
              yield* deleteWorkerThreadIfIdle(workerThreadId);
            }

            yield* blockRun(
              run.runId,
              reason,
              workerFailureBlockedContext({
                issueId,
                ...(executionRequested ? { executionId } : {}),
                ...(threadCreated ? { workerThreadId } : {}),
              }),
            );

            return yield* getRunById(run.runId);
          }),
        ),
      );
    });

  const reconcileRequestedTaskExecution = (input: {
    readonly run: OrchestrationEpicRun;
    readonly execution: OrchestrationEpicIssueExecution;
  }): Effect.Effect<OrchestrationEpicRun, SwarmSchedulerError> =>
    Effect.gen(function* () {
      const project = yield* getProjectById(input.run.projectId);
      const threadOption =
        input.execution.workerThreadId === null
          ? null
          : yield* getThreadByIdOption(input.execution.workerThreadId);
      const decision = decideReconcileRequestedExecution({
        execution: input.execution,
        thread: threadOption?._tag === "Some" ? threadOption.value : null,
        nowMs: Date.now(),
        launchTimeoutMs: Duration.toMillis(REQUESTED_EXECUTION_TIMEOUT),
      });

      switch (decision.type) {
        case "cleanup_failed_launch":
          return yield* cleanupFailedRequestedExecutionLaunch({
            run: input.run,
            project,
            executionId: input.execution.executionId,
            issueId: input.execution.issueId,
            workerThreadId: input.execution.workerThreadId,
            reason: truncateSwarmFailureDetail(decision.reason, 500),
          });
        case "complete":
          yield* completeSwarmTaskExecution({
            runId: input.run.runId,
            executionId: input.execution.executionId,
          });
          return yield* driveRun({
            runId: input.run.runId,
            trigger: "execution_settled",
          });
        case "fail":
          yield* failSwarmTaskExecution({
            runId: input.run.runId,
            executionId: input.execution.executionId,
            reason: decision.reason,
          });
          return yield* getRunById(input.run.runId);
        case "promote_to_active":
          yield* startTaskExecutionCommand({
            runId: input.run.runId,
            executionId: input.execution.executionId,
            issueId: input.execution.issueId,
            workerThreadId: input.execution.workerThreadId!,
            sequenceNumber: input.execution.sequenceNumber,
          });
          return yield* getRunById(input.run.runId);
        case "noop":
          return yield* getRunById(input.run.runId);
      }
    });

  const reconcileCurrentTaskExecution = (
    runId: EpicRunId,
  ): Effect.Effect<OrchestrationEpicRun, SwarmSchedulerError> =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution === null || isTerminalRunStatus(run.status)) {
        return run;
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant(
        "reconcileCurrentTaskExecution",
        run,
      );
      if (!invariant.ok) {
        return invariant.run;
      }

      const execution = invariant.execution;
      if (!execution) {
        return yield* workflowError(
          "reconcileCurrentTaskExecution",
          `Swarm run '${run.runId}' passed execution invariant checks without a current execution.`,
        );
      }

      const threadOption =
        execution.workerThreadId === null
          ? null
          : yield* getThreadByIdOption(execution.workerThreadId);
      const decision = decideReconcileCurrentExecution({
        execution,
        thread: threadOption?._tag === "Some" ? threadOption.value : null,
      });

      switch (decision.type) {
        case "delegate_to_requested":
          return yield* reconcileRequestedTaskExecution({
            run,
            execution,
          });
        case "complete_execution":
          yield* completeSwarmTaskExecution({
            runId: run.runId,
            executionId: execution.executionId,
          });
          return yield* driveRun({
            runId: run.runId,
            trigger: "execution_settled",
          });
        case "fail_execution":
          yield* failSwarmTaskExecution({
            runId: run.runId,
            executionId: execution.executionId,
            reason: decision.reason,
          });
          return yield* getRunById(run.runId);
        case "noop":
          return yield* getRunById(run.runId);
      }
    });

  const driveRun = (
    request: SwarmDriveRequest,
  ): Effect.Effect<OrchestrationEpicRun, SwarmSchedulerError> =>
    Effect.gen(function* () {
      let run = yield* getRunById(request.runId);
      if (isTerminalRunStatus(run.status)) {
        return run;
      }

      const projectInvariant = yield* enforceSharedWorkspaceProjectInvariant(
        "driveRun",
        run.projectId,
      );
      run = yield* getRunById(request.runId);
      if (isTerminalRunStatus(run.status)) {
        return run;
      }

      if (projectInvariant.winner !== null && projectInvariant.winner.runId !== run.runId) {
        return run;
      }

      const executionInvariant = evaluateRunExecutionInvariant({
        runId: run.runId,
        executions: yield* getExecutionsForRun(run.runId),
      });
      if (executionInvariant.violationReason) {
        yield* failRun(run.runId, executionInvariant.violationReason);
        return yield* getRunById(run.runId);
      }

      if (executionInvariant.currentExecution !== null) {
        yield* reconcileCurrentTaskExecution(run.runId);
        return yield* getRunById(run.runId);
      }

      if (run.status === "stopped") {
        return run;
      }

      if (run.status === "pending") {
        yield* markRunStarted(run.runId);
        run = yield* getRunById(run.runId);
      }

      if (run.status !== "running") {
        return run;
      }

      return yield* launchNextTaskExecution({
        runId: run.runId,
        trigger: request.trigger,
      });
    });

  const driveRunSafely = (request: SwarmDriveRequest) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(driveRun(request));
      if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause)) {
        return;
      }

      yield* failRun(
        request.runId,
        truncateSwarmFailureDetail(toErrorMessage(Cause.squash(exit.cause))),
      );
    });

  const signalDriveRequestCompletion = (request: QueuedSwarmDriveRequest) =>
    request.completion
      ? Deferred.succeed(request.completion, undefined).pipe(Effect.ignore)
      : Effect.void;

  const worker = yield* makeKeyedCoalescingWorker<
    OrchestrationProject["id"],
    ReadonlyArray<QueuedSwarmDriveRequest>,
    never,
    Scope.Scope
  >({
    merge: (current, next) => prioritizeDriveRequests([...current, ...next]),
    process: (projectId, requests) =>
      Effect.gen(function* () {
        if (activeProjectFibers.has(projectId)) {
          return;
        }

        const fiber = yield* Effect.forEach(
          requests,
          (request) =>
            driveRunSafely(request).pipe(Effect.ensuring(signalDriveRequestCompletion(request))),
          {
            discard: true,
          },
        ).pipe(
          Effect.catch((error) =>
            Effect.logError("Swarm scheduler project processing failed", {
              projectId,
              cause: error,
            }),
          ),
          Effect.forkScoped,
        );

        activeProjectFibers.set(projectId, fiber);
        yield* Fiber.await(fiber);
        activeProjectFibers.delete(projectId);
      }),
  });

  enqueueProjectRequest = (projectId, request) => worker.enqueue(projectId, [request]);

  const drain = () =>
    getReadModel().pipe(
      Effect.flatMap((readModel) =>
        Effect.forEach(readModel.projects, (project) => worker.drainKey(project.id)),
      ),
      Effect.asVoid,
    );

  const interruptActiveProject = (projectId: OrchestrationProject["id"]) =>
    Effect.gen(function* () {
      const fiber = activeProjectFibers.get(projectId);
      if (!fiber) {
        return;
      }
      yield* Fiber.interrupt(fiber);
      activeProjectFibers.delete(projectId);
    });

  const runDriveRequestAndReturnControl = (input: {
    readonly projectId: OrchestrationProject["id"];
    readonly request: SwarmDriveRequest;
  }) =>
    Effect.gen(function* () {
      const completion = yield* Deferred.make<void>();
      const queuedRequest: QueuedSwarmDriveRequest = {
        ...input.request,
        completion,
      };

      yield* scheduleDriveRequest(input.projectId, queuedRequest);
      yield* Deferred.await(completion);
    }).pipe(
      Effect.flatMap(() => getRunById(input.request.runId)),
      Effect.map(asControlResult),
    );

  const createRun = (
    input: SwarmSchedulerShape["startEpicRun"] extends (
      input: infer I,
    ) => Effect.Effect<any, any, any>
      ? I
      : never,
  ) =>
    Effect.gen(function* () {
      const project = yield* getProjectById(input.projectId);
      const existingRun = yield* getExistingRunForEpic({
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
      });
      if (existingRun) {
        return existingRun;
      }

      let trackerState = yield* requireStartableTrackerState("startEpicRun", {
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
      });

      if (!trackerState.validation.swarm) {
        yield* beadsTracker
          .createEpicSwarm({
            cwd: project.workspaceRoot,
            epicIssueId: input.epicIssueId,
          })
          .pipe(
            Effect.mapError((error) =>
              workflowError(
                "startEpicRun",
                truncateSwarmFailureDetail(toErrorMessage(error)),
                error,
              ),
            ),
          );

        trackerState = yield* requireStartableTrackerState("startEpicRun", {
          projectId: input.projectId,
          epicIssueId: input.epicIssueId,
        });
      }

      const swarm = trackerState.validation.swarm;
      if (!swarm) {
        return yield* workflowError(
          "startEpicRun",
          `Failed to create swarm for ${input.epicIssueId}: swarm was still missing after create completed.`,
        );
      }

      const modelSelection = getEffectiveModelSelection(project, input);
      const runId = nextRunId();
      const createdAt = nowIso();

      yield* dispatchOrFail("createRun", {
        type: "swarm-run.request",
        commandId: serverCommandId("swarm-run-request"),
        runId,
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
        swarmId: swarm.swarmId,
        schedulerMode: input.schedulerMode,
        workspaceMode: input.workspaceMode,
        provider: modelSelection.provider,
        model: modelSelection.model,
        ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        ...(input.assistantDeliveryMode
          ? { assistantDeliveryMode: input.assistantDeliveryMode }
          : {}),
        runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        createdAt,
      }).pipe(Effect.asVoid);

      return yield* getRunById(runId);
    });

  const startEpicRun: SwarmSchedulerShape["startEpicRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* createRun(input);
      return yield* runDriveRequestAndReturnControl({
        projectId: run.projectId,
        request: {
          runId: run.runId,
          trigger: "manual_start",
        },
      });
    });

  const settleExecutionForRunCancellation = (input: {
    readonly run: OrchestrationEpicRun;
    readonly project: OrchestrationProject;
    readonly execution: OrchestrationEpicIssueExecution;
  }) =>
    Effect.gen(function* () {
      const issue = yield* getIssueById({
        operation: "settleExecutionForRunCancellation:getIssue",
        cwd: input.project.workspaceRoot,
        issueId: input.execution.issueId,
      });

      if (isClosedIssueStatus(issue.status)) {
        yield* syncIssueForExecutionSettlement({
          phase: "completed",
          cwd: input.project.workspaceRoot,
          run: input.run,
          execution: input.execution,
        });
        yield* completeTaskExecutionCommand({
          runId: input.run.runId,
          executionId: input.execution.executionId,
        });
        return "completed" as const;
      }

      yield* syncIssueForExecutionSettlement({
        phase: "cancelled",
        cwd: input.project.workspaceRoot,
        run: input.run,
        execution: input.execution,
      });
      yield* cancelTaskExecutionCommand({
        runId: input.run.runId,
        executionId: input.execution.executionId,
      });
      return "stopped" as const;
    });

  const stopEpicRun: SwarmSchedulerShape["stopEpicRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant("stopEpicRun", run);
      if (!invariant.ok) {
        return asControlResult(invariant.run);
      }

      yield* interruptActiveProject(run.projectId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution !== null) {
        const { project, execution } = yield* getWorkerExecutionContext(
          run.runId,
          currentExecution.executionId,
        );

        yield* confirmWorkerExecutionStopped({
          operation: "stopEpicRun",
          runId: run.runId,
          executionId: execution.executionId,
          workerThreadId: execution.workerThreadId,
        });

        yield* settleExecutionForRunCancellation({
          run,
          project,
          execution,
        });
      }

      yield* cancelRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
    });

  const completeSwarmTaskExecution = (input: CompleteSwarmTaskExecutionInput) =>
    Effect.gen(function* () {
      const { run, project, execution } = yield* getWorkerExecutionContext(
        input.runId,
        input.executionId,
      );
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution?.executionId !== input.executionId) {
        return yield* workflowError(
          "completeSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the current non-terminal execution for run '${run.runId}'.`,
        );
      }

      const issue = yield* getIssueById({
        operation: "completeSwarmTaskExecution:getIssue",
        cwd: project.workspaceRoot,
        issueId: execution.issueId,
      });
      if (!isClosedIssueStatus(issue.status)) {
        const reason = describeIssueNotClosedForCompletedExecution({
          issueId: execution.issueId,
          currentStatus: issue.status,
          workerThreadId: execution.workerThreadId,
        });
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason,
        });
        return asControlResult(yield* getRunById(run.runId));
      }

      yield* syncIssueForExecutionSettlement({
        phase: "completed",
        cwd: project.workspaceRoot,
        run,
        execution,
      });
      yield* completeTaskExecutionCommand(input);
      return yield* getRunById(run.runId);
    });

  const failSwarmTaskExecution = (input: FailSwarmTaskExecutionInput) =>
    Effect.gen(function* () {
      const { run, project, execution } = yield* getWorkerExecutionContext(
        input.runId,
        input.executionId,
      );
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution?.executionId !== input.executionId) {
        return yield* workflowError(
          "failSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the current non-terminal execution for run '${run.runId}'.`,
        );
      }

      yield* syncIssueForExecutionSettlement({
        phase: "failed",
        cwd: project.workspaceRoot,
        run,
        execution,
        reason: input.reason,
      });
      yield* failTaskExecutionCommand(input);
      yield* blockRun(
        run.runId,
        input.reason,
        workerFailureBlockedContext({
          issueId: execution.issueId,
          executionId: execution.executionId,
          ...(execution.workerThreadId ? { workerThreadId: execution.workerThreadId } : {}),
        }),
      );
      return asControlResult(yield* getRunById(run.runId));
    });

  const enqueueAllRuns = (
    trigger: Extract<SwarmSchedulerTrigger, "startup_reconcile" | "periodic_reconcile">,
  ) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) =>
        Effect.forEach(readModel.epicRuns, (run) =>
          scheduleDriveRequest(run.projectId, {
            runId: run.runId,
            trigger,
          }),
        ),
      ),
      Effect.asVoid,
    );

  const reconcileAllSafely = () => enqueueAllRuns("startup_reconcile");

  const start: SwarmSchedulerShape["start"] = Effect.gen(function* () {
    yield* reconcileAllSafely();
    yield* drain();
    yield* Effect.forever(
      Effect.sleep(RECONCILIATION_INTERVAL).pipe(
        Effect.flatMap(() => enqueueAllRuns("periodic_reconcile")),
      ),
    ).pipe(Effect.forkScoped);
  });

  return {
    start,
    drain: drain(),
    startEpicRun,
    stopEpicRun,
  } satisfies SwarmSchedulerShape;
});

export const SwarmSchedulerLive = Layer.effect(SwarmScheduler, makeSwarmScheduler);

export const SwarmExecutionWorkflowLive = SwarmSchedulerLive;
