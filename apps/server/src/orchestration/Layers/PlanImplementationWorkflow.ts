import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  MessageId,
  PlanImplementationLaunchId,
  ThreadId,
  type OrchestrationCancelPlanImplementationLaunchResult,
  type OrchestrationLaunchPlanImplementationInput,
  type OrchestrationLaunchPlanImplementationResult,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveDefaultLocalBranchName } from "@t3tools/shared/git";
import {
  buildPlanImplementationPrompt,
  buildPlanImplementationThreadTitle,
} from "@t3tools/shared/plan";
import { projectScriptRuntimeEnv, setupProjectScript } from "@t3tools/shared/projectScripts";
import { Cause, Duration, Effect, Fiber, Layer, Option } from "effect";

import { GitCore } from "../../git/Services/GitCore.ts";
import type { ProjectionPlanImplementationLaunch } from "../../persistence/Services/ProjectionPlanImplementationLaunches.ts";
import { ProjectionPlanImplementationLaunchRepository } from "../../persistence/Services/ProjectionPlanImplementationLaunches.ts";
import { PlanImplementationWorkflowError } from "../Errors.ts";
import { runProjectScriptShell } from "../projectScriptRunner.ts";
import { cleanupTemporaryWorktree, createTemporaryWorktree } from "../tempWorktree.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PlanImplementationWorkflow,
  type PlanImplementationWorkflowShape,
} from "../Services/PlanImplementationWorkflow.ts";

const RECONCILIATION_INTERVAL = Duration.seconds(60);
const REQUESTED_RECONCILIATION_TIMEOUT_MS = 15 * 60 * 1000;

function workflowError(
  operation: string,
  detail: string,
  cause?: unknown,
): PlanImplementationWorkflowError {
  return new PlanImplementationWorkflowError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function serverCommandId(tag: string): CommandId {
  return CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);
}

function eventId(tag: string): EventId {
  return EventId.makeUnsafe(`${tag}:${crypto.randomUUID()}`);
}

function messageId(tag: string): MessageId {
  return MessageId.makeUnsafe(`${tag}:${crypto.randomUUID()}`);
}

function nextLaunchId(): PlanImplementationLaunchId {
  return PlanImplementationLaunchId.makeUnsafe(crypto.randomUUID());
}

