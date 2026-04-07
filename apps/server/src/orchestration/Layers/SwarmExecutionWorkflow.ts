import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationSwarmRun,
  type OrchestrationSwarmRunControlResult,
  type OrchestrationSwarmRunStatus,
  type OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
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
import { selectDeterministicReadyIssue } from "../swarmScheduling.ts";
import {
  buildSwarmExecutionComment,
  buildSwarmIssueLink,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerThreadTitle,
} from "../swarmWorker.ts";

const RECONCILIATION_INTERVAL = Duration.seconds(15);

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

  const syncIssueForStartedExecution = (input: {
    readonly cwd: string;
    readonly run: OrchestrationSwarmRun;
    readonly executionId: SwarmTaskExecutionId;
    readonly workerThreadId: ThreadId;
    readonly issueId: string;
  }) =>
    Effect.gen(function* () {
      const issue = yield* beadsTracker
        .getIssue({
          cwd: input.cwd,
          issueId: input.issueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "syncIssueForStartedExecution:getIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

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
            swarmId: input.run.swarmId,
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
      const issue = yield* beadsTracker
        .getIssue({
          cwd: input.cwd,
          issueId: input.execution.issueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "syncIssueForExecutionSettlement:getIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

      const restoredAssignee = issue.owner ?? null;
      yield* beadsTracker
        .updateIssue({
          cwd: input.cwd,
          issueId: input.execution.issueId,
          status: input.phase === "completed" ? "closed" : "open",
          assignee: restoredAssignee,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "syncIssueForExecutionSettlement:updateIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

      if (input.execution.workerThreadId !== null) {
        yield* beadsTracker
          .commentIssue({
            cwd: input.cwd,
            issueId: input.execution.issueId,
            text: buildSwarmExecutionComment({
              phase: input.phase,
              epicIssueId: input.run.epicIssueId,
              swarmId: input.run.swarmId,
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

  const blockRun = (runId: SwarmRunId, reason: string) =>
    dispatchOrFail("blockRun", {
      type: "swarm-run.block",
      commandId: serverCommandId("swarm-run-block"),
      runId,
      reason: truncateDetail(reason, 500),
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

  const startTaskExecutionCommand = (input: StartSwarmTaskExecutionInput) =>
    dispatchOrFail("startTaskExecutionCommand", {
      type: "swarm-task-execution.start",
      commandId: serverCommandId("swarm-task-execution-start"),
      executionId: input.executionId,
      runId: input.runId,
      issueId: input.issueId,
      ...(input.workerThreadId ? { workerThreadId: input.workerThreadId } : {}),
      sequenceNumber: input.sequenceNumber,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

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
      if (isTerminalRunStatus(run.status) || run.activeTaskExecutionId !== null) {
        return run;
      }

      if (run.workspaceMode !== "shared") {
        yield* failRun(run.runId, "Swarm execution currently supports only the shared workspace.");
        return yield* getRunById(run.runId);
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

      const originalIssue = yield* beadsTracker
        .getIssue({
          cwd,
          issueId,
        })
        .pipe(
          Effect.mapError((error) =>
            workflowError(
              "launchNextTaskExecution:getIssue",
              truncateDetail(toErrorMessage(error)),
              error,
            ),
          ),
        );

      let threadCreated = false;
      let executionStarted = false;

      const launchAttempt = Effect.gen(function* () {
        const issueForPrompt = yield* syncIssueForStartedExecution({
          cwd,
          run,
          executionId,
          workerThreadId,
          issueId,
        });
        const threadTitle = buildSwarmWorkerThreadTitle(issueForPrompt);

        yield* createWorkerThread({
          run,
          project: trackerState.project,
          threadId: workerThreadId,
          title: threadTitle,
          issueLink: buildSwarmIssueLink({
            issue: issueForPrompt,
            cwd,
            linkedAt: nowIso(),
          }),
        });
        threadCreated = true;

        yield* startTaskExecutionCommand({
          runId: run.runId,
          executionId,
          issueId,
          workerThreadId,
          sequenceNumber,
        });
        executionStarted = true;

        yield* startWorkerThreadTurn({
          run,
          threadId: workerThreadId,
          title: threadTitle,
          promptText: buildSwarmWorkerPrompt({
            issue: issueForPrompt,
            epicIssueId: run.epicIssueId,
            swarmId: run.swarmId,
            runId: run.runId,
            executionId,
            schedulerMode: run.schedulerMode,
            workspaceMode: run.workspaceMode,
            sequenceNumber,
          }),
        });

        return yield* getRunById(run.runId);
      });

      return yield* launchAttempt.pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (executionStarted) {
              yield* cancelTaskExecutionCommand({
                runId: run.runId,
                executionId,
              }).pipe(Effect.catch(() => Effect.void));
            }
            if (threadCreated) {
              yield* deleteWorkerThread(workerThreadId).pipe(Effect.catch(() => Effect.void));
            }

            yield* beadsTracker
              .updateIssue({
                cwd,
                issueId,
                status: originalIssue.status,
                assignee: originalIssue.assignee ?? originalIssue.owner ?? null,
              })
              .pipe(Effect.catch(() => Effect.void));
            yield* beadsTracker
              .commentIssue({
                cwd,
                issueId,
                text: buildSwarmExecutionComment({
                  phase: "failed",
                  epicIssueId: run.epicIssueId,
                  swarmId: run.swarmId,
                  runId: run.runId,
                  executionId,
                  workerThreadId,
                  schedulerMode: run.schedulerMode,
                  workspaceMode: run.workspaceMode,
                  reason: truncateDetail(error.detail ?? toErrorMessage(error), 500),
                }),
              })
              .pipe(Effect.catch(() => Effect.void));

            yield* failRun(run.runId, error.detail ?? toErrorMessage(error));
            return yield* getRunById(run.runId);
          }),
        ),
      );
    });

  const settleRunWithoutActiveExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      if (isTerminalRunStatus(run.status) || run.activeTaskExecutionId !== null) {
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
          );
        }
        return yield* getRunById(run.runId);
      }

      yield* completeRun(run.runId);
      return yield* getRunById(run.runId);
    });

  const reconcileActiveTaskExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      const run = yield* getRunById(runId);
      if (run.activeTaskExecutionId === null || isTerminalRunStatus(run.status)) {
        return run;
      }

      const execution = yield* getExecutionById(run.activeTaskExecutionId);
      if (execution.workerThreadId === null) {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason: "Active swarm task execution lost its worker thread linkage.",
        });
        return yield* getRunById(run.runId);
      }

      const thread = yield* Effect.option(getThreadById(execution.workerThreadId));
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

      if (
        thread.value.latestTurn?.state === "interrupted" ||
        thread.value.session?.status === "interrupted" ||
        thread.value.session?.status === "stopped" ||
        thread.value.session?.status === "error"
      ) {
        yield* failSwarmTaskExecution({
          runId: run.runId,
          executionId: execution.executionId,
          reason:
            thread.value.session?.lastError ??
            "Worker thread stopped before completing the swarm task execution.",
        });
      }

      return yield* getRunById(run.runId);
    });

  const reconcileRunnableRunWithoutActiveExecution = (runId: SwarmRunId) =>
    Effect.gen(function* () {
      let run = yield* getRunById(runId);
      if (isTerminalRunStatus(run.status) || run.activeTaskExecutionId !== null) {
        return run;
      }
      if (run.status === "paused") {
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

      if (!trackerState.nextReadyIssue) {
        if (trackerState.status.blocked.length > 0 || trackerState.status.active.length > 0) {
          if (run.status !== "blocked") {
            yield* blockRun(
              run.runId,
              describeBlockedReason({
                blockedCount: trackerState.status.blocked.length,
                activeCount: trackerState.status.active.length,
              }),
            );
          }
          return yield* getRunById(run.runId);
        }

        yield* completeRun(run.runId);
        return yield* getRunById(run.runId);
      }

      if (run.schedulerMode === "semi-automatic" && run.latestTaskExecutionId !== null) {
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

      if (run.activeTaskExecutionId !== null) {
        yield* reconcileActiveTaskExecution(run.runId);
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

  const worker = yield* makeDrainableWorker((runId: SwarmRunId) =>
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
  );

  const enqueueRun = (runId: SwarmRunId) => worker.enqueue(runId);

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
      if (run.activeTaskExecutionId !== null) {
        return yield* workflowError(
          "continueSwarmRun",
          `Swarm run '${run.runId}' already has an active task execution.`,
        );
      }
      if (run.status === "paused") {
        return yield* workflowError(
          "continueSwarmRun",
          `Swarm run '${run.runId}' is paused and must be resumed, not continued.`,
        );
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
      if (run.activeTaskExecutionId !== null) {
        return yield* workflowError(
          "pauseSwarmRun",
          `Swarm run '${run.runId}' cannot be paused while task execution '${run.activeTaskExecutionId}' is active.`,
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
      if (run.activeTaskExecutionId !== null) {
        return yield* workflowError(
          "resumeSwarmRun",
          `Swarm run '${run.runId}' cannot be resumed while task execution '${run.activeTaskExecutionId}' is active.`,
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
          );
          return asControlResult(yield* getRunById(run.runId));
        }

        yield* completeRun(run.runId);
        return asControlResult(yield* getRunById(run.runId));
      }

      if (run.schedulerMode === "semi-automatic" && run.latestTaskExecutionId !== null) {
        yield* markRunIdle(run.runId);
        return asControlResult(yield* getRunById(run.runId));
      }

      yield* resumeRun(run.runId);
      yield* enqueueRun(run.runId);
      return asControlResult(yield* getRunById(run.runId));
    });

  const cancelSwarmRun: SwarmExecutionWorkflowShape["cancelSwarmRun"] = (input) =>
    Effect.gen(function* () {
      const run = yield* getRunById(input.runId);
      if (isTerminalRunStatus(run.status)) {
        return asControlResult(run);
      }

      yield* interruptActiveRun(run.runId);
      if (run.activeTaskExecutionId !== null) {
        const { project, execution } = yield* getWorkerExecutionContext(
          run.runId,
          run.activeTaskExecutionId,
        );

        if (execution.workerThreadId !== null) {
          yield* interruptWorkerThread(execution.workerThreadId).pipe(
            Effect.catch(() => Effect.void),
          );
        }

        yield* syncIssueForExecutionSettlement({
          phase: "cancelled",
          cwd: project.workspaceRoot,
          run,
          execution,
        });
        yield* cancelTaskExecutionCommand({
          runId: run.runId,
          executionId: execution.executionId,
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
      if (run.activeTaskExecutionId !== null) {
        return yield* workflowError(
          "startSwarmTaskExecution",
          `Swarm run '${run.runId}' already has active task execution '${run.activeTaskExecutionId}'.`,
        );
      }
      if (run.status !== "running") {
        return yield* workflowError(
          "startSwarmTaskExecution",
          `Swarm run '${run.runId}' must be running before a task execution can start.`,
        );
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
      if (run.activeTaskExecutionId !== input.executionId) {
        return yield* workflowError(
          "completeSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the active execution for run '${run.runId}'.`,
        );
      }

      yield* syncIssueForExecutionSettlement({
        phase: "completed",
        cwd: project.workspaceRoot,
        run,
        execution,
      });
      yield* completeTaskExecutionCommand(input);
      const updatedRun = yield* getRunById(run.runId);

      if (isTerminalRunStatus(updatedRun.status) || updatedRun.activeTaskExecutionId !== null) {
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
      if (run.activeTaskExecutionId !== input.executionId) {
        return yield* workflowError(
          "failSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the active execution for run '${run.runId}'.`,
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
      yield* failRun(run.runId, input.reason);
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
      if (run.activeTaskExecutionId !== input.executionId) {
        return yield* workflowError(
          "cancelSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' is not the active execution for run '${run.runId}'.`,
        );
      }

      if (execution.runId !== run.runId) {
        return yield* workflowError(
          "cancelSwarmTaskExecution",
          `Swarm task execution '${input.executionId}' does not belong to run '${run.runId}'.`,
        );
      }

      if (execution.workerThreadId !== null) {
        yield* interruptWorkerThread(execution.workerThreadId).pipe(
          Effect.catch(() => Effect.void),
        );
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

      if (run.activeTaskExecutionId !== null) {
        yield* reconcileActiveTaskExecution(run.runId);
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
    drain: worker.drain,
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
