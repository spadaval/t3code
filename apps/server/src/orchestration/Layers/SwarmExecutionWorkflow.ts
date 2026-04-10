import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
  TurnId,
  type OrchestrationProject,
  type OrchestrationSwarmRun,
  type OrchestrationSwarmRunBlockedContext,
  type OrchestrationSwarmRunControlResult,
  type OrchestrationSwarmRunStatus,
  type OrchestrationSwarmTaskExecution,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import { deriveExecutionBlocking, deriveSwarmRunExecutionState } from "@t3tools/shared/swarm";
import { Cause, Deferred, Duration, Effect, Fiber, Layer } from "effect";
import type { Scope } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import { SwarmSchedulerError } from "../Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SwarmScheduler, type SwarmSchedulerShape } from "../Services/SwarmScheduler.ts";
import {
  countLaunchableReadyIssues,
  describeReadyIssueExhaustion,
  describeRetryIssueNotLiveReady,
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
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
  readonly issueId: string;
  readonly workerThreadId?: ThreadId;
  readonly sequenceNumber: number;
}

interface CompleteSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
}

interface FailSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
  readonly reason: string;
}

interface CancelSwarmTaskExecutionInput {
  readonly runId: SwarmRunId;
  readonly executionId: SwarmTaskExecutionId;
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

function nextRunId(): SwarmRunId {
  return SwarmRunId.makeUnsafe(crypto.randomUUID());
}

function nextExecutionId(): SwarmTaskExecutionId {
  return SwarmTaskExecutionId.makeUnsafe(crypto.randomUUID());
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
  return status === "failed" || status === "cancelled" || status === "completed";
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

function truncateDetail(value: string, max = 1_500): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

function describeIncompleteWorkerExecution(input: {
  readonly workerThreadId: ThreadId;
  readonly sessionStatus: string | null | undefined;
  readonly latestTurnState: string | null | undefined;
}): string {
  return [
    `Worker thread '${input.workerThreadId}' stopped before completing the swarm task execution.`,
    `Observed session status: ${input.sessionStatus ?? "unknown"}.`,
    `Observed latest turn state: ${input.latestTurnState ?? "missing"}.`,
    "The provider did not report a more specific error reason.",
  ].join(" ");
}

function describeRequestedExecutionLaunchFailure(input: {
  readonly executionId: SwarmTaskExecutionId;
  readonly issueId: string;
  readonly workerThreadId: ThreadId | null;
  readonly reason: string;
}): string {
  return [
    `Requested swarm task execution '${input.executionId}' for issue '${input.issueId}' did not finish launching.`,
    input.workerThreadId
      ? `Worker thread '${input.workerThreadId}' did not reach an active turn.`
      : "The worker thread was unavailable.",
    input.reason,
  ].join(" ");
}

function executionAgeMillis(requestedAt: string): number {
  const requestedAtMillis = Date.parse(requestedAt);
  if (Number.isNaN(requestedAtMillis)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Date.now() - requestedAtMillis;
}

function requestedExecutionTimedOut(execution: OrchestrationSwarmTaskExecution): boolean {
  return (
    executionAgeMillis(execution.requestedAt) >= Duration.toMillis(REQUESTED_EXECUTION_TIMEOUT)
  );
}

function describeRequestedExecutionTimeout(input: {
  readonly executionId: SwarmTaskExecutionId;
  readonly issueId: string;
  readonly workerThreadId: ThreadId | null;
  readonly sessionStatus: string | null | undefined;
  readonly latestTurnState: string | null | undefined;
}): string {
  return [
    `Requested swarm task execution '${input.executionId}' for issue '${input.issueId}' timed out while launching.`,
    input.workerThreadId
      ? `Worker thread '${input.workerThreadId}' never reached an active turn before timeout.`
      : "The worker thread was unavailable before launch progress was observed.",
    `Observed session status: ${input.sessionStatus ?? "missing"}.`,
    `Observed latest turn state: ${input.latestTurnState ?? "missing"}.`,
    `Launch made no usable session or turn progress within ${Duration.toSeconds(REQUESTED_EXECUTION_TIMEOUT)} seconds.`,
  ].join(" ");
}

function isClosedIssueStatus(status: string): boolean {
  return status === "closed";
}

function describeIssueNotClosedForCompletedExecution(input: {
  readonly issueId: string;
  readonly currentStatus: string;
  readonly workerThreadId: ThreadId | null;
}): string {
  const workerDescriptor =
    input.workerThreadId === null ? "Worker thread" : `Worker thread '${input.workerThreadId}'`;
  return [
    `${workerDescriptor} completed, but issue '${input.issueId}' is still '${input.currentStatus}'.`,
    "Swarm workers must close their assigned Beads issue before task completion is recorded.",
  ].join(" ");
}

function asControlResult(run: OrchestrationSwarmRun): OrchestrationSwarmRunControlResult {
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
  readonly executionId?: SwarmTaskExecutionId;
  readonly workerThreadId?: ThreadId;
}): OrchestrationSwarmRunBlockedContext {
  return {
    kind: "worker_failure",
    issueId: input.issueId,
    executionId: input.executionId ?? null,
    workerThreadId: input.workerThreadId ?? null,
  };
}

function workerThreadStillHasActiveTurn(input: {
  readonly latestTurnState: string | null | undefined;
  readonly sessionActiveTurnId: TurnId | null | undefined;
}): boolean {
  return input.latestTurnState === "running" || input.sessionActiveTurnId != null;
}

function workerThreadLaunchWasObserved(input: {
  readonly latestTurnState: string | null | undefined;
  readonly sessionActiveTurnId: TurnId | null | undefined;
}): boolean {
  return input.latestTurnState != null || input.sessionActiveTurnId != null;
}

function workerThreadTurnWasRequested(thread: OrchestrationThread): boolean {
  return thread.messages.some((message) => message.role === "user");
}

function workerTurnStopped(input: {
  readonly latestTurnState: string | null | undefined;
  readonly sessionActiveTurnId: TurnId | null | undefined;
}): boolean {
  return !workerThreadStillHasActiveTurn(input);
}

function describeExecutionInvariantViolation(input: {
  readonly runId: SwarmRunId;
  readonly nonTerminalExecutions: ReadonlyArray<OrchestrationSwarmTaskExecution>;
}): string {
  const details = input.nonTerminalExecutions
    .map(
      (execution) =>
        `${execution.executionId} [status=${execution.status}, issue=${execution.issueId}, worker=${execution.workerThreadId ?? "none"}]`,
    )
    .join("; ");

  if (input.nonTerminalExecutions.length > 1) {
    return `Shared-workspace swarm run '${input.runId}' has multiple non-terminal task executions. Expected at most one active worker execution, found: ${details}.`;
  }

  const [execution] = input.nonTerminalExecutions;
  if (!execution) {
    return `Shared-workspace swarm run '${input.runId}' lost its non-terminal task execution state.`;
  }

  return `Shared-workspace swarm run '${input.runId}' has unexpected non-terminal task execution '${execution.executionId}' in its execution history.`;
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
          workflowError(operation, truncateDetail(toErrorMessage(error)), error),
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

  const getRunById = (runId: SwarmRunId) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const run = readModel.swarmRuns.find((entry) => entry.runId === runId) ?? null;
        return run
          ? Effect.succeed(run)
          : Effect.fail(workflowError("getRunById", `Swarm run '${runId}' was not found.`));
      }),
    );

  const getRunsForProject = (projectId: OrchestrationProject["id"]) =>
    getReadModel().pipe(
      Effect.map((readModel) => readModel.swarmRuns.filter((run) => run.projectId === projectId)),
    );

  const getExecutionsForRun = (runId: SwarmRunId) =>
    getReadModel().pipe(
      Effect.map((readModel) =>
        readModel.swarmTaskExecutions.filter((execution) => execution.runId === runId),
      ),
    );

  const getExecutionById = (executionId: StartSwarmTaskExecutionInput["executionId"]) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const execution =
          readModel.swarmTaskExecutions.find((entry) => entry.executionId === executionId) ?? null;
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

  const getRunExecutionState = (runId: SwarmRunId) =>
    getReadModel().pipe(
      Effect.map((readModel) =>
        deriveSwarmRunExecutionState({
          runId,
          executions: readModel.swarmTaskExecutions,
        }),
      ),
    );

  const enforceSharedWorkspaceExecutionInvariant = (
    operation: string,
    run: OrchestrationSwarmRun,
  ) =>
    Effect.gen(function* () {
      if (run.workspaceMode !== "shared") {
        return { ok: true as const };
      }

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
          : workflowError(operation, truncateDetail(toErrorMessage(error)), error),
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
        return { winner: null as OrchestrationSwarmRun | null };
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
          : workflowError(operation, truncateDetail(toErrorMessage(error)), error),
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
                truncateDetail(toErrorMessage(error)),
                error,
              ),
        ),
      );

    return poll();
  };

  const confirmWorkerExecutionStopped = (input: {
    readonly operation: string;
    readonly runId: SwarmRunId;
    readonly executionId: SwarmTaskExecutionId;
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
          readModel.swarmRuns.find(
            (run) =>
              run.projectId === input.projectId &&
              run.epicIssueId === input.epicIssueId &&
              isNonTerminalRunStatus(run.status),
          ) ?? null,
      ),
    );

  const getEffectiveModelSelection = (
    project: OrchestrationProject,
    input: SwarmSchedulerShape["startSwarmRun"] extends (
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
          workflowError("getTrackerState", truncateDetail(toErrorMessage(error)), error),
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
          workflowError(input.operation, truncateDetail(toErrorMessage(error)), error),
        ),
      );

  const getWorkerExecutionContext = (runId: SwarmRunId, executionId: SwarmTaskExecutionId) =>
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
    readonly execution: OrchestrationSwarmTaskExecution;
  }) =>
    Effect.gen(function* () {
      const issue = yield* getIssueById({
        operation: `${input.operation}:getIssue`,
        cwd: input.cwd,
        issueId: input.execution.issueId,
      });

      if (isClosedIssueStatus(issue.status)) {
        return issue;
      }

      if (
        issue.status === input.execution.originalStatus &&
        issue.assignee === input.execution.originalAssignee
      ) {
        return issue;
      }

      yield* beadsTracker
        .updateIssue({
          cwd: input.cwd,
          issueId: input.execution.issueId,
          ...(issue.status !== input.execution.originalStatus
            ? { status: input.execution.originalStatus }
            : {}),
          assignee: input.execution.originalAssignee,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(input.operation, truncateDetail(toErrorMessage(error)), error),
          ),
        );

      return issue;
    });

  const syncIssueForExecutionSettlement = (input: {
    readonly phase: "completed" | "failed" | "cancelled";
    readonly cwd: string;
    readonly run: OrchestrationSwarmRun;
    readonly execution: OrchestrationSwarmTaskExecution;
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
              schedulerMode: input.run.schedulerMode,
              workspaceMode: input.run.workspaceMode,
              ...(input.reason ? { reason: input.reason } : {}),
            }),
          })
          .pipe(
            Effect.mapError((error) =>
              workflowError(
                "syncIssueForExecutionSettlement:commentIssue",
                truncateDetail(toErrorMessage(error)),
                error,
              ),
            ),
          );
      }
    });

  const cleanupFailedRequestedExecutionLaunch = (input: {
    readonly run: OrchestrationSwarmRun;
    readonly project: OrchestrationProject;
    readonly executionId: SwarmTaskExecutionId;
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

  const markRunStarted = (runId: SwarmRunId) =>
    dispatchOrFail("markRunStarted", {
      type: "swarm-run.mark-started",
      commandId: serverCommandId("swarm-run-mark-started"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const markRunIdle = (runId: SwarmRunId) =>
    dispatchOrFail("markRunIdle", {
      type: "swarm-run.mark-idle",
      commandId: serverCommandId("swarm-run-mark-idle"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const resumeRun = (runId: SwarmRunId) =>
    dispatchOrFail("resumeRun", {
      type: "swarm-run.resume",
      commandId: serverCommandId("swarm-run-resume"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const pauseRun = (runId: SwarmRunId) =>
    dispatchOrFail("pauseRun", {
      type: "swarm-run.pause",
      commandId: serverCommandId("swarm-run-pause"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const blockRun = (
    runId: SwarmRunId,
    reason: string,
    blockedContext: OrchestrationSwarmRunBlockedContext = trackerWaitingBlockedContext(),
  ) =>
    dispatchOrFail("blockRun", {
      type: "swarm-run.block",
      commandId: serverCommandId("swarm-run-block"),
      runId,
      reason: truncateDetail(reason, 500),
      blockedContext,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const failRun = (runId: SwarmRunId, reason: string) =>
    Effect.gen(function* () {
      const run = yield* Effect.option(getRunById(runId));
      if (run._tag === "Some" && isTerminalRunStatus(run.value.status)) {
        return;
      }

      yield* dispatchOrFail("failRun", {
        type: "swarm-run.fail",
        commandId: serverCommandId("swarm-run-fail"),
        runId,
        reason: truncateDetail(reason, 500),
        createdAt: nowIso(),
      }).pipe(Effect.asVoid);
    });

  const completeRun = (runId: SwarmRunId) =>
    dispatchOrFail("completeRun", {
      type: "swarm-run.complete",
      commandId: serverCommandId("swarm-run-complete"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const cancelRun = (runId: SwarmRunId) =>
    dispatchOrFail("cancelRun", {
      type: "swarm-run.cancel",
      commandId: serverCommandId("swarm-run-cancel"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const requestTaskExecutionCommand = (input: {
    readonly runId: SwarmRunId;
    readonly executionId: SwarmTaskExecutionId;
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
    readonly runId: SwarmRunId;
    readonly executionId: SwarmTaskExecutionId;
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
      reason: truncateDetail(input.reason, 500),
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
    readonly run: OrchestrationSwarmRun;
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
    readonly run: OrchestrationSwarmRun;
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

  const nextExecutionSequenceNumber = (runId: SwarmRunId) =>
    getReadModel().pipe(
      Effect.map(
        (readModel) =>
          readModel.swarmTaskExecutions.filter((execution) => execution.runId === runId).length + 1,
      ),
    );

  const launchNextTaskExecution = (input: {
    readonly runId: SwarmRunId;
    readonly trigger: SwarmSchedulerTrigger;
    readonly retryIssueId?: string;
  }) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (isTerminalRunStatus(run.status) || currentExecution !== null) {
        return run;
      }

      if (run.workspaceMode !== "shared") {
        yield* failRun(run.runId, "Swarm execution currently supports only the shared workspace.");
        return yield* getRunById(run.runId);
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
              truncateDetail(toErrorMessage(error)),
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
          run,
          latestExecution: executionState.latestExecution,
          trigger: input.trigger,
        })
      ) {
        if (run.status !== "idle") {
          yield* markRunIdle(run.runId);
        }
        return yield* getRunById(run.runId);
      }

      const nextReadyIssue = selectLaunchableReadyIssue({
        readyIssues: trackerStatus.ready,
        attemptedIssueIds,
        ...(input.retryIssueId ? { retryIssueId: input.retryIssueId } : {}),
      });

      if (!nextReadyIssue) {
        if (input.retryIssueId) {
          yield* blockRun(
            run.runId,
            describeRetryIssueNotLiveReady({
              runId: run.runId,
              retryIssueId: input.retryIssueId,
              readyIssues: trackerStatus.ready,
            }),
            trackerWaitingBlockedContext(),
          );
          return yield* getRunById(run.runId);
        }

        if (
          trackerStatus.ready.length > 0 &&
          countLaunchableReadyIssues({
            readyIssues: trackerStatus.ready,
            attemptedIssueIds,
            ...(input.retryIssueId ? { retryIssueId: input.retryIssueId } : {}),
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
          schedulerMode: run.schedulerMode,
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
            schedulerMode: run.schedulerMode,
            workspaceMode: run.workspaceMode,
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
            const reason = truncateDetail(
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
    readonly run: OrchestrationSwarmRun;
    readonly execution: OrchestrationSwarmTaskExecution;
  }): Effect.Effect<OrchestrationSwarmRun, SwarmSchedulerError> =>
    Effect.gen(function* () {
      if (input.execution.workerThreadId === null) {
        return yield* cleanupFailedRequestedExecutionLaunch({
          run: input.run,
          project: yield* getProjectById(input.run.projectId),
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: null,
          reason: truncateDetail(
            describeRequestedExecutionLaunchFailure({
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: null,
              reason: "Requested swarm task execution lost its worker thread linkage.",
            }),
            500,
          ),
        });
      }

      const project = yield* getProjectById(input.run.projectId);
      const thread = yield* getThreadByIdOption(input.execution.workerThreadId);
      if (thread._tag === "None") {
        return yield* cleanupFailedRequestedExecutionLaunch({
          run: input.run,
          project,
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: input.execution.workerThreadId,
          reason: truncateDetail(
            describeRequestedExecutionLaunchFailure({
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: input.execution.workerThreadId,
              reason: `Worker thread '${input.execution.workerThreadId}' was not found during reconciliation.`,
            }),
            500,
          ),
        });
      }

      const launchWasRequested = workerThreadTurnWasRequested(thread.value);
      if (
        !launchWasRequested &&
        !workerThreadLaunchWasObserved({
          latestTurnState: thread.value.latestTurn?.state,
          sessionActiveTurnId: thread.value.session?.activeTurnId,
        })
      ) {
        return yield* cleanupFailedRequestedExecutionLaunch({
          run: input.run,
          project,
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: input.execution.workerThreadId,
          reason: truncateDetail(
            describeRequestedExecutionLaunchFailure({
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: input.execution.workerThreadId,
              reason:
                "Worker thread never received the swarm turn-start request before reconciliation.",
            }),
            500,
          ),
        });
      }

      if (thread.value.latestTurn?.state === "completed") {
        yield* completeSwarmTaskExecution({
          runId: input.run.runId,
          executionId: input.execution.executionId,
        });
        return yield* driveRun({
          runId: input.run.runId,
          trigger: "execution_settled",
        });
      }

      if (thread.value.latestTurn?.state === "error") {
        yield* failSwarmTaskExecution({
          runId: input.run.runId,
          executionId: input.execution.executionId,
          reason: thread.value.session?.lastError ?? "Worker thread completed with an error.",
        });
        return yield* getRunById(input.run.runId);
      }

      const workerStillRunning = workerThreadStillHasActiveTurn({
        latestTurnState: thread.value.latestTurn?.state,
        sessionActiveTurnId: thread.value.session?.activeTurnId,
      });
      if (workerStillRunning) {
        yield* startTaskExecutionCommand({
          runId: input.run.runId,
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: input.execution.workerThreadId,
          sequenceNumber: input.execution.sequenceNumber,
        });
        return yield* getRunById(input.run.runId);
      }

      // Checkpoint capture is metadata-only. Pending captures or legacy placeholder
      // checkpoint rows must never be treated as worker interruption signals here.
      if (thread.value.latestTurn?.state === "interrupted") {
        yield* failSwarmTaskExecution({
          runId: input.run.runId,
          executionId: input.execution.executionId,
          reason:
            thread.value.session?.lastError ??
            describeIncompleteWorkerExecution({
              workerThreadId: input.execution.workerThreadId,
              sessionStatus: thread.value.session?.status,
              latestTurnState: thread.value.latestTurn?.state,
            }),
        });
        return yield* getRunById(input.run.runId);
      }

      if (
        thread.value.latestTurn === null &&
        (thread.value.session?.status === "ready" ||
          thread.value.session?.status === "stopped" ||
          thread.value.session?.status === "interrupted" ||
          thread.value.session?.status === "error")
      ) {
        return yield* cleanupFailedRequestedExecutionLaunch({
          run: input.run,
          project,
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: input.execution.workerThreadId,
          reason: truncateDetail(
            describeRequestedExecutionLaunchFailure({
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: input.execution.workerThreadId,
              reason:
                thread.value.session?.lastError ??
                "Worker thread never reported a started turn before reconciliation.",
            }),
            500,
          ),
        });
      }

      if (
        launchWasRequested &&
        !workerStillRunning &&
        thread.value.latestTurn === null &&
        (thread.value.session === null ||
          thread.value.session.status === "starting" ||
          thread.value.session.status === "idle") &&
        requestedExecutionTimedOut(input.execution)
      ) {
        return yield* cleanupFailedRequestedExecutionLaunch({
          run: input.run,
          project,
          executionId: input.execution.executionId,
          issueId: input.execution.issueId,
          workerThreadId: input.execution.workerThreadId,
          reason: truncateDetail(
            describeRequestedExecutionTimeout({
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: input.execution.workerThreadId,
              sessionStatus: thread.value.session?.status,
              latestTurnState: null,
            }),
            500,
          ),
        });
      }

      return yield* getRunById(input.run.runId);
    });

  const reconcileCurrentTaskExecution = (
    runId: SwarmRunId,
  ): Effect.Effect<OrchestrationSwarmRun, SwarmSchedulerError> =>
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

      if (execution.status === "requested") {
        return yield* reconcileRequestedTaskExecution({
          run,
          execution,
        });
      }

      if (execution.workerThreadId === null) {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason: "Active swarm task execution lost its worker thread linkage.",
        });
        return yield* getRunById(run.runId);
      }

      const thread = yield* getThreadByIdOption(execution.workerThreadId);
      if (thread._tag === "None") {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason: `Worker thread '${execution.workerThreadId}' was not found during reconciliation.`,
        });
        return yield* getRunById(run.runId);
      }

      if (thread.value.latestTurn?.state === "completed") {
        yield* completeSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
        });
        return yield* driveRun({
          runId: run.runId,
          trigger: "execution_settled",
        });
      }

      if (thread.value.latestTurn?.state === "error") {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason: thread.value.session?.lastError ?? "Worker thread completed with an error.",
        });
        return yield* getRunById(run.runId);
      }

      const workerStillRunning = workerThreadStillHasActiveTurn({
        latestTurnState: thread.value.latestTurn?.state,
        sessionActiveTurnId: thread.value.session?.activeTurnId,
      });

      // Checkpoint lifecycle is intentionally ignored here; only concrete turn/session
      // lifecycle states are allowed to fail a worker execution.
      if (
        thread.value.latestTurn?.state === "interrupted" ||
        (!workerStillRunning &&
          (thread.value.session?.status === "interrupted" ||
            thread.value.session?.status === "stopped" ||
            thread.value.session?.status === "error"))
      ) {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason:
            thread.value.session?.lastError ??
            describeIncompleteWorkerExecution({
              workerThreadId: execution.workerThreadId,
              sessionStatus: thread.value.session?.status,
              latestTurnState: thread.value.latestTurn?.state,
            }),
        });
      }

      return yield* getRunById(run.runId);
    });

  const resolveRetryIssueId = (input: {
    readonly run: OrchestrationSwarmRun;
    readonly trigger: SwarmSchedulerTrigger;
    readonly retryExecutionId?: SwarmTaskExecutionId;
  }) =>
    Effect.gen(function* () {
      if (input.trigger !== "manual_retry_execution") {
        return undefined;
      }

      if (!input.retryExecutionId) {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Retry trigger for run '${input.run.runId}' was missing an execution id.`,
        );
      }

      const execution = yield* getExecutionById(input.retryExecutionId);
      if (execution.runId !== input.run.runId) {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm task execution '${execution.executionId}' does not belong to run '${input.run.runId}'.`,
        );
      }

      if (execution.status === "requested" || execution.status === "active") {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm task execution '${execution.executionId}' for issue '${execution.issueId}' is still '${execution.status}' and cannot be retried yet.`,
        );
      }

      return execution.issueId;
    });

  const driveRun = (
    request: SwarmDriveRequest,
  ): Effect.Effect<OrchestrationSwarmRun, SwarmSchedulerError> =>
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

      if (
        run.workspaceMode === "shared" &&
        projectInvariant.winner !== null &&
        projectInvariant.winner.runId !== run.runId
      ) {
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

      if (run.status === "paused" && request.trigger !== "manual_resume_paused") {
        return run;
      }

      if (
        run.status === "idle" &&
        request.trigger !== "manual_run_next" &&
        request.trigger !== "manual_retry_execution" &&
        request.trigger !== "manual_start"
      ) {
        return run;
      }

      if (
        run.status === "blocked" &&
        (isBackgroundSwarmSchedulerTrigger(request.trigger) ||
          (request.trigger !== "manual_run_next" &&
            request.trigger !== "manual_retry_execution" &&
            request.trigger !== "manual_start"))
      ) {
        return run;
      }

      const retryIssueId = yield* resolveRetryIssueId({
        run,
        trigger: request.trigger,
        ...(request.retryExecutionId ? { retryExecutionId: request.retryExecutionId } : {}),
      });

      if (run.status === "requested") {
        yield* markRunStarted(run.runId);
        run = yield* getRunById(run.runId);
      } else if (run.status === "paused" || run.status === "idle" || run.status === "blocked") {
        yield* resumeRun(run.runId);
        run = yield* getRunById(run.runId);
      }

      if (run.status !== "running") {
        return run;
      }

      return yield* launchNextTaskExecution({
        runId: run.runId,
        trigger: request.trigger,
        ...(retryIssueId ? { retryIssueId } : {}),
      });
    });

  const driveRunSafely = (request: SwarmDriveRequest) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(driveRun(request));
      if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause)) {
        return;
      }

      yield* failRun(request.runId, truncateDetail(toErrorMessage(Cause.squash(exit.cause))));
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
    input: SwarmSchedulerShape["startSwarmRun"] extends (
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

      let trackerState = yield* requireStartableTrackerState("startSwarmRun", {
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
              workflowError("startSwarmRun", truncateDetail(toErrorMessage(error)), error),
            ),
          );

        trackerState = yield* requireStartableTrackerState("startSwarmRun", {
          projectId: input.projectId,
          epicIssueId: input.epicIssueId,
        });
      }

      const swarm = trackerState.validation.swarm;
      if (!swarm) {
        return yield* workflowError(
          "startSwarmRun",
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

  const startSwarmRun: SwarmSchedulerShape["startSwarmRun"] = (input) =>
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

  const pauseSwarmRun: SwarmSchedulerShape["pauseSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status) || run.status === "paused") {
        return asControlResult(run);
      }
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution !== null) {
        return yield* workflowError(
          "pauseSwarmRun",
          `Swarm run '${run.runId}' cannot be paused while task execution '${currentExecution.executionId}' is non-terminal.`,
        );
      }

      yield* interruptActiveProject(run.projectId);
      yield* pauseRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
    });

  const resumePausedSwarmRun: SwarmSchedulerShape["resumePausedSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (run.status !== "paused") {
        return yield* workflowError(
          "resumePausedSwarmRun",
          `Swarm run '${run.runId}' is not paused and cannot be resumed.`,
        );
      }
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        return yield* workflowError(
          "resumePausedSwarmRun",
          `Swarm run '${run.runId}' cannot be resumed while task execution '${executionState.currentExecution.executionId}' is non-terminal.`,
        );
      }
      return yield* runDriveRequestAndReturnControl({
        projectId: run.projectId,
        request: {
          runId: run.runId,
          trigger: "manual_resume_paused",
        },
      });
    });

  const runNextSwarmTask: SwarmSchedulerShape["runNextSwarmTask"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (run.status === "paused") {
        return yield* workflowError(
          "runNextSwarmTask",
          `Swarm run '${run.runId}' is paused and must be resumed before running the next task.`,
        );
      }
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        return yield* workflowError(
          "runNextSwarmTask",
          `Swarm run '${run.runId}' already has a non-terminal task execution '${executionState.currentExecution.executionId}'.`,
        );
      }

      if (run.status !== "idle" && run.status !== "blocked" && run.status !== "requested") {
        return yield* workflowError(
          "runNextSwarmTask",
          `Swarm run '${run.runId}' cannot manually advance from status '${run.status}'.`,
        );
      }

      return yield* runDriveRequestAndReturnControl({
        projectId: run.projectId,
        request: {
          runId: run.runId,
          trigger: "manual_run_next",
        },
      });
    });

  const retrySwarmTaskExecution: SwarmSchedulerShape["retrySwarmTaskExecution"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (run.status === "paused") {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm run '${run.runId}' is paused and must be resumed before retrying an execution.`,
        );
      }
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }

      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm run '${run.runId}' already has a non-terminal task execution '${executionState.currentExecution.executionId}'.`,
        );
      }

      const execution = yield* getExecutionById(input.executionId);
      if (execution.runId !== run.runId) {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm task execution '${execution.executionId}' does not belong to run '${run.runId}'.`,
        );
      }

      if (execution.status === "requested" || execution.status === "active") {
        return yield* workflowError(
          "retrySwarmTaskExecution",
          `Swarm task execution '${execution.executionId}' for issue '${execution.issueId}' is still '${execution.status}' and cannot be retried yet.`,
        );
      }

      return yield* runDriveRequestAndReturnControl({
        projectId: run.projectId,
        request: {
          runId: run.runId,
          trigger: "manual_retry_execution",
          retryExecutionId: execution.executionId,
        },
      });
    });

  const settleExecutionForRunCancellation = (input: {
    readonly run: OrchestrationSwarmRun;
    readonly project: OrchestrationProject;
    readonly execution: OrchestrationSwarmTaskExecution;
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
      return "cancelled" as const;
    });

  const cancelSwarmRun: SwarmSchedulerShape["cancelSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant("cancelSwarmRun", run);
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
          operation: "cancelSwarmRun",
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
        Effect.forEach(readModel.swarmRuns, (run) =>
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
    startSwarmRun,
    pauseSwarmRun,
    resumePausedSwarmRun,
    runNextSwarmTask,
    retrySwarmTaskExecution,
    cancelSwarmRun,
  } satisfies SwarmSchedulerShape;
});

export const SwarmSchedulerLive = Layer.effect(SwarmScheduler, makeSwarmScheduler);

export const SwarmExecutionWorkflowLive = SwarmSchedulerLive;
