import {
  type BeadsIssueRelationSummary,
  type BeadsEpicCoordinationStatus,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  defaultInstanceIdForDriver,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationEpicRun,
  type OrchestrationEpicRunControlResult,
  type OrchestrationEpicRunStatus,
  type OrchestrationEpicIssueExecution,
  type OrchestrationEvent,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type { GitStatusLocalResult } from "@t3tools/contracts";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import {
  deriveEpicRunExecutionState,
  deriveExecutionBlocking,
  describeExecutionBlockingReason,
} from "@t3tools/shared/epicRun";
import { createModelSelection } from "@t3tools/shared/model";
import { Cause, Deferred, Duration, Effect, Fiber, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import { GitManager } from "../../git/Services/GitManager.ts";
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
  truncateEpicRunFailureDetail,
} from "../FailurePolicy.ts";
import { EpicRunSchedulerError } from "../Errors.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { EpicCoordinationSnapshotReader } from "../Services/EpicTrackerSnapshotReader.ts";
import { EpicRunScheduler, type EpicRunSchedulerShape } from "../Services/EpicRunScheduler.ts";
import {
  decideDriveRun,
  decideLaunchNextTask,
  describeSharedWorkspaceProjectInvariantViolation,
  evaluateRunExecutionInvariant,
  evaluateSharedWorkspaceProjectInvariant,
  isBackgroundEpicRunSchedulerTrigger,
  selectLaunchableReadyIssue,
  type EpicRunDriveRequest,
  type EpicRunSchedulerTrigger,
} from "../epicRunSchedulerPolicy.ts";
import {
  buildEpicRunExecutionComment,
  buildEpicRunIssueLink,
  buildEpicRunWorkerPrompt,
  buildEpicRunWorkerThreadTitle,
} from "../epicRunWorker.ts";
import { EpicCoordinationSnapshotReaderLive } from "./EpicTrackerSnapshotReader.ts";

const RECONCILIATION_INTERVAL = Duration.seconds(15);
const WORKER_STOP_POLL_INTERVAL = Duration.millis(250);
const WORKER_INTERRUPT_CONFIRM_TIMEOUT = Duration.seconds(3);
const WORKER_SESSION_STOP_CONFIRM_TIMEOUT = Duration.seconds(5);
const REQUESTED_EXECUTION_TIMEOUT = Duration.seconds(60);

interface StartEpicIssueExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
  readonly issueId: string;
  readonly workerThreadId?: ThreadId;
  readonly sequenceNumber: number;
}

interface CompleteEpicIssueExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
}

interface FailEpicIssueExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
  readonly reason: string;
}

interface CancelEpicIssueExecutionInput {
  readonly runId: EpicRunId;
  readonly executionId: EpicIssueExecutionId;
}

type QueuedEpicRunDriveRequest = EpicRunDriveRequest & {
  readonly completion?: Deferred.Deferred<void, never>;
};

interface DriveRunSnapshot {
  readonly request: EpicRunDriveRequest;
  readonly run: OrchestrationEpicRun;
  readonly projectInvariant: {
    readonly winnerRunId: EpicRunId | null;
    readonly failureReason: string | null;
  };
  readonly executionInvariant: ReturnType<typeof evaluateRunExecutionInvariant>;
}

interface LaunchSnapshot {
  readonly request: EpicRunDriveRequest;
  readonly run: OrchestrationEpicRun;
  readonly project: OrchestrationProject;
  readonly coordinationStatus: BeadsEpicCoordinationStatus;
  readonly executions: ReadonlyArray<OrchestrationEpicIssueExecution>;
}

