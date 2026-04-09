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
  type OrchestrationSwarmRunBlockedContext,
  type OrchestrationProject,
  type OrchestrationSwarmRun,
  type OrchestrationSwarmRunControlResult,
  type OrchestrationSwarmRunStatus,
  type OrchestrationSwarmTaskExecution,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import { deriveSwarmRunExecutionState, selectDeterministicReadyIssue } from "@t3tools/shared/swarm";
import { Cause, Duration, Effect, Fiber, Layer } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SwarmExecutionWorkflowError } from "../Errors.ts";
import {
  SwarmExecutionWorkflow,
  type CancelSwarmTaskExecutionInput,
  type CompleteSwarmTaskExecutionInput,
  type FailSwarmTaskExecutionInput,
  type StartSwarmTaskExecutionInput,
  type SwarmExecutionWorkflowShape,
} from "../Services/SwarmExecutionWorkflow.ts";
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

function workflowError(
  operation: string,
  detail: string,
  cause?: unknown,
): SwarmExecutionWorkflowError {
  return new SwarmExecutionWorkflowError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isWorkflowExecutionError(error: unknown): error is SwarmExecutionWorkflowError {
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

function swarmRunAssignee(runId: SwarmRunId): string {
  return `t3code-swarm/${runId}`;
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
  readonly blockedCount: number;
  readonly activeCount: number;
}): string {
  if (input.blockedCount > 0) {
    return `Swarm has ${input.blockedCount} blocked issue${input.blockedCount === 1 ? "" : "s"} and no ready issue is available.`;
  }
  if (input.activeCount > 0) {
    return `Swarm has ${input.activeCount} externally active issue${input.activeCount === 1 ? "" : "s"} and no ready issue is available.`;
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

function describeWorkerFailureRecoveryReason(input: { readonly issueId: string | null }): string {
  return input.issueId
    ? `Worker execution for issue '${input.issueId}' failed. Resolve the tracker state for this issue, refresh swarm status, then continue the run.`
    : "A swarm worker failed. Resolve the tracker state, refresh swarm status, then continue the run.";
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

function canContinueRunFromTrackerState(input: {
  readonly nextReadyIssue: ReturnType<typeof selectDeterministicReadyIssue>;
  readonly blockedCount: number;
  readonly activeCount: number;
}): boolean {
  return input.nextReadyIssue !== null || (input.blockedCount === 0 && input.activeCount === 0);
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

const makeSwarmExecutionWorkflow = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const beadsTracker = yield* BeadsTrackerService;
  const activeRunFibers = new Map<SwarmRunId, Fiber.Fiber<void, never>>();

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
    const poll = (): Effect.Effect<any, SwarmExecutionWorkflowError> =>
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

  const getConflictingSharedWorkspaceRunForProject = (input: {
    projectId: OrchestrationProject["id"];
    excludeRunId?: SwarmRunId;
  }) =>
    getReadModel().pipe(
      Effect.map(
        (readModel) =>
          readModel.swarmRuns.find(
            (run) =>
              run.projectId === input.projectId &&
              run.workspaceMode === "shared" &&
              isNonTerminalRunStatus(run.status) &&
              run.runId !== input.excludeRunId,
          ) ?? null,
      ),
    );

  const requireSharedWorkspaceProjectSlot = (input: {
    operation: string;
    projectId: OrchestrationProject["id"];
    excludeRunId?: SwarmRunId;
  }) =>
    getConflictingSharedWorkspaceRunForProject(input).pipe(
      Effect.flatMap((conflictingRun) =>
        conflictingRun
          ? Effect.fail(
              workflowError(
                input.operation,
                `Shared-workspace swarm execution is blocked by run '${conflictingRun.runId}' for epic '${conflictingRun.epicIssueId}' with status '${conflictingRun.status}' in project '${conflictingRun.projectId}'.`,
              ),
            )
          : Effect.void,
      ),
    );

  const getEffectiveModelSelection = (
    project: OrchestrationProject,
    input: SwarmExecutionWorkflowShape["startSwarmRun"] extends (
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
        nextReadyIssue: selectDeterministicReadyIssue({ validation, status }),
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

  const claimIssueForRequestedExecution = (input: {
    readonly cwd: string;
    readonly run: OrchestrationSwarmRun;
    readonly executionId: SwarmTaskExecutionId;
    readonly workerThreadId: ThreadId;
    readonly issueId: string;
  }) =>
    Effect.gen(function* () {
      yield* beadsTracker
        .updateIssue({
          cwd: input.cwd,
          issueId: input.issueId,
          status: "in_progress",
          assignee: swarmRunAssignee(input.run.runId),
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "syncIssueForStartedExecution:updateIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );
      yield* beadsTracker
        .commentIssue({
          cwd: input.cwd,
          issueId: input.issueId,
          text: buildSwarmExecutionComment({
            phase: "started",
            epicIssueId: input.run.epicIssueId,
            runId: input.run.runId,
            executionId: input.executionId,
            workerThreadId: input.workerThreadId,
            schedulerMode: input.run.schedulerMode,
            workspaceMode: input.run.workspaceMode,
          }),
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "syncIssueForStartedExecution:commentIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );
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

  const requireRunnableTrackerState = (
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

        if (!trackerState.validation.swarm) {
          return Effect.fail(
            workflowError(
              operation,
              `Epic '${input.epicIssueId}' does not have a swarm to execute.`,
            ),
          );
        }

        if (!trackerState.validation.valid) {
          const detail = trackerState.validation.errors.join("; ") || "Swarm validation failed.";
          return Effect.fail(workflowError(operation, detail));
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

  const launchNextTaskExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
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

      const trackerState = yield* getTrackerState({
        projectId: run.projectId,
        epicIssueId: run.epicIssueId,
      });

      if (
        !trackerState.support.supported ||
        !trackerState.validation.swarm ||
        !trackerState.validation.valid
      ) {
        const reason = !trackerState.support.supported
          ? (trackerState.support.reason ?? "Swarm execution is not supported.")
          : !trackerState.validation.swarm
            ? `Swarm '${run.epicIssueId}' is no longer available.`
            : trackerState.validation.errors.join("; ") || "Swarm validation failed.";
        yield* failRun(run.runId, reason);
        return yield* getRunById(run.runId);
      }

      if (!trackerState.nextReadyIssue) {
        if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
          yield* blockRun(
            run.runId,
            describeBlockedReason({
              blockedCount: trackerState.status.blocked.length,
              activeCount: trackerState.status.active.length,
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
          issueId: trackerState.nextReadyIssue.id,
          schedulerMode: run.schedulerMode,
        }),
      );

      const issueId = trackerState.nextReadyIssue.id;
      const cwd = trackerState.project.workspaceRoot;
      const workerThreadId = nextThreadId();
      const executionId = nextExecutionId();
      const sequenceNumber = yield* nextExecutionSequenceNumber(run.runId);
      const originalIssue = yield* getIssueById({
        operation: "launchNextTaskExecution:getIssue",
        cwd,
        issueId,
      });
      const threadTitle = buildSwarmWorkerThreadTitle(originalIssue);

      let threadCreated = false;
      let executionRequested = false;
      let turnStartDispatched = false;

      const launchAttempt = Effect.gen(function* () {
        yield* createWorkerThread({
          run,
          project: trackerState.project,
          threadId: workerThreadId,
          title: threadTitle,
          issueLink: buildSwarmIssueLink({
            issue: originalIssue,
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
          originalStatus: originalIssue.status,
          originalAssignee: originalIssue.assignee,
        });
        executionRequested = true;

        yield* claimIssueForRequestedExecution({
          cwd,
          run,
          executionId,
          workerThreadId,
          issueId,
        });

        yield* startWorkerThreadTurn({
          run,
          threadId: workerThreadId,
          title: threadTitle,
          promptText: buildSwarmWorkerPrompt({
            issueId: originalIssue.id,
            issueTitle: originalIssue.title,
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
                project: trackerState.project,
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

  const settleRunWithoutActiveExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (isTerminalRunStatus(run.status) || currentExecution !== null) {
        return run;
      }

      const trackerState = yield* getTrackerState({
        projectId: run.projectId,
        epicIssueId: run.epicIssueId,
      });

      if (
        !trackerState.support.supported ||
        !trackerState.validation.swarm ||
        !trackerState.validation.valid
      ) {
        const reason = !trackerState.support.supported
          ? (trackerState.support.reason ?? "Swarm execution is not supported.")
          : !trackerState.validation.swarm
            ? `Swarm '${run.epicIssueId}' is no longer available.`
            : trackerState.validation.errors.join("; ") || "Swarm validation failed.";
        yield* failRun(run.runId, reason);
        return yield* getRunById(run.runId);
      }

      if (trackerState.nextReadyIssue) {
        return yield* launchNextTaskExecution(run.runId);
      }

      if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
        if (run.status !== "blocked") {
          yield* blockRun(
            run.runId,
            describeBlockedReason({
              blockedCount: trackerState.status.blocked.length,
              activeCount: trackerState.status.active.length,
            }),
            trackerWaitingBlockedContext(),
          );
        }
        return yield* getRunById(run.runId);
      }

      yield* completeRun(run.runId);
      return yield* getRunById(run.runId);
    });

  const reconcileRequestedTaskExecution = (input: {
    readonly run: OrchestrationSwarmRun;
    readonly execution: OrchestrationSwarmTaskExecution;
  }) =>
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
        return yield* getRunById(input.run.runId);
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

      return yield* getRunById(input.run.runId);
    });

  const reconcileCurrentTaskExecution = (runId: SwarmRunId) =>
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
        return yield* getRunById(run.runId);
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

  const reconcileRunnableRunWithoutActiveExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      let run = yield* getRunById(runId);
      const initialExecutionState = yield* getRunExecutionState(run.runId);
      if (isTerminalRunStatus(run.status) || initialExecutionState.currentExecution !== null) {
        return run;
      }
      if (run.status === "paused") {
        return run;
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant(
        "reconcileRunnableRunWithoutActiveExecution",
        run,
      );
      if (!invariant.ok) {
        return invariant.run;
      }

      const trackerState = yield* getTrackerState({
        projectId: run.projectId,
        epicIssueId: run.epicIssueId,
      });

      if (
        !trackerState.support.supported ||
        !trackerState.validation.swarm ||
        !trackerState.validation.valid
      ) {
        const reason = !trackerState.support.supported
          ? (trackerState.support.reason ?? "Swarm execution is not supported.")
          : !trackerState.validation.swarm
            ? `Swarm '${run.epicIssueId}' is no longer available.`
            : trackerState.validation.errors.join("; ") || "Swarm validation failed.";
        yield* failRun(run.runId, reason);
        return yield* getRunById(run.runId);
      }

      if (!trackerState.nextReadyIssue) {
        if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
          if (run.status !== "blocked") {
            yield* blockRun(
              run.runId,
              describeBlockedReason({
                blockedCount: trackerState.status.blocked.length,
                activeCount: trackerState.status.active.length,
              }),
              trackerWaitingBlockedContext(),
            );
          }
          return yield* getRunById(run.runId);
        }

        yield* completeRun(run.runId);
        return yield* getRunById(run.runId);
      }

      if (
        run.schedulerMode === "semi-automatic" &&
        initialExecutionState.latestExecution !== null
      ) {
        if (run.status !== "idle") {
          yield* markRunIdle(run.runId);
        }
        return yield* getRunById(run.runId);
      }

      if (run.status === "requested") {
        yield* markRunStarted(run.runId);
      } else if (run.status === "blocked" || run.status === "idle") {
        yield* resumeRun(run.runId);
      }

      yield* enqueueRun(run.runId);
      return yield* getRunById(run.runId);
    });

  const processRunAttempt = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      let run = yield* getRunById(runId);
      if (isTerminalRunStatus(run.status)) {
        return;
      }

      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        yield* reconcileCurrentTaskExecution(run.runId);
        return;
      }

      if (run.status === "requested") {
        yield* markRunStarted(run.runId);
        run = yield* getRunById(run.runId);
      }

      if (run.status !== "running") {
        return;
      }

      yield* settleRunWithoutActiveExecution(run.runId);
    });

  const processRunSafely = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(processRunAttempt(runId));
      if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause)) {
        return;
      }

      yield* failRun(runId, truncateDetail(toErrorMessage(Cause.squash(exit.cause))));
    });

  const worker = yield* makeKeyedCoalescingWorker({
    merge: () => null,
    process: (runId: SwarmRunId) =>
      Effect.gen(function* () {
        if (activeRunFibers.has(runId)) {
          return;
        }

        const fiber = yield* processRunSafely(runId).pipe(
          Effect.catch((error) =>
            Effect.logError("Swarm execution run processing failed", {
              runId,
              cause: error,
            }),
          ),
          Effect.forkScoped,
        );

        activeRunFibers.set(runId, fiber);
        yield* Fiber.await(fiber);
        activeRunFibers.delete(runId);
      }),
  });

  const enqueueRun = (runId: SwarmRunId) => worker.enqueue(runId, null);
  const drain = () =>
    getReadModel().pipe(
      Effect.flatMap((readModel) =>
        Effect.forEach(readModel.swarmRuns, (run) => worker.drainKey(run.runId)),
      ),
      Effect.asVoid,
    );

  const interruptActiveRun = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const fiber = activeRunFibers.get(runId);
      if (!fiber) {
        return;
      }
      yield* Fiber.interrupt(fiber);
      activeRunFibers.delete(runId);
    });

  const createRun = (
    input: SwarmExecutionWorkflowShape["startSwarmRun"] extends (
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
      if (input.workspaceMode === "shared") {
        yield* requireSharedWorkspaceProjectSlot({
          operation: "startSwarmRun",
          projectId: input.projectId,
        });
      }

      const trackerState = yield* requireRunnableTrackerState("startSwarmRun", {
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
      });
      const swarm = trackerState.validation.swarm;
      if (!swarm) {
        return yield* workflowError(
          "createRun",
          `Epic '${input.epicIssueId}' does not have a swarm to execute.`,
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

      yield* enqueueRun(runId);
      return yield* getRunById(runId);
    });

  const startSwarmRun: SwarmExecutionWorkflowShape["startSwarmRun"] = (input) =>
    createRun(input).pipe(Effect.map(asControlResult));

  const continueSwarmRun: SwarmExecutionWorkflowShape["continueSwarmRun"] = (input) =>
    Effect.gen(function* () {
      let run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        return yield* workflowError(
          "continueSwarmRun",
          `Swarm run '${run.runId}' already has a non-terminal task execution '${executionState.currentExecution.executionId}'.`,
        );
      }
      if (run.status === "paused") {
        return yield* workflowError(
          "continueSwarmRun",
          `Swarm run '${run.runId}' is paused and must be resumed, not continued.`,
        );
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant("continueSwarmRun", run);
      if (!invariant.ok) {
        return asControlResult(invariant.run);
      }

      const trackerState = yield* getTrackerState({
        projectId: run.projectId,
        epicIssueId: run.epicIssueId,
      });

      if (
        !trackerState.support.supported ||
        !trackerState.validation.swarm ||
        !trackerState.validation.valid
      ) {
        const reason = !trackerState.support.supported
          ? (trackerState.support.reason ?? "Swarm execution is not supported.")
          : !trackerState.validation.swarm
            ? `Swarm '${run.epicIssueId}' is no longer available.`
            : trackerState.validation.errors.join("; ") || "Swarm validation failed.";
        yield* failRun(run.runId, reason);
        return asControlResult(yield* getRunById(run.runId));
      }

      if (
        !canContinueRunFromTrackerState({
          nextReadyIssue: trackerState.nextReadyIssue,
          blockedCount: trackerState.status.blocked.length,
          activeCount: trackerState.status.active.length,
        })
      ) {
        const blockedContext =
          run.blockedContext?.kind === "worker_failure"
            ? run.blockedContext
            : trackerWaitingBlockedContext();
        const reason =
          blockedContext.kind === "worker_failure"
            ? describeWorkerFailureRecoveryReason({ issueId: blockedContext.issueId })
            : describeBlockedReason({
                blockedCount: trackerState.status.blocked.length,
                activeCount: trackerState.status.active.length,
              });
        yield* blockRun(run.runId, reason, blockedContext);
        return asControlResult(yield* getRunById(run.runId));
      }

      if (trackerState.nextReadyIssue === null) {
        yield* completeRun(run.runId);
        return asControlResult(yield* getRunById(run.runId));
      }

      if (run.status === "requested") {
        yield* markRunStarted(run.runId);
      } else if (run.status === "idle" || run.status === "blocked") {
        yield* resumeRun(run.runId);
      }

      yield* enqueueRun(run.runId);
      run = yield* getRunById(run.runId);
      return asControlResult(run);
    });

  const pauseSwarmRun: SwarmExecutionWorkflowShape["pauseSwarmRun"] = (input) =>
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

      yield* interruptActiveRun(run.runId);
      yield* pauseRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
    });

  const resumeSwarmRun: SwarmExecutionWorkflowShape["resumeSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }
      if (run.status !== "paused") {
        return yield* workflowError(
          "resumeSwarmRun",
          `Swarm run '${run.runId}' is not paused and cannot be resumed.`,
        );
      }
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution !== null) {
        return yield* workflowError(
          "resumeSwarmRun",
          `Swarm run '${run.runId}' cannot be resumed while task execution '${executionState.currentExecution.executionId}' is non-terminal.`,
        );
      }
      if (run.workspaceMode === "shared") {
        yield* requireSharedWorkspaceProjectSlot({
          operation: "resumeSwarmRun",
          projectId: run.projectId,
          excludeRunId: run.runId,
        });
      }

      const trackerState = yield* requireRunnableTrackerState("resumeSwarmRun", {
        projectId: run.projectId,
        epicIssueId: run.epicIssueId,
      });

      if (!trackerState.nextReadyIssue) {
        if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
          yield* blockRun(
            run.runId,
            describeBlockedReason({
              blockedCount: trackerState.status.blocked.length,
              activeCount: trackerState.status.active.length,
            }),
            trackerWaitingBlockedContext(),
          );
          return asControlResult(yield* getRunById(run.runId));
        }

        yield* completeRun(run.runId);
        return asControlResult(yield* getRunById(run.runId));
      }

      if (run.schedulerMode === "semi-automatic" && executionState.latestExecution !== null) {
        yield* markRunIdle(run.runId);
        return asControlResult(yield* getRunById(run.runId));
      }

      yield* resumeRun(run.runId);
      yield* enqueueRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
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

  const cancelSwarmRun: SwarmExecutionWorkflowShape["cancelSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant("cancelSwarmRun", run);
      if (!invariant.ok) {
        return asControlResult(invariant.run);
      }

      yield* interruptActiveRun(run.runId);
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

  const startSwarmTaskExecution: SwarmExecutionWorkflowShape["startSwarmTaskExecution"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution !== null && currentExecution.executionId !== input.executionId) {
        return yield* workflowError(
          "startSwarmTaskExecution",
          `Swarm run '${run.runId}' already has non-terminal task execution '${currentExecution.executionId}'.`,
        );
      }
      if (
        run.status !== "running" &&
        run.status !== "requested" &&
        run.status !== "idle" &&
        run.status !== "blocked"
      ) {
        return yield* workflowError(
          "startSwarmTaskExecution",
          `Swarm run '${run.runId}' cannot mark task execution '${input.executionId}' started from status '${run.status}'.`,
        );
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant(
        "startSwarmTaskExecution",
        run,
      );
      if (!invariant.ok) {
        return asControlResult(invariant.run);
      }

      yield* startTaskExecutionCommand(input);
      return asControlResult(yield* getRunById(run.runId));
    });

  const completeSwarmTaskExecution: SwarmExecutionWorkflowShape["completeSwarmTaskExecution"] = (
    input,
  ) =>
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
      const updatedRun = yield* getRunById(run.runId);
      const updatedExecutionState = yield* getRunExecutionState(updatedRun.runId);

      if (
        isTerminalRunStatus(updatedRun.status) ||
        updatedExecutionState.currentExecution !== null
      ) {
        return asControlResult(updatedRun);
      }

      const trackerState = yield* getTrackerState({
        projectId: updatedRun.projectId,
        epicIssueId: updatedRun.epicIssueId,
      });

      if (
        !trackerState.support.supported ||
        !trackerState.validation.swarm ||
        !trackerState.validation.valid
      ) {
        const reason = !trackerState.support.supported
          ? (trackerState.support.reason ?? "Swarm execution is not supported.")
          : !trackerState.validation.swarm
            ? `Swarm '${updatedRun.epicIssueId}' is no longer available.`
            : trackerState.validation.errors.join("; ") || "Swarm validation failed.";
        yield* failRun(updatedRun.runId, reason);
        return asControlResult(yield* getRunById(updatedRun.runId));
      }

      if (trackerState.nextReadyIssue) {
        if (updatedRun.schedulerMode === "semi-automatic") {
          yield* markRunIdle(updatedRun.runId);
          return asControlResult(yield* getRunById(updatedRun.runId));
        }

        yield* enqueueRun(updatedRun.runId);
        return asControlResult(yield* getRunById(updatedRun.runId));
      }

      if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
        yield* blockRun(
          updatedRun.runId,
          describeBlockedReason({
            blockedCount: trackerState.status.blocked.length,
            activeCount: trackerState.status.active.length,
          }),
          trackerWaitingBlockedContext(),
        );
        return asControlResult(yield* getRunById(updatedRun.runId));
      }

      yield* completeRun(updatedRun.runId);
      return asControlResult(yield* getRunById(updatedRun.runId));
    });

  const failSwarmTaskExecution: SwarmExecutionWorkflowShape["failSwarmTaskExecution"] = (input) =>
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

  const cancelSwarmTaskExecution: SwarmExecutionWorkflowShape["cancelSwarmTaskExecution"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const { run, project, execution } = yield* getWorkerExecutionContext(
        input.runId,
        input.executionId,
      );
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution?.executionId !== input.executionId) {
        return yield* workflowError(
          "cancelSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the current non-terminal execution for run '${run.runId}'.`,
        );
      }

      if (execution.runId !== run.runId) {
        return yield* workflowError(
          "cancelSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' does not belong to run '${run.runId}'.`,
        );
      }

      if (execution.workerThreadId !== null) {
        yield* confirmWorkerExecutionStopped({
          operation: "cancelSwarmTaskExecution",
          runId: run.runId,
          executionId: execution.executionId,
          workerThreadId: execution.workerThreadId,
        });
      }
      yield* syncIssueForExecutionSettlement({
        phase: "cancelled",
        cwd: project.workspaceRoot,
        run,
        execution,
      });
      yield* cancelTaskExecutionCommand(input);
      return asControlResult(yield* getRunById(run.runId));
    });

  const reconcileRun = (run: OrchestrationSwarmRun) =>
    Effect.gen(function* () {
      if (isTerminalRunStatus(run.status)) {
        return;
      }

      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution !== null) {
        yield* reconcileCurrentTaskExecution(run.runId);
        return;
      }

      yield* reconcileRunnableRunWithoutActiveExecution(run.runId);
    });

  const reconcileAll = () =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => Effect.forEach(readModel.swarmRuns, reconcileRun)),
      Effect.asVoid,
    );

  const reconcileAllSafely = () =>
    reconcileAll().pipe(
      Effect.catch((error) =>
        Effect.logWarning("swarm execution workflow reconciliation failed", {
          cause: error,
        }),
      ),
    );

  const start: SwarmExecutionWorkflowShape["start"] = Effect.gen(function* () {
    yield* reconcileAllSafely();
    yield* Effect.forever(
      Effect.sleep(RECONCILIATION_INTERVAL).pipe(Effect.flatMap(() => reconcileAllSafely())),
    ).pipe(Effect.forkScoped);
  });

  return {
    start,
    drain: drain(),
    startSwarmRun,
    continueSwarmRun,
    pauseSwarmRun,
    resumeSwarmRun,
    cancelSwarmRun,
    startSwarmTaskExecution,
    completeSwarmTaskExecution,
    failSwarmTaskExecution,
    cancelSwarmTaskExecution,
  } satisfies SwarmExecutionWorkflowShape;
});

export const SwarmExecutionWorkflowLive = Layer.effect(
  SwarmExecutionWorkflow,
  makeSwarmExecutionWorkflow,
);