function nextThreadId(): ThreadId {
  return ThreadId.makeUnsafe(crypto.randomUUID());
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalLaunchStatus(status: ProjectionPlanImplementationLaunch["status"]): boolean {
  return status === "started" || status === "failed" || status === "cancelled";
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

function summarizeOutput(stdout: string, stderr: string): string | null {
  const combined = [stdout.trim(), stderr.trim()].filter((part) => part.length > 0).join("\n\n");
  if (combined.length === 0) {
    return null;
  }
  return truncateDetail(combined, 2_000);
}

const makePlanImplementationWorkflow = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const git = yield* GitCore;
  const projectionLaunchRepository = yield* ProjectionPlanImplementationLaunchRepository;
  const activeLaunchFibers = new Map<PlanImplementationLaunchId, Fiber.Fiber<void, never>>();

  type DispatchInput = Parameters<typeof orchestrationEngine.dispatch>[0];

  const dispatchOrFail = (operation: string, command: DispatchInput) =>
    orchestrationEngine
      .dispatch(command)
      .pipe(
        Effect.mapError((error) =>
          workflowError(operation, truncateDetail(toErrorMessage(error)), error),
        ),
      );

  const getLaunchRow = (launchId: PlanImplementationLaunchId) =>
    projectionLaunchRepository.getById({ launchId }).pipe(
      Effect.mapError((error) =>
        workflowError("getLaunchRow", truncateDetail(toErrorMessage(error)), error),
      ),
      Effect.flatMap((row) =>
        Option.isSome(row)
          ? Effect.succeed(row.value)
          : Effect.fail(workflowError("getLaunchRow", `Launch '${launchId}' was not found.`)),
      ),
    );

  const getSourceContext = (launch: ProjectionPlanImplementationLaunch) =>
    orchestrationEngine.getReadModel().pipe(
      Effect.mapError((error) =>
        workflowError("getSourceContext", truncateDetail(toErrorMessage(error)), error),
      ),
      Effect.flatMap((readModel) => {
        const sourceThread =
          readModel.threads.find(
            (thread) => thread.id === launch.sourceThreadId && thread.deletedAt === null,
          ) ?? null;
        if (!sourceThread) {
          return Effect.fail(
            workflowError(
              "getSourceContext",
              `Source thread '${launch.sourceThreadId}' was not found.`,
            ),
          );
        }

        const sourcePlan =
          sourceThread.proposedPlans.find((plan) => plan.id === launch.sourcePlanId) ?? null;
        if (!sourcePlan) {
          return Effect.fail(
            workflowError(
              "getSourceContext",
              `Plan '${launch.sourcePlanId}' was not found on source thread '${launch.sourceThreadId}'.`,
            ),
          );
        }

        const project =
          readModel.projects.find(
            (entry) => entry.id === launch.projectId && entry.deletedAt === null,
          ) ?? null;
        if (!project) {
          return Effect.fail(
            workflowError(
              "getSourceContext",
              `Project '${launch.projectId}' was not found for launch '${launch.launchId}'.`,
            ),
          );
        }

        const targetThread =
          readModel.threads.find((thread) => thread.id === launch.targetThreadId) ?? null;

        return Effect.succeed({
          readModel,
          sourceThread,
          sourcePlan,
          project,
          targetThread,
        } as const);
      }),
    );

  const appendThreadActivity = (input: {
    threadId: ThreadId;
    tone: "info" | "error";
    kind: string;
    summary: string;
    payload?: unknown;
  }) =>
    dispatchOrFail("appendThreadActivity", {
      type: "thread.activity.append",
      commandId: serverCommandId("plan-implementation-activity"),
      threadId: input.threadId,
      activity: {
        id: eventId("plan-implementation-activity"),
        tone: input.tone,
        kind: input.kind,
        summary: truncateDetail(input.summary, 240),
        payload: input.payload ?? {},
        turnId: null,
        createdAt: nowIso(),
      },
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const clearThreadBinding = (threadId: ThreadId) =>
    dispatchOrFail("clearThreadBinding", {
      type: "thread.meta.update",
      commandId: serverCommandId("plan-implementation-clear-thread-binding"),
      threadId,
      branch: null,
      worktreePath: null,
    }).pipe(Effect.asVoid);

  const maybeDeleteEmptyTargetThread = (launch: ProjectionPlanImplementationLaunch) =>
    getSourceContext(launch).pipe(
      Effect.flatMap(({ targetThread }) => {
        if (
          !targetThread ||
          targetThread.messages.length > 0 ||
          targetThread.activities.length > 0 ||
          targetThread.proposedPlans.length > 0 ||
          targetThread.latestTurn !== null
        ) {
          return Effect.void;
        }

        return dispatchOrFail("maybeDeleteEmptyTargetThread", {
          type: "thread.delete",
          commandId: serverCommandId("plan-implementation-delete-empty-thread"),
          threadId: launch.targetThreadId,
        }).pipe(Effect.asVoid);
      }),
    );

  const resolveBaseBranch = (launch: ProjectionPlanImplementationLaunch) =>
    getSourceContext(launch).pipe(
      Effect.flatMap(({ sourceThread, project }) => {
        const threadBranch = sourceThread.branch?.trim() ?? "";
        if (threadBranch.length > 0) {
          return Effect.succeed(threadBranch);
        }

        return git.listBranches({ cwd: project.workspaceRoot }).pipe(
          Effect.mapError((error) =>
            workflowError("resolveBaseBranch", truncateDetail(toErrorMessage(error)), error),
          ),
          Effect.flatMap((branches) => {
            const baseBranch = resolveDefaultLocalBranchName(branches.branches);
            return baseBranch
              ? Effect.succeed(baseBranch)
              : Effect.fail(
                  workflowError(
                    "resolveBaseBranch",
                    "No base branch could be resolved for the project.",
                  ),
                );
          }),
        );
      }),
    );

  const cleanupLaunchResources = (input: {
    launch: ProjectionPlanImplementationLaunch;
    branch: string | null;
    worktreePath: string | null;
  }) =>
    Effect.gen(function* () {
      const context = yield* Effect.option(getSourceContext(input.launch));
      if (Option.isNone(context)) {
        return {
          cleanupStatus: "failed" as const,
          cleanupError: "Project context was unavailable.",
        };
      }

      return yield* cleanupTemporaryWorktree({
        git,
        cwd: context.value.project.workspaceRoot,
        branch: input.branch,
        worktreePath: input.worktreePath,
      });
    });

  const failLaunch = (input: { launchId: PlanImplementationLaunchId; reason: string }) =>
    Effect.gen(function* () {
      const launch = yield* getLaunchRow(input.launchId);
      if (isTerminalLaunchStatus(launch.status)) {
        return;
      }

      const context = yield* Effect.option(getSourceContext(launch));
      const boundBranch =
        launch.branch ??
        (Option.isSome(context) ? (context.value.targetThread?.branch ?? null) : null);
      const boundWorktreePath =
        launch.worktreePath ??
        (Option.isSome(context) ? (context.value.targetThread?.worktreePath ?? null) : null);
      const cleanupResult = yield* cleanupLaunchResources({
        launch,
        branch: boundBranch,
        worktreePath: boundWorktreePath,
      });

      if (Option.isSome(context) && context.value.targetThread) {
        yield* clearThreadBinding(launch.targetThreadId).pipe(Effect.catch(() => Effect.void));
        yield* appendThreadActivity({
          threadId: launch.targetThreadId,
          tone: "error",
          kind: "planImplementation.failed",
          summary: input.reason,
          payload: {
            cleanupStatus: cleanupResult.cleanupStatus,
            cleanupError: cleanupResult.cleanupError,
          },
        }).pipe(Effect.catch(() => Effect.void));
      }

      yield* dispatchOrFail("failLaunch", {
        type: "plan-implementation-launch.fail",
        commandId: serverCommandId("plan-implementation-fail"),
        launchId: launch.launchId,
        failureReason: truncateDetail(input.reason, 500),
        cleanupStatus: cleanupResult.cleanupStatus,
        ...(cleanupResult.cleanupError ? { cleanupError: cleanupResult.cleanupError } : {}),
        createdAt: nowIso(),
      }).pipe(Effect.asVoid);
    });

  const prepareWorktree = (launch: ProjectionPlanImplementationLaunch) =>
    Effect.gen(function* () {
      const { sourceThread, project } = yield* getSourceContext(launch);
      const baseBranch = yield* resolveBaseBranch(launch);

      yield* appendThreadActivity({
        threadId: sourceThread.id,
        tone: "info",
        kind: "planImplementation.preparing",
        summary: `Preparing implementation worktree from ${baseBranch}.`,
        payload: { launchId: launch.launchId, baseBranch },
      }).pipe(Effect.catch(() => Effect.void));

      const worktree = yield* createTemporaryWorktree({
        git,
        cwd: project.workspaceRoot,
        baseBranch,
      }).pipe(
        Effect.mapError((error) =>
          workflowError(
            "prepareWorktree:createTemporaryWorktree",
            truncateDetail(toErrorMessage(error)),
            error,
          ),
        ),
      );

      const createAndMarkPrepared = Effect.gen(function* () {
        yield* dispatchOrFail("prepareWorktree:createThread", {
          type: "thread.create",
          commandId: serverCommandId("plan-implementation-create-thread"),
          threadId: launch.targetThreadId,
          projectId: launch.projectId,
          title: launch.title,
          modelSelection: {
            provider: launch.provider ?? "codex",
            model: launch.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          runtimeMode: launch.runtimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: worktree.branch,
          worktreePath: worktree.path,
          createdAt: nowIso(),
        }).pipe(Effect.asVoid);

        yield* appendThreadActivity({
          threadId: launch.targetThreadId,
          tone: "info",
          kind: "planImplementation.prepared",
          summary: `Prepared implementation worktree on ${worktree.branch}.`,
          payload: {
            branch: worktree.branch,
            worktreePath: worktree.path,
          },
        }).pipe(Effect.catch(() => Effect.void));

        yield* dispatchOrFail("prepareWorktree:markWorktreePrepared", {
          type: "plan-implementation-launch.mark-worktree-prepared",
          commandId: serverCommandId("plan-implementation-mark-worktree-prepared"),
          launchId: launch.launchId,
          branch: worktree.branch,
          worktreePath: worktree.path,
          createdAt: nowIso(),
        }).pipe(Effect.asVoid);
      });

      yield* createAndMarkPrepared.pipe(
        Effect.tapError(() =>
          cleanupTemporaryWorktree({
            git,
            cwd: project.workspaceRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
          }),
        ),
      );
    });

  const runSetupIfNeeded = (launch: ProjectionPlanImplementationLaunch) =>
    Effect.gen(function* () {
      if (!launch.setupEnabled) {
        return;
      }

      const { project, targetThread } = yield* getSourceContext(launch);
      if (!targetThread) {
        return yield* workflowError(
          "runSetupIfNeeded",
          `Target thread '${launch.targetThreadId}' was not found.`,
        );
      }

      const setupScript = setupProjectScript(project.scripts);
      if (!setupScript) {
        return;
      }

      yield* appendThreadActivity({
        threadId: targetThread.id,
        tone: "info",
        kind: "planImplementation.setup.started",
        summary: `Running setup script '${setupScript.name}'.`,
        payload: { scriptId: setupScript.id },
      }).pipe(Effect.catch(() => Effect.void));

      const runResult = yield* runProjectScriptShell({
        cwd: launch.worktreePath ?? project.workspaceRoot,
        command: setupScript.command,
        env: {
          ...process.env,
          ...projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath: launch.worktreePath,
          }),
        },
      }).pipe(
        Effect.mapError((error) =>
          workflowError(
            "runSetupIfNeeded:runProjectScriptShell",
            truncateDetail(toErrorMessage(error)),
            error,
          ),
        ),
      );

      if ((runResult.code ?? 1) !== 0) {
        const summary =
          summarizeOutput(runResult.stdout, runResult.stderr) ??
          "Setup script exited with failure.";
        return yield* workflowError(
          "runSetupIfNeeded",
          truncateDetail(`Setup script '${setupScript.name}' failed.\n${summary}`),
        );
      }

      yield* appendThreadActivity({
        threadId: targetThread.id,
        tone: "info",
        kind: "planImplementation.setup.finished",
        summary: `Finished setup script '${setupScript.name}'.`,
        payload: { scriptId: setupScript.id },
      }).pipe(Effect.catch(() => Effect.void));
    });

  const markLaunchStarted = (launchId: PlanImplementationLaunchId) =>
    dispatchOrFail("markLaunchStarted", {
      type: "plan-implementation-launch.mark-started",
      commandId: serverCommandId("plan-implementation-mark-started"),
      launchId,
      createdAt: nowIso(),
    }).pipe(Effect.asVoid);

  const startTurn = (launch: ProjectionPlanImplementationLaunch) =>
    Effect.gen(function* () {
      yield* dispatchOrFail("startTurn:threadTurnStart", {
        type: "thread.turn.start",
        commandId: serverCommandId("plan-implementation-start-turn"),
        threadId: launch.targetThreadId,
        message: {
          messageId: messageId("plan-implementation"),
          role: "user",
          text: launch.promptText,
          attachments: [],
        },
        sourceProposedPlan: {
          threadId: launch.sourceThreadId,
          planId: launch.sourcePlanId,
        },
        ...(launch.provider ? { provider: launch.provider } : {}),
        ...(launch.model ? { model: launch.model } : {}),
        ...(launch.modelOptions ? { modelOptions: launch.modelOptions } : {}),
        ...(launch.providerOptions ? { providerOptions: launch.providerOptions } : {}),
        ...(launch.assistantDeliveryMode
          ? { assistantDeliveryMode: launch.assistantDeliveryMode }
          : {}),
        runtimeMode: launch.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: nowIso(),
      }).pipe(Effect.asVoid);

      yield* markLaunchStarted(launch.launchId);
    });

  const processLaunchAttempt = (launchId: PlanImplementationLaunchId) =>
    Effect.gen(function* () {
      let launch = yield* getLaunchRow(launchId);
      if (isTerminalLaunchStatus(launch.status)) {
        return;
      }

      if (launch.status === "requested") {
        yield* prepareWorktree(launch);
        launch = yield* getLaunchRow(launchId);
      }

      if (launch.status === "prepared") {
        yield* runSetupIfNeeded(launch);
        yield* startTurn(launch);
      }
    });

  const processLaunchSafely = (launchId: PlanImplementationLaunchId) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(processLaunchAttempt(launchId));
      if (exit._tag === "Success") {
        return;
      }
      if (Cause.hasInterruptsOnly(exit.cause)) {
        return;
      }

      yield* failLaunch({
        launchId,
        reason: truncateDetail(toErrorMessage(Cause.squash(exit.cause))),
      });
    });

  const worker = yield* makeDrainableWorker((launchId: PlanImplementationLaunchId) =>
    Effect.gen(function* () {
      if (activeLaunchFibers.has(launchId)) {
        return;
      }

      const fiber = yield* processLaunchSafely(launchId).pipe(
        Effect.catch((error) =>
          Effect.logError("Plan implementation launch processing failed", {
            launchId,
            cause: error,
          }),
        ),
        Effect.forkScoped,
      );

      activeLaunchFibers.set(launchId, fiber);
      yield* Fiber.await(fiber);
      activeLaunchFibers.delete(launchId);
    }),
  );

  const enqueueLaunch = (launchId: PlanImplementationLaunchId) => worker.enqueue(launchId);

  const reconcilePreparedLaunch = (launch: ProjectionPlanImplementationLaunch) =>
    Effect.gen(function* () {
      const { targetThread } = yield* getSourceContext(launch);
      if (!targetThread) {
        yield* failLaunch({
          launchId: launch.launchId,
          reason: "Launch lost its prepared target thread and was failed during reconciliation.",
        });
        return;
      }

      const sessionStarted =
        targetThread.session !== null &&
        (targetThread.session.status === "starting" ||
          targetThread.session.status === "running" ||
          targetThread.session.status === "ready" ||
          targetThread.session.status === "interrupted");
      const hasMessages = targetThread.messages.length > 0;
      const hasLatestTurn = targetThread.latestTurn !== null;
      if (sessionStarted || hasMessages || hasLatestTurn) {
        yield* markLaunchStarted(launch.launchId);
        return;
      }

      if (!launch.setupEnabled) {
        yield* enqueueLaunch(launch.launchId);
        return;
      }

      yield* failLaunch({
        launchId: launch.launchId,
        reason: "Launch interrupted after worktree preparation; retry required.",
      });
    });

  const reconcileLaunch = (
    launch: ProjectionPlanImplementationLaunch,
    options: { resumeRecoverable: boolean },
  ) =>
    Effect.gen(function* () {
      if (isTerminalLaunchStatus(launch.status)) {
        return;
      }

      if (launch.status === "prepared") {
        yield* reconcilePreparedLaunch(launch);
        return;
      }

      if (launch.status !== "requested") {
        return;
      }

      const updatedAtMs = Date.parse(launch.updatedAt);
      const hasTimedOut =
        !Number.isFinite(updatedAtMs) ||
        Date.now() - updatedAtMs >= REQUESTED_RECONCILIATION_TIMEOUT_MS;

      if (options.resumeRecoverable || hasTimedOut) {
        yield* enqueueLaunch(launch.launchId);
      }
    });

  const reconcileAll = (options: { resumeRecoverable: boolean }) =>
    projectionLaunchRepository.listAll().pipe(
      Effect.mapError((error) =>
        workflowError("reconcileAll", truncateDetail(toErrorMessage(error)), error),
      ),
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => reconcileLaunch(row, options))),
      Effect.asVoid,
    );

  const createLaunch = (
    input: OrchestrationLaunchPlanImplementationInput,
    retryOfLaunchId: PlanImplementationLaunchId | null,
  ) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine
        .getReadModel()
        .pipe(
          Effect.mapError((error) =>
            workflowError("launchPlanImplementation", truncateDetail(toErrorMessage(error)), error),
          ),
        );

      const existingLaunch =
        readModel.planImplementationLaunches.find(
          (launch) =>
            launch.sourceThreadId === input.sourceThreadId &&
            launch.sourcePlanId === input.planId &&
            !isTerminalLaunchStatus(launch.status),
        ) ?? null;
      if (existingLaunch) {
        return {
          launchId: existingLaunch.launchId,
          targetThreadId: existingLaunch.targetThreadId,
          status: existingLaunch.status,
        } satisfies OrchestrationLaunchPlanImplementationResult;
      }

      const sourceThread =
        readModel.threads.find(
          (thread) => thread.id === input.sourceThreadId && thread.deletedAt === null,
        ) ?? null;
      if (!sourceThread) {
        return yield* workflowError("launchPlanImplementation", "Source thread was not found.");
      }

      const sourcePlan =
        sourceThread.proposedPlans.find((plan) => plan.id === input.planId) ?? null;
      if (!sourcePlan) {
        return yield* workflowError("launchPlanImplementation", "Requested plan was not found.");
      }
      if (sourcePlan.followUpOutcome !== null) {
        return yield* workflowError(
          "launchPlanImplementation",
          `Requested plan already has terminal follow-up '${sourcePlan.followUpOutcome.kind}'.`,
        );
      }

      const project =
        readModel.projects.find(
          (entry) => entry.id === sourceThread.projectId && entry.deletedAt === null,
        ) ?? null;
      if (!project) {
        return yield* workflowError(
          "launchPlanImplementation",
          "Project for the source thread was not found.",
        );
      }

      const launchId = nextLaunchId();
      const targetThreadId = nextThreadId();
      const createdAt = nowIso();
      const title =
        input.titleOverride ?? buildPlanImplementationThreadTitle(sourcePlan.planMarkdown);

      yield* dispatchOrFail("launchPlanImplementation:request", {
        type: "plan-implementation-launch.request",
        commandId: serverCommandId("plan-implementation-request"),
        launchId,
        sourceThreadId: sourceThread.id,
        sourcePlanId: sourcePlan.id,
        projectId: project.id,
        targetThreadId,
        ...(retryOfLaunchId ? { retryOfLaunchId } : {}),
        title,
        setupEnabled: input.runSetup,
        launchMode: input.launchMode,
        promptText: buildPlanImplementationPrompt(sourcePlan.planMarkdown),
        ...(input.provider ? { provider: input.provider } : {}),
        model: input.model ?? sourceThread.modelSelection.model,
        ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        assistantDeliveryMode: input.assistantDeliveryMode ?? "buffered",
        runtimeMode: input.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        createdAt,
      }).pipe(Effect.asVoid);

      yield* enqueueLaunch(launchId);

      return {
        launchId,
        targetThreadId,
        status: "requested",
      } satisfies OrchestrationLaunchPlanImplementationResult;
    });

  const launchPlanImplementation: PlanImplementationWorkflowShape["launchPlanImplementation"] = (
    input,
  ) => createLaunch(input, null);

  const cancelPlanImplementationLaunch: PlanImplementationWorkflowShape["cancelPlanImplementationLaunch"] =
    (input) =>
      Effect.gen(function* () {
        const launch = yield* getLaunchRow(input.launchId);
        if (isTerminalLaunchStatus(launch.status)) {
          return {
            launchId: launch.launchId,
            status: launch.status,
          } satisfies OrchestrationCancelPlanImplementationLaunchResult;
        }

        const activeFiber = activeLaunchFibers.get(launch.launchId);
        if (activeFiber) {
          yield* Fiber.interrupt(activeFiber);
          activeLaunchFibers.delete(launch.launchId);
        }

        const context = yield* Effect.option(getSourceContext(launch));
        const boundBranch =
          launch.branch ??
          (Option.isSome(context) ? (context.value.targetThread?.branch ?? null) : null);
        const boundWorktreePath =
          launch.worktreePath ??
          (Option.isSome(context) ? (context.value.targetThread?.worktreePath ?? null) : null);
        const cleanupResult = yield* cleanupLaunchResources({
          launch,
          branch: boundBranch,
          worktreePath: boundWorktreePath,
        });

        if (Option.isSome(context) && context.value.targetThread) {
          yield* maybeDeleteEmptyTargetThread(launch).pipe(Effect.catch(() => Effect.void));
          yield* clearThreadBinding(launch.targetThreadId).pipe(Effect.catch(() => Effect.void));
        }

        yield* dispatchOrFail("cancelPlanImplementationLaunch", {
          type: "plan-implementation-launch.cancel",
          commandId: serverCommandId("plan-implementation-cancel"),
          launchId: launch.launchId,
          cleanupStatus: cleanupResult.cleanupStatus,
          ...(cleanupResult.cleanupError ? { cleanupError: cleanupResult.cleanupError } : {}),
          createdAt: nowIso(),
        }).pipe(Effect.asVoid);

        return {
          launchId: launch.launchId,
          status: "cancelled",
        } satisfies OrchestrationCancelPlanImplementationLaunchResult;
      });

  const retryPlanImplementationLaunch: PlanImplementationWorkflowShape["retryPlanImplementationLaunch"] =
    (input) =>
      Effect.gen(function* () {
        const previousLaunch = yield* getLaunchRow(input.launchId);
        if (previousLaunch.status !== "failed" && previousLaunch.status !== "cancelled") {
          return yield* workflowError(
            "retryPlanImplementationLaunch",
            "Only failed or cancelled launches can be retried.",
          );
        }

        return yield* createLaunch(
          {
            sourceThreadId: previousLaunch.sourceThreadId,
            planId: previousLaunch.sourcePlanId,
            titleOverride: previousLaunch.title,
            ...(previousLaunch.provider ? { provider: previousLaunch.provider } : {}),
            ...(previousLaunch.model ? { model: previousLaunch.model } : {}),
            ...(previousLaunch.modelOptions ? { modelOptions: previousLaunch.modelOptions } : {}),
            ...(previousLaunch.providerOptions
              ? { providerOptions: previousLaunch.providerOptions }
              : {}),
            ...(previousLaunch.assistantDeliveryMode
              ? { assistantDeliveryMode: previousLaunch.assistantDeliveryMode }
              : {}),
            runtimeMode: previousLaunch.runtimeMode,
            launchMode: previousLaunch.launchMode,
            runSetup: previousLaunch.setupEnabled,
          },
          previousLaunch.launchId,
        );
      });

  const start: PlanImplementationWorkflowShape["start"] = Effect.gen(function* () {
    yield* reconcileAll({ resumeRecoverable: true }).pipe(
      Effect.catch((error) =>
        Effect.logError("Initial plan implementation reconciliation failed", { cause: error }),
      ),
    );

    yield* Effect.forever(
      Effect.sleep(RECONCILIATION_INTERVAL).pipe(
        Effect.flatMap(() => reconcileAll({ resumeRecoverable: false })),
        Effect.catch((error) =>
          Effect.logError("Plan implementation reconciliation failed", { cause: error }),
        ),
      ),
    ).pipe(Effect.forkScoped);
  });

  return {
    start,
    drain: worker.drain,
    launchPlanImplementation,
    cancelPlanImplementationLaunch,
    retryPlanImplementationLaunch,
  } satisfies PlanImplementationWorkflowShape;
});

export const PlanImplementationWorkflowLive = Layer.effect(
  PlanImplementationWorkflow,
  makePlanImplementationWorkflow,
);