function workflowError(operation: string, detail: string, cause?: unknown): EpicRunSchedulerError {
  return new EpicRunSchedulerError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isWorkflowExecutionError(error: unknown): error is EpicRunSchedulerError {
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

function isTerminalRunStatus(status: OrchestrationEpicRunStatus): boolean {
  return status === "failed" || status === "stopped" || status === "completed";
}

function isNonTerminalRunStatus(status: OrchestrationEpicRunStatus): boolean {
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

function describeWorkingTreeChanges(status: GitStatusLocalResult): string {
  const files = status.workingTree.files.map((file) => file.path).slice(0, 8);
  if (files.length === 0) {
    return "Git reported working tree changes but did not list changed files.";
  }

  const suffix =
    status.workingTree.files.length > files.length
      ? `, and ${status.workingTree.files.length - files.length} more`
      : "";
  return `Changed files: ${files.join(", ")}${suffix}.`;
}

function buildSettlementCommitMessage(input: {
  readonly run: OrchestrationEpicRun;
  readonly execution: OrchestrationEpicIssueExecution;
}) {
  return [
    `chore(epic-run): persist ${input.execution.issueId} worker changes`,
    "",
    `Epic: ${input.run.epicIssueId}`,
    `Run: ${input.run.runId}`,
    `Execution: ${input.execution.executionId}`,
    `Worker thread: ${input.execution.workerThreadId ?? "unknown"}`,
  ].join("\n");
}

function workerTurnStopped(input: Parameters<typeof workerThreadStillHasActiveTurn>[0]): boolean {
  return !workerThreadStillHasActiveTurn(input);
}

function isNonTerminalExecutionStatus(status: OrchestrationEpicIssueExecution["status"]): boolean {
  return status === "launching" || status === "running" || status === "stopping";
}

function isWorkerLifecycleObservationEvent(
  event: OrchestrationEvent,
): event is Extract<OrchestrationEvent, { type: "thread.session-set" }> {
  return (
    event.type === "thread.session-set" &&
    (event.payload.settledTurn !== undefined ||
      (event.payload.session.status === "running" && event.payload.session.activeTurnId !== null))
  );
}

function prioritizeDriveRequests(
  requests: ReadonlyArray<QueuedEpicRunDriveRequest>,
): Array<QueuedEpicRunDriveRequest> {
  const manual: Array<QueuedEpicRunDriveRequest> = [];
  const lifecycle: Array<QueuedEpicRunDriveRequest> = [];
  const background: Array<QueuedEpicRunDriveRequest> = [];

  for (const request of requests) {
    if (isBackgroundEpicRunSchedulerTrigger(request.trigger)) {
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

const makeEpicRunScheduler = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const beadsTracker = yield* BeadsTrackerService;
  const gitManager = yield* GitManager;
  const coordinationSnapshotReader = yield* EpicCoordinationSnapshotReader;
  const activeProjectFibers = new Map<OrchestrationProject["id"], Fiber.Fiber<void, never>>();

  type DispatchInput = Parameters<typeof orchestrationEngine.dispatch>[0];

  const dispatchOrFail = (operation: string, command: DispatchInput) =>
    orchestrationEngine
      .dispatch(command)
      .pipe(
        Effect.mapError((error) =>
          workflowError(operation, truncateEpicRunFailureDetail(toErrorMessage(error)), error),
        ),
      );

  const getReadModel = () => orchestrationEngine.getReadModel();
  let enqueueProjectRequest:
    | ((
        projectId: OrchestrationProject["id"],
        request: EpicRunDriveRequest,
      ) => Effect.Effect<void, never, never>)
    | null = null;

  const scheduleDriveRequest = (
    projectId: OrchestrationProject["id"],
    request: EpicRunDriveRequest,
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
          : Effect.fail(workflowError("getRunById", `Epic run '${runId}' was not found.`));
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

  const getExecutionById = (executionId: StartEpicIssueExecutionInput["executionId"]) =>
    getReadModel().pipe(
      Effect.flatMap((readModel) => {
        const execution =
          readModel.epicIssueExecutions.find((entry) => entry.executionId === executionId) ?? null;
        return execution
          ? Effect.succeed(execution)
          : Effect.fail(
              workflowError(
                "getExecutionById",
                `Epic-run execution '${executionId}' was not found.`,
              ),
            );
      }),
    );

  const findRunForWorkerThread = (threadId: ThreadId) =>
    getReadModel().pipe(
      Effect.map((readModel) => {
        const execution =
          readModel.epicIssueExecutions.find(
            (entry) =>
              entry.workerThreadId === threadId && isNonTerminalExecutionStatus(entry.status),
          ) ?? null;
        if (execution === null) {
          return null;
        }

        const run =
          readModel.epicRuns.find(
            (entry) => entry.runId === execution.runId && !isTerminalRunStatus(entry.status),
          ) ?? null;
        if (run === null) {
          return null;
        }

        return { run, execution } as const;
      }),
    );

  const getRunExecutionState = (runId: EpicRunId) =>
    getReadModel().pipe(
      Effect.map((readModel) =>
        deriveEpicRunExecutionState({
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
        yield* failRun({ runId: run.runId, reason });
        return { ok: false as const, run: yield* getRunById(run.runId) };
      }

      const [execution] = nonTerminalExecutions;
      return { ok: true as const, execution };
    }).pipe(
      Effect.mapError((error) =>
        isWorkflowExecutionError(error)
          ? error
          : workflowError(operation, truncateEpicRunFailureDetail(toErrorMessage(error)), error),
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
            latestTurnTerminalSource: thread.value.latestTurn?.terminalSource,
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
    const poll = (): Effect.Effect<any, EpicRunSchedulerError> =>
      getThreadByIdOption(input.threadId).pipe(
        Effect.flatMap((thread) => {
          if (thread._tag === "None") {
            return Effect.succeed(null);
          }

          if (
            workerTurnStopped({
              latestTurnState: thread.value.latestTurn?.state,
              latestTurnTerminalSource: thread.value.latestTurn?.terminalSource,
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
                truncateEpicRunFailureDetail(toErrorMessage(error)),
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
        `Epic run '${input.runId}' could not confirm that worker thread '${input.workerThreadId}' for execution '${input.executionId}' stopped after interrupt and session-stop escalation.`,
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
    input: EpicRunSchedulerShape["startEpicRun"] extends (
      input: infer I,
    ) => Effect.Effect<any, any, any>
      ? I
      : never,
  ) => {
    const provider = input.provider ?? ProviderDriverKind.make("codex");
    const model =
      input.model ??
      project.defaultModelSelection?.model ??
      DEFAULT_MODEL_BY_PROVIDER[provider] ??
      DEFAULT_MODEL;

    return {
      provider,
      model,
      modelSelection: createModelSelection(defaultInstanceIdForDriver(provider), model),
    };
  };

  const readLocalGitStatus = (operation: string, cwd: string) =>
    gitManager
      .localStatus({ cwd })
      .pipe(
        Effect.mapError((error) =>
          workflowError(
            operation,
            `Failed to read Git status for ${cwd}: ${toErrorMessage(error)}`,
            error,
          ),
        ),
      );

  const requireCleanEpicWorktree = (input: {
    readonly operation: string;
    readonly cwd: string;
    readonly epicIssueId: string;
    readonly context: "start" | "launch" | "settlement";
  }) =>
    Effect.gen(function* () {
      const status = yield* readLocalGitStatus(input.operation, input.cwd);
      if (!status.isRepo) {
        return yield* workflowError(
          input.operation,
          `Cannot ${
            input.context === "start" ? "start" : "continue"
          } epic run for ${input.epicIssueId} because ${input.cwd} is not a Git repository.`,
        );
      }

      if (status.hasWorkingTreeChanges) {
        const action = input.context === "start" ? "start" : "continue";
        return yield* workflowError(
          input.operation,
          `Cannot ${action} epic run for ${input.epicIssueId} because ${input.cwd} has uncommitted changes. Commit or stash them before ${
            input.context === "start" ? "starting" : "continuing"
          }. ${describeWorkingTreeChanges(status)}`,
        );
      }
    });

  const reopenIssueAfterSettlementFailure = (input: {
    readonly cwd: string;
    readonly issueId: string;
  }) =>
    beadsTracker
      .updateIssue({
        cwd: input.cwd,
        issueId: input.issueId,
        status: "open",
      })
      .pipe(
        Effect.mapError((error) =>
          workflowError(
            "reopenIssueAfterSettlementFailure",
            `Failed to reopen issue '${input.issueId}' after settlement failure: ${toErrorMessage(error)}`,
            error,
          ),
        ),
      );

  const commitClosedWorkerChanges = (input: {
    readonly run: OrchestrationEpicRun;
    readonly project: OrchestrationProject;
    readonly execution: OrchestrationEpicIssueExecution;
  }) =>
    Effect.gen(function* () {
      const beforeStatus = yield* readLocalGitStatus(
        "commitClosedWorkerChanges:beforeStatus",
        input.project.workspaceRoot,
      );
      if (!beforeStatus.isRepo) {
        return yield* workflowError(
          "commitClosedWorkerChanges",
          `Cannot settle epic-run execution '${input.execution.executionId}' because ${input.project.workspaceRoot} is not a Git repository.`,
        );
      }

      if (beforeStatus.hasWorkingTreeChanges) {
        yield* gitManager
          .runStackedAction({
            actionId: `epic-run-settlement:${input.execution.executionId}`,
            cwd: input.project.workspaceRoot,
            action: "commit",
            commitMessage: buildSettlementCommitMessage(input),
          })
          .pipe(
            Effect.mapError((error) =>
              workflowError(
                "commitClosedWorkerChanges",
                `Failed to commit worker changes for issue '${input.execution.issueId}': ${toErrorMessage(error)}`,
                error,
              ),
            ),
          );
      }

      yield* requireCleanEpicWorktree({
        operation: "commitClosedWorkerChanges:afterStatus",
        cwd: input.project.workspaceRoot,
        epicIssueId: input.run.epicIssueId,
        context: "settlement",
      });
    });

  const getCoordinationState = (input: {
    projectId: OrchestrationProject["id"];
    epicIssueId: string;
  }) =>
    Effect.gen(function* () {
      const project = yield* getProjectById(input.projectId);
      const snapshot = yield* coordinationSnapshotReader
        .readSnapshot({
          cwd: project.workspaceRoot,
          epicIssueId: input.epicIssueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "getCoordinationState",
              truncateEpicRunFailureDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

      return {
        project,
        validation: snapshot.validation,
        status: snapshot.status,
        nextReadyIssue: selectLaunchableReadyIssue({
          readyIssues: snapshot.status.ready,
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
          workflowError(
            input.operation,
            truncateEpicRunFailureDetail(toErrorMessage(error)),
            error,
          ),
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

  const syncIssueForExecutionSettlement = (input: {
    readonly phase: "completed" | "failed" | "cancelled";
    readonly cwd: string;
    readonly run: OrchestrationEpicRun;
    readonly execution: OrchestrationEpicIssueExecution;
    readonly reason?: string;
  }) =>
    Effect.gen(function* () {
      if (input.execution.workerThreadId !== null) {
        yield* beadsTracker
          .commentIssue({
            cwd: input.cwd,
            issueId: input.execution.issueId,
            text: buildEpicRunExecutionComment({
              phase: input.phase,
              epicIssueId: input.run.epicIssueId,
              runId: input.run.runId,
              executionId: input.execution.executionId,
              workerThreadId: input.execution.workerThreadId,
              ...(input.reason ? { reason: input.reason } : {}),
            }),
          })
          .pipe(
            Effect.mapError((error) =>
              workflowError(
                "syncIssueForExecutionSettlement:commentIssue",
                truncateEpicRunFailureDetail(toErrorMessage(error)),
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

      yield* failRun({
        runId: input.run.runId,
        reason: input.reason,
        issueId: input.issueId,
        executionId: input.executionId,
        workerThreadId: input.workerThreadId,
      });

      return yield* getRunById(input.run.runId);
    });

  const requireStartableTrackerState = (
    operation: string,
    input: { projectId: OrchestrationProject["id"]; epicIssueId: string },
  ) =>
    getCoordinationState(input).pipe(
      Effect.flatMap((coordinationState) => {
        if (!coordinationState.validation.valid) {
          const detail =
            coordinationState.validation.errors.join("; ") || "Epic-run validation failed.";
          return Effect.fail(
            workflowError(operation, `Cannot start epic run for ${input.epicIssueId}: ${detail}`),
          );
        }

        const executionBlockingReason = describeExecutionBlockingReason(
          deriveExecutionBlocking(coordinationState.status),
        );
        if (executionBlockingReason !== null) {
          return Effect.fail(
            workflowError(
              operation,
              `Cannot start epic run for ${input.epicIssueId}: ${executionBlockingReason}`,
            ),
          );
        }

        return Effect.succeed(coordinationState);
      }),
    );

  const markRunStarted = (runId: EpicRunId) =>
    dispatchOrFail("markRunStarted", {
      type: "epic-run.mark-started",
      commandId: serverCommandId("epic-run-mark-started"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const failRun = (input: {
    readonly runId: EpicRunId;
    readonly reason: string;
    readonly issueId?: string | null;
    readonly executionId?: EpicIssueExecutionId | null;
    readonly workerThreadId?: ThreadId | null;
  }) =>
    Effect.gen(function* () {
      const run = yield* Effect.option(getRunById(input.runId));
      if (run._tag === "Some" && isTerminalRunStatus(run.value.status)) {
        return;
      }

      yield* dispatchOrFail("failRun", {
        type: "epic-run.fail",
        commandId: serverCommandId("epic-run-fail"),
        runId: input.runId,
        reason: truncateEpicRunFailureDetail(input.reason, 500),
        ...(input.issueId ? { issueId: input.issueId } : {}),
        ...(input.executionId ? { executionId: input.executionId } : {}),
        ...(input.workerThreadId ? { workerThreadId: input.workerThreadId } : {}),
        createdAt: nowIso(),
      }).pipe(Effect.asVoid);
    });

  const completeRun = (runId: EpicRunId) =>
    dispatchOrFail("completeRun", {
      type: "epic-run.complete",
      commandId: serverCommandId("epic-run-complete"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const cancelRun = (runId: EpicRunId) =>
    dispatchOrFail("cancelRun", {
      type: "epic-run.stop",
      commandId: serverCommandId("epic-run-stop"),
      runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const requestTaskExecutionCommand = (input: {
    readonly runId: EpicRunId;
    readonly executionId: EpicIssueExecutionId;
    readonly issueId: string;
    readonly workerThreadId: ThreadId;
    readonly sequenceNumber: number;
  }) =>
    dispatchOrFail("requestTaskExecutionCommand", {
      type: "epic-issue-execution.request",
      commandId: serverCommandId("epic-issue-execution-request"),
      executionId: input.executionId,
      runId: input.runId,
      issueId: input.issueId,
      workerThreadId: input.workerThreadId,
      sequenceNumber: input.sequenceNumber,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const startTaskExecutionCommand = (input: StartEpicIssueExecutionInput) =>
    dispatchOrFail("startTaskExecutionCommand", {
      type: "epic-issue-execution.start",
      commandId: serverCommandId("epic-issue-execution-start"),
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
            latestTurnTerminalSource: thread.value.latestTurn?.terminalSource,
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

  const completeTaskExecutionCommand = (input: CompleteEpicIssueExecutionInput) =>
    dispatchOrFail("completeTaskExecutionCommand", {
      type: "epic-issue-execution.complete",
      commandId: serverCommandId("epic-issue-execution-complete"),
      executionId: input.executionId,
      runId: input.runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const failTaskExecutionCommand = (input: FailEpicIssueExecutionInput) =>
    dispatchOrFail("failTaskExecutionCommand", {
      type: "epic-issue-execution.fail",
      commandId: serverCommandId("epic-issue-execution-fail"),
      executionId: input.executionId,
      runId: input.runId,
      reason: truncateEpicRunFailureDetail(input.reason, 500),
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const cancelTaskExecutionCommand = (input: CancelEpicIssueExecutionInput) =>
    dispatchOrFail("cancelTaskExecutionCommand", {
      type: "epic-issue-execution.stop",
      commandId: serverCommandId("epic-issue-execution-stop"),
      executionId: input.executionId,
      runId: input.runId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const createWorkerThread = (input: {
    readonly run: OrchestrationEpicRun;
    readonly project: OrchestrationProject;
    readonly threadId: ThreadId;
    readonly issueLink: ReturnType<typeof buildEpicRunIssueLink>;
    readonly title: string;
  }) => {
    const provider = input.run.provider ?? ProviderDriverKind.make("codex");
    const model = input.run.model ?? DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;

    return dispatchOrFail("createWorkerThread", {
      type: "thread.create",
      commandId: serverCommandId("epic-run-worker-thread-create"),
      threadId: input.threadId,
      projectId: input.project.id,
      title: input.title,
      modelSelection: createModelSelection(defaultInstanceIdForDriver(provider), model),
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
      commandId: serverCommandId("epic-run-worker-thread-delete"),
      threadId,
    }).pipe(Effect.asVoid);

  const interruptWorkerThread = (threadId: ThreadId) =>
    dispatchOrFail("interruptWorkerThread", {
      type: "thread.turn.interrupt",
      commandId: serverCommandId("epic-run-worker-thread-interrupt"),
      threadId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const stopWorkerThreadSession = (threadId: ThreadId) =>
    dispatchOrFail("stopWorkerThreadSession", {
      type: "thread.session.stop",
      commandId: serverCommandId("epic-run-worker-thread-session-stop"),
      threadId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const startWorkerThreadTurn = (input: {
    readonly run: OrchestrationEpicRun;
    readonly threadId: ThreadId;
    readonly promptText: string;
    readonly title: string;
  }) => {
    const provider = input.run.provider ?? ProviderDriverKind.make("codex");
    const model = input.run.model ?? DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;

    return dispatchOrFail("startWorkerThreadTurn", {
      type: "thread.turn.start",
      commandId: serverCommandId("epic-run-worker-thread-turn-start"),
      threadId: input.threadId,
      message: {
        messageId: messageId("epic-run-worker"),
        role: "user",
        text: input.promptText,
        attachments: [],
      },
      modelSelection: createModelSelection(defaultInstanceIdForDriver(provider), model),
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

  const gatherDriveRunSnapshot = (
    request: EpicRunDriveRequest,
  ): Effect.Effect<DriveRunSnapshot, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      const run = yield* getRunById(request.runId);
      const projectInvariant = evaluateSharedWorkspaceProjectInvariant(
        yield* getRunsForProject(run.projectId),
      );
      const winner = projectInvariant.winner;
      const executionInvariant = evaluateRunExecutionInvariant({
        runId: run.runId,
        executions: yield* getExecutionsForRun(run.runId),
      });

      return {
        request,
        run,
        projectInvariant: {
          winnerRunId: winner?.runId ?? null,
          failureReason:
            winner !== null && winner.runId !== run.runId
              ? describeSharedWorkspaceProjectInvariantViolation({
                  projectId: run.projectId,
                  winner,
                  loser: run,
                })
              : null,
        },
        executionInvariant,
      };
    });

  const gatherLaunchSnapshot = (
    snapshot: DriveRunSnapshot,
  ): Effect.Effect<LaunchSnapshot, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      const run = yield* getRunById(snapshot.run.runId);
      const project = yield* getProjectById(run.projectId);
      const coordinationSnapshot = yield* coordinationSnapshotReader
        .readSnapshot({
          cwd: project.workspaceRoot,
          epicIssueId: run.epicIssueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "gatherLaunchSnapshot",
              truncateEpicRunFailureDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );
      const executions = yield* getExecutionsForRun(run.runId);

      return {
        request: snapshot.request,
        run,
        project,
        coordinationStatus: coordinationSnapshot.status,
        executions,
      };
    });

  const executeLaunchIssue = (
    snapshot: LaunchSnapshot,
    nextReadyIssue: BeadsIssueRelationSummary,
  ): Effect.Effect<OrchestrationEpicRun, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      yield* requireCleanEpicWorktree({
        operation: "executeLaunchIssue:requireCleanWorktree",
        cwd: snapshot.project.workspaceRoot,
        epicIssueId: snapshot.run.epicIssueId,
        context: "launch",
      });

      yield* Effect.logDebug("epic run launching next issue execution").pipe(
        Effect.annotateLogs({
          runId: snapshot.run.runId,
          issueId: nextReadyIssue.id,
        }),
      );

      const issueId = nextReadyIssue.id;
      const cwd = snapshot.project.workspaceRoot;
      const workerThreadId = nextThreadId();
      const executionId = nextExecutionId();
      const sequenceNumber = yield* nextExecutionSequenceNumber(snapshot.run.runId);
      const threadTitle = buildEpicRunWorkerThreadTitle(nextReadyIssue);

      let threadCreated = false;
      let executionRequested = false;
      let turnStartDispatched = false;

      const launchAttempt = Effect.gen(function* () {
        yield* createWorkerThread({
          run: snapshot.run,
          project: snapshot.project,
          threadId: workerThreadId,
          title: threadTitle,
          issueLink: buildEpicRunIssueLink({
            issue: nextReadyIssue,
            cwd,
            linkedAt: nowIso(),
          }),
        });
        threadCreated = true;

        yield* requestTaskExecutionCommand({
          runId: snapshot.run.runId,
          executionId,
          issueId,
          workerThreadId,
          sequenceNumber,
        });
        executionRequested = true;

        yield* startWorkerThreadTurn({
          run: snapshot.run,
          threadId: workerThreadId,
          title: threadTitle,
          promptText: buildEpicRunWorkerPrompt({
            issueId,
            issueTitle: nextReadyIssue.title,
            epicIssueId: snapshot.run.epicIssueId,
            runId: snapshot.run.runId,
            executionId,
            sequenceNumber,
          }),
        });
        turnStartDispatched = true;

        yield* promoteRequestedExecutionIfWorkerObserved({
          runId: snapshot.run.runId,
          executionId,
          issueId,
          workerThreadId,
          sequenceNumber,
        });

        return yield* getRunById(snapshot.run.runId);
      });

      return yield* launchAttempt.pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const detail = error.detail ?? toErrorMessage(error);
            const reason = truncateEpicRunFailureDetail(
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
                run: snapshot.run,
                project: snapshot.project,
                executionId,
                issueId,
                workerThreadId,
                reason,
              });
            }

            if (!executionRequested && threadCreated) {
              yield* deleteWorkerThreadIfIdle(workerThreadId);
            }

            yield* failRun({
              runId: snapshot.run.runId,
              reason,
              issueId,
              executionId: executionRequested ? executionId : null,
              workerThreadId: threadCreated ? workerThreadId : null,
            });

            return yield* getRunById(snapshot.run.runId);
          }),
        ),
      );
    });

  const executeLaunchDecision = (input: {
    readonly snapshot: LaunchSnapshot;
    readonly decision: ReturnType<typeof decideLaunchNextTask>;
  }): Effect.Effect<
    { readonly run: OrchestrationEpicRun; readonly continueReconcile: boolean },
    EpicRunSchedulerError
  > =>
    Effect.gen(function* () {
      switch (input.decision.type) {
        case "noop":
        case "block_run":
        case "idle_run":
          return {
            run: yield* getRunById(input.snapshot.run.runId),
            continueReconcile: false,
          } as const;
        case "fail_run":
          yield* failRun({
            runId: input.snapshot.run.runId,
            reason: input.decision.reason,
          });
          return {
            run: yield* getRunById(input.snapshot.run.runId),
            continueReconcile: false,
          } as const;
        case "complete_run":
          yield* completeRun(input.snapshot.run.runId);
          return {
            run: yield* getRunById(input.snapshot.run.runId),
            continueReconcile: false,
          } as const;
        case "launch_issue":
          return {
            run: yield* executeLaunchIssue(input.snapshot, input.decision.issue),
            continueReconcile: false,
          } as const;
      }
    });

  const reconcileRequestedTaskExecution = (input: {
    readonly run: OrchestrationEpicRun;
    readonly execution: OrchestrationEpicIssueExecution;
  }): Effect.Effect<
    { readonly run: OrchestrationEpicRun; readonly settledExecution: boolean },
    EpicRunSchedulerError
  > =>
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
          return {
            run: yield* cleanupFailedRequestedExecutionLaunch({
              run: input.run,
              project,
              executionId: input.execution.executionId,
              issueId: input.execution.issueId,
              workerThreadId: input.execution.workerThreadId,
              reason: truncateEpicRunFailureDetail(decision.reason, 500),
            }),
            settledExecution: true,
          } as const;
        case "complete":
          return {
            run: yield* completeEpicIssueExecution({
              runId: input.run.runId,
              executionId: input.execution.executionId,
            }),
            settledExecution: true,
          } as const;
        case "fail":
          return {
            run: yield* failEpicIssueExecution({
              runId: input.run.runId,
              executionId: input.execution.executionId,
              reason: decision.reason,
            }),
            settledExecution: true,
          } as const;
        case "promote_to_active":
          yield* startTaskExecutionCommand({
            runId: input.run.runId,
            executionId: input.execution.executionId,
            issueId: input.execution.issueId,
            workerThreadId: input.execution.workerThreadId!,
            sequenceNumber: input.execution.sequenceNumber,
          });
          return {
            run: yield* getRunById(input.run.runId),
            settledExecution: false,
          } as const;
        case "noop":
          return {
            run: yield* getRunById(input.run.runId),
            settledExecution: false,
          } as const;
      }
    });

  const reconcileCurrentTaskExecution = (
    runId: EpicRunId,
  ): Effect.Effect<
    { readonly run: OrchestrationEpicRun; readonly settledExecution: boolean },
    EpicRunSchedulerError
  > =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      const { currentExecution } = yield* getRunExecutionState(run.runId);
      if (currentExecution === null || isTerminalRunStatus(run.status)) {
        return {
          run,
          settledExecution: false,
        } as const;
      }

      const invariant = yield* enforceSharedWorkspaceExecutionInvariant(
        "reconcileCurrentTaskExecution",
        run,
      );
      if (!invariant.ok) {
        return {
          run: invariant.run,
          settledExecution: false,
        } as const;
      }

      const execution = invariant.execution;
      if (!execution) {
        return yield* workflowError(
          "reconcileCurrentTaskExecution",
          `Epic run '${run.runId}' passed execution invariant checks without a current execution.`,
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
          return {
            run: yield* completeEpicIssueExecution({
              runId: run.runId,
              executionId: execution.executionId,
            }),
            settledExecution: true,
          } as const;
        case "fail_execution":
          return {
            run: yield* failEpicIssueExecution({
              runId: run.runId,
              executionId: execution.executionId,
              reason: decision.reason,
            }),
            settledExecution: true,
          } as const;
        case "noop":
          return {
            run: yield* getRunById(run.runId),
            settledExecution: false,
          } as const;
      }
    });

  const executeDriveRunDecision = (input: {
    readonly snapshot: DriveRunSnapshot;
    readonly decision: ReturnType<typeof decideDriveRun>;
  }): Effect.Effect<
    { readonly run: OrchestrationEpicRun; readonly continueReconcile: boolean },
    EpicRunSchedulerError
  > =>
    Effect.gen(function* () {
      switch (input.decision.type) {
        case "noop":
          return {
            run: yield* getRunById(input.snapshot.run.runId),
            continueReconcile: false,
          } as const;
        case "fail_run":
          yield* failRun({
            runId: input.snapshot.run.runId,
            reason: input.decision.reason,
          });
          return {
            run: yield* getRunById(input.snapshot.run.runId),
            continueReconcile: false,
          } as const;
        case "reconcile_current": {
          const outcome = yield* reconcileCurrentTaskExecution(input.snapshot.run.runId);
          return {
            run: outcome.run,
            continueReconcile: outcome.settledExecution,
          } as const;
        }
        case "launch": {
          if (input.snapshot.run.status === "pending") {
            yield* markRunStarted(input.snapshot.run.runId);
          }

          const run = yield* getRunById(input.snapshot.run.runId);
          if (run.status !== "running") {
            return {
              run,
              continueReconcile: false,
            } as const;
          }

          const launchSnapshot = yield* gatherLaunchSnapshot({
            ...input.snapshot,
            run,
          });
          const launchDecision = decideLaunchNextTask({
            run: launchSnapshot.run,
            trigger: launchSnapshot.request.trigger,
            trackerStatus: launchSnapshot.coordinationStatus,
            executions: launchSnapshot.executions,
          });
          return yield* executeLaunchDecision({
            snapshot: launchSnapshot,
            decision: launchDecision,
          });
        }
      }
    });

  const driveRun = (
    request: EpicRunDriveRequest,
  ): Effect.Effect<OrchestrationEpicRun, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      const snapshot = yield* gatherDriveRunSnapshot(request);
      if (isTerminalRunStatus(snapshot.run.status)) {
        return snapshot.run;
      }

      const decision = decideDriveRun({
        run: snapshot.run,
        trigger: snapshot.request.trigger,
        projectInvariant: snapshot.projectInvariant,
        executionInvariant: snapshot.executionInvariant,
      });
      const outcome = yield* executeDriveRunDecision({
        snapshot,
        decision,
      });

      return outcome.continueReconcile
        ? yield* driveRun({
            runId: request.runId,
            trigger: "execution_settled",
          })
        : outcome.run;
    });

  const driveRunSafely = (request: EpicRunDriveRequest) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(driveRun(request));
      if (exit._tag === "Success" || Cause.hasInterruptsOnly(exit.cause)) {
        return;
      }

      yield* failRun({
        runId: request.runId,
        reason: truncateEpicRunFailureDetail(toErrorMessage(Cause.squash(exit.cause))),
      });
    });

  const signalDriveRequestCompletion = (request: QueuedEpicRunDriveRequest) =>
    request.completion
      ? Deferred.succeed(request.completion, undefined).pipe(Effect.ignore)
      : Effect.void;

  const worker = yield* makeKeyedCoalescingWorker<
    OrchestrationProject["id"],
    ReadonlyArray<QueuedEpicRunDriveRequest>,
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
            Effect.logError("Epic-run scheduler project processing failed", {
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
    readonly request: EpicRunDriveRequest;
  }) =>
    Effect.gen(function* () {
      const completion = yield* Deferred.make<void>();
      const queuedRequest: QueuedEpicRunDriveRequest = {
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
    input: EpicRunSchedulerShape["startEpicRun"] extends (
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

      yield* requireCleanEpicWorktree({
        operation: "createRun:requireCleanWorktree",
        cwd: project.workspaceRoot,
        epicIssueId: input.epicIssueId,
        context: "start",
      });

      yield* requireStartableTrackerState("startEpicRun", {
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
      });

      const modelSelection = getEffectiveModelSelection(project, input);
      const runId = nextRunId();
      const createdAt = nowIso();

      yield* dispatchOrFail("createRun", {
        type: "epic-run.request",
        commandId: serverCommandId("epic-run-request"),
        runId,
        projectId: input.projectId,
        epicIssueId: input.epicIssueId,
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

  const startEpicRun: EpicRunSchedulerShape["startEpicRun"] = (input) =>
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

  const stopEpicRun: EpicRunSchedulerShape["stopEpicRun"] = (input) =>
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

        const stopConfirmation = yield* Effect.exit(
          confirmWorkerExecutionStopped({
            operation: "stopEpicRun",
            runId: run.runId,
            executionId: execution.executionId,
            workerThreadId: execution.workerThreadId,
          }),
        );
        if (stopConfirmation._tag === "Failure") {
          const reason = truncateEpicRunFailureDetail(
            toErrorMessage(Cause.squash(stopConfirmation.cause)),
            500,
          );
          yield* failEpicIssueExecution({
            runId: run.runId,
            executionId: execution.executionId,
            reason,
          });
          return asControlResult(yield* getRunById(run.runId));
        }

        yield* settleExecutionForRunCancellation({
          run,
          project,
          execution,
        });
      }

      yield* cancelRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
    });

  const completeEpicIssueExecution = (
    input: CompleteEpicIssueExecutionInput,
  ): Effect.Effect<OrchestrationEpicRun, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      const { run, project, execution } = yield* getWorkerExecutionContext(
        input.runId,
        input.executionId,
      );
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution?.executionId !== input.executionId) {
        return yield* workflowError(
          "completeEpicIssueExecution",
          `Epic-run execution '${input.executionId}' is not the current non-terminal execution for run '${run.runId}'.`,
        );
      }

      const issue = yield* getIssueById({
        operation: "completeEpicIssueExecution:getIssue",
        cwd: project.workspaceRoot,
        issueId: execution.issueId,
      });
      if (!isClosedIssueStatus(issue.status)) {
        const reason = describeIssueNotClosedForCompletedExecution({
          issueId: execution.issueId,
          currentStatus: issue.status,
          workerThreadId: execution.workerThreadId,
        });
        yield* failEpicIssueExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason,
        });
        return yield* getRunById(run.runId);
      }

      const settlementExit = yield* Effect.exit(
        commitClosedWorkerChanges({
          run,
          project,
          execution,
        }),
      );
      if (settlementExit._tag === "Failure") {
        const settlementReason = truncateEpicRunFailureDetail(
          toErrorMessage(Cause.squash(settlementExit.cause)),
          500,
        );
        const reopenExit = yield* Effect.exit(
          reopenIssueAfterSettlementFailure({
            cwd: project.workspaceRoot,
            issueId: execution.issueId,
          }),
        );
        const reason =
          reopenExit._tag === "Failure"
            ? truncateEpicRunFailureDetail(
                `${settlementReason} Also failed to reopen issue '${execution.issueId}': ${toErrorMessage(
                  Cause.squash(reopenExit.cause),
                )}`,
                500,
              )
            : settlementReason;

        yield* failEpicIssueExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason,
        });
        return yield* getRunById(run.runId);
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

  const failEpicIssueExecution = (
    input: FailEpicIssueExecutionInput,
  ): Effect.Effect<OrchestrationEpicRun, EpicRunSchedulerError> =>
    Effect.gen(function* () {
      const { run, project, execution } = yield* getWorkerExecutionContext(
        input.runId,
        input.executionId,
      );
      const executionState = yield* getRunExecutionState(run.runId);
      if (executionState.currentExecution?.executionId !== input.executionId) {
        return yield* workflowError(
          "failEpicIssueExecution",
          `Epic-run execution '${input.executionId}' is not the current non-terminal execution for run '${run.runId}'.`,
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
      yield* failRun({
        runId: run.runId,
        reason: input.reason,
        issueId: execution.issueId,
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
      });
      return yield* getRunById(run.runId);
    });

  const enqueueAllRuns = (
    trigger: Extract<EpicRunSchedulerTrigger, "startup_reconcile" | "periodic_reconcile">,
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

  const notifyWorkerStateChanged: EpicRunSchedulerShape["notifyWorkerStateChanged"] = (threadId) =>
    findRunForWorkerThread(threadId).pipe(
      Effect.flatMap((match) =>
        match === null
          ? Effect.void
          : scheduleDriveRequest(match.run.projectId, {
              runId: match.run.runId,
              trigger: "worker_state_changed",
            }),
      ),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }

        return Effect.logWarning(
          "epic-run scheduler failed to process worker lifecycle observation",
          {
            threadId,
            cause: Cause.pretty(cause),
          },
        );
      }),
    );

  const processWorkerTerminalObservation = (
    event: Extract<OrchestrationEvent, { type: "thread.session-set" }>,
  ) => notifyWorkerStateChanged(event.payload.threadId);

  const start: EpicRunSchedulerShape["start"] = Effect.gen(function* () {
    yield* reconcileAllSafely();
    yield* drain();
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (!isWorkerLifecycleObservationEvent(event)) {
          return Effect.void;
        }

        return processWorkerTerminalObservation(event);
      }),
    );
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
    notifyWorkerStateChanged,
  } satisfies EpicRunSchedulerShape;
});

export const EpicRunSchedulerLive = Layer.effect(EpicRunScheduler, makeEpicRunScheduler).pipe(
  Layer.provideMerge(EpicCoordinationSnapshotReaderLive),
);
