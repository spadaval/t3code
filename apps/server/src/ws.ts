import { Cause, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import {
  CommandId,
  EventId,
  type OrchestrationCommand,
  BEADS_WS_METHODS,
  BeadsError,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { PlanImplementationWorkflow } from "./orchestration/Services/PlanImplementationWorkflow";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { SwarmScheduler } from "./orchestration/Services/SwarmScheduler";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { BeadsService } from "./beads/Services/BeadsService";

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const planImplementationWorkflow = yield* PlanImplementationWorkflow;
    const swarmScheduler = yield* SwarmScheduler;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const open = yield* Open;
    const gitManager = yield* GitManager;
    const git = yield* GitCore;
    const gitStatusBroadcaster = yield* GitStatusBroadcaster;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
    const beads = yield* BeadsService;
    const serverCommandId = (tag: string) =>
      CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      Schema.is(OrchestrationDispatchCommandError)(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return Schema.is(OrchestrationDispatchCommandError)(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
        let createdThread = false;
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

        const cleanupCreatedThread = () =>
          createdThread
            ? orchestrationEngine
                .dispatch({
                  type: "thread.delete",
                  commandId: serverCommandId("bootstrap-thread-delete"),
                  threadId: command.threadId,
                })
                .pipe(Effect.ignoreCause({ log: true }))
            : Effect.void;

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: unknown;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail =
            input.error instanceof Error ? input.error.message : "Unknown setup failure.";
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning("bootstrap turn start failed to launch setup script", {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                detail,
              }),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) => {
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          return Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: new Date().toISOString(),
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown setup activity dispatch failure.",
                },
              ),
            ),
          );
        };

        const runSetupProgram = () =>
          bootstrap?.runSetupScript && targetWorktreePath
            ? (() => {
                const worktreePath = targetWorktreePath;
                const requestedAt = new Date().toISOString();
                return projectSetupScriptRunner
                  .runForThread({
                    threadId: command.threadId,
                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                    ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                    worktreePath,
                  })
                  .pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        recordSetupScriptLaunchFailure({
                          error,
                          requestedAt,
                          worktreePath,
                        }),
                      onSuccess: (setupResult) => {
                        if (setupResult.status !== "started") {
                          return Effect.void;
                        }
                        return recordSetupScriptStarted({
                          requestedAt,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          scriptName: setupResult.scriptName,
                          terminalId: setupResult.terminalId,
                        });
                      },
                    }),
                  );
              })()
            : Effect.void;

        const bootstrapProgram = Effect.gen(function* () {
          if (bootstrap?.createThread) {
            yield* orchestrationEngine.dispatch({
              type: "thread.create",
              commandId: serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            });
            createdThread = true;
          }

          if (bootstrap?.prepareWorktree) {
            const worktree = yield* git.createWorktree({
              cwd: bootstrap.prepareWorktree.projectCwd,
              branch: bootstrap.prepareWorktree.baseBranch,
              newBranch: bootstrap.prepareWorktree.branch,
              path: null,
            });
            targetWorktreePath = worktree.worktree.path;
            yield* orchestrationEngine.dispatch({
              type: "thread.meta.update",
              commandId: serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.branch,
              worktreePath: targetWorktreePath,
            });
          }

          yield* runSetupProgram();

          return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
        });

        return yield* bootstrapProgram.pipe(
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.fail(dispatchError);
            }
            return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
          }),
        );
      });

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : orchestrationEngine
              .dispatch(normalizedCommand)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
          ),
        );
    };

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* serverSettings.getSettings;

      return {
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors: resolveAvailableEditors(),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
      };
    });

    const refreshGitStatus = (cwd: string) =>
      gitStatusBroadcaster
        .refreshStatus(cwd)
        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getSnapshot,
          projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
            if (normalizedCommand.type === "thread.archive") {
              yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to close thread terminals after archive", {
                    threadId: normalizedCommand.threadId,
                    error: error.message,
                  }),
                ),
              );
            }
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationDispatchCommandError)(cause)
                ? cause
                : new OrchestrationDispatchCommandError({
                    message: "Failed to dispatch orchestration command",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getTurnDiff,
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getFullThreadDiff,
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.replayEvents,
          Stream.runCollect(
            orchestrationEngine.readEvents(
              clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 }),
            ),
          ).pipe(
            Effect.map((events) => Array.from(events)),
            Effect.mapError(
              (cause) =>
                new OrchestrationReplayEventsError({
                  message: "Failed to replay orchestration events",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.launchPlanImplementation]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.launchPlanImplementation,
          planImplementationWorkflow.launchPlanImplementation(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to launch plan implementation",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.cancelPlanImplementationLaunch]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.cancelPlanImplementationLaunch,
          planImplementationWorkflow
            .cancelPlanImplementationLaunch({
              launchId: input.launchId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationDispatchCommandError({
                    message: "Failed to cancel plan implementation launch",
                    cause,
                  }),
              ),
            ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.retryPlanImplementationLaunch]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.retryPlanImplementationLaunch,
          planImplementationWorkflow
            .retryPlanImplementationLaunch({
              launchId: input.launchId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationDispatchCommandError({
                    message: "Failed to retry plan implementation launch",
                    cause,
                  }),
              ),
            ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.startSwarmRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.startSwarmRun,
          swarmScheduler.startSwarmRun(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to start swarm run",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.pauseSwarmRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.pauseSwarmRun,
          swarmScheduler.pauseSwarmRun(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to pause swarm run",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.resumePausedSwarmRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.resumePausedSwarmRun,
          swarmScheduler.resumePausedSwarmRun(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to resume paused swarm run",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.runNextSwarmTask]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.runNextSwarmTask,
          swarmScheduler.runNextSwarmTask(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to run next swarm task",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.retrySwarmTaskExecution]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.retrySwarmTaskExecution,
          swarmScheduler.retrySwarmTaskExecution(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to retry swarm task execution",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.cancelSwarmRun]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.cancelSwarmRun,
          swarmScheduler.cancelSwarmRun(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationDispatchCommandError({
                  message: "Failed to cancel swarm run",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationDomainEvents,
          Effect.gen(function* () {
            const snapshot = yield* orchestrationEngine.getReadModel();
            const fromSequenceExclusive = snapshot.snapshotSequence;
            const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
              orchestrationEngine.readEvents(fromSequenceExclusive),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
            );
            const replayStream = Stream.fromIterable(replayEvents);
            const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
            type SequenceState = {
              readonly nextSequence: number;
              readonly pendingBySequence: Map<number, OrchestrationEvent>;
            };
            const state = yield* Ref.make<SequenceState>({
              nextSequence: fromSequenceExclusive + 1,
              pendingBySequence: new Map<number, OrchestrationEvent>(),
            });

            return source.pipe(
              Stream.mapEffect((event) =>
                Ref.modify(
                  state,
                  ({
                    nextSequence,
                    pendingBySequence,
                  }): [Array<OrchestrationEvent>, SequenceState] => {
                    if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                      return [[], { nextSequence, pendingBySequence }];
                    }

                    const updatedPending = new Map(pendingBySequence);
                    updatedPending.set(event.sequence, event);

                    const emit: Array<OrchestrationEvent> = [];
                    let expected = nextSequence;
                    for (;;) {
                      const expectedEvent = updatedPending.get(expected);
                      if (!expectedEvent) {
                        break;
                      }
                      emit.push(expectedEvent);
                      updatedPending.delete(expected);
                      expected += 1;
                    }

                    return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                  },
                ),
              ),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            );
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.serverGetConfig]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverRefreshProviders,
          providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        observeRpcEffect(
          WS_METHODS.serverUpsertKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetSettings]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
        observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsWriteFile,
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : "Failed to write workspace file";
              return new ProjectWriteFileError({
                message,
                cause,
              });
            }),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [BEADS_WS_METHODS.queryIssues]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.queryIssues,
          beads.queryIssues(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to query beads issues",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getIssue]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getIssue,
          beads.getIssue(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads issue",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getIssues]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getIssues,
          beads.getIssues(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads issues batch",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.updateIssue]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.updateIssue,
          beads.updateIssue(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to update beads issue",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.createIssue]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.createIssue,
          beads.createIssue(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to create beads issue",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.commentIssue]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.commentIssue,
          beads.commentIssue(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to comment on beads issue",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getContext]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getContext,
          beads.getContext(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads context",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getSwarmSupport]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getSwarmSupport,
          beads.getSwarmSupport(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads swarm support",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getIssueGraph]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getIssueGraph,
          beads.getIssueGraph(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads issue graph",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getEpicSwarm]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getEpicSwarm,
          beads.getEpicSwarm(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load epic swarm summary",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.validateEpicSwarm]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.validateEpicSwarm,
          beads.validateEpicSwarm(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to validate epic swarm",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getEpicSwarmStatus]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getEpicSwarmStatus,
          beads.getEpicSwarmStatus(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load epic swarm status",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.listSwarms]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.listSwarms,
          beads.listSwarms(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to list swarms",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getProjectCoordinatorSnapshot]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getProjectCoordinatorSnapshot,
          beads.getProjectCoordinatorSnapshot(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load project coordinator snapshot",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getEpicCoordinatorSnapshot]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getEpicCoordinatorSnapshot,
          beads.getEpicCoordinatorSnapshot(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load epic coordinator snapshot",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.getSessionActivity]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.getSessionActivity,
          beads.getSessionActivity(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to load beads session activity",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.startWorkflow]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.startWorkflow,
          beads.startWorkflow(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to start beads workflow",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.startBacklogGrooming]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.startBacklogGrooming,
          beads.startBacklogGrooming(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to start backlog grooming workflow",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.startEpicQuickRefine]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.startEpicQuickRefine,
          beads.startEpicQuickRefine(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to start epic quick refine workflow",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.startEpicPlannedRefine]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.startEpicPlannedRefine,
          beads.startEpicPlannedRefine(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to start epic planned refine workflow",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [BEADS_WS_METHODS.startEpicCoordinationPrep]: (input) =>
        observeRpcEffect(
          BEADS_WS_METHODS.startEpicCoordinationPrep,
          beads.startEpicCoordinationPrep(input).pipe(
            Effect.mapError((cause) =>
              Schema.is(BeadsError)(cause)
                ? cause
                : new BeadsError({
                    message: "Failed to start epic coordination prep workflow",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "beads" },
        ),
      [WS_METHODS.shellOpenInEditor]: (input) =>
        observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
          "rpc.aggregate": "workspace",
        }),
      [WS_METHODS.subscribeGitStatus]: (input) =>
        observeRpcStream(WS_METHODS.subscribeGitStatus, gitStatusBroadcaster.streamStatus(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRefreshStatus]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitRefreshStatus,
          gitStatusBroadcaster.refreshStatus(input.cwd),
          {
            "rpc.aggregate": "git",
          },
        ),
      [WS_METHODS.gitWorkingTree]: (input) =>
        observeRpcEffect(WS_METHODS.gitWorkingTree, git.workingTree(input.cwd), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCurrentPullRequest]: (input) =>
        observeRpcEffect(WS_METHODS.gitCurrentPullRequest, gitManager.currentPullRequest(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPull]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPull,
          git.pullCurrentBranch(input.cwd).pipe(
            Effect.matchCauseEffect({
              onFailure: (cause) => Effect.failCause(cause),
              onSuccess: (result) =>
                refreshGitStatus(input.cwd).pipe(Effect.ignore({ log: true }), Effect.as(result)),
            }),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        observeRpcStream(
          WS_METHODS.gitRunStackedAction,
          Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
            gitManager
              .runStackedAction(input, {
                actionId: input.actionId,
                progressReporter: {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                },
              })
              .pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Queue.failCause(queue, cause),
                  onSuccess: () =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.andThen(Queue.end(queue).pipe(Effect.asVoid)),
                    ),
                }),
              ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) =>
        observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPreparePullRequestThread,
          gitManager
            .preparePullRequestThread(input)
            .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitListBranches]: (input) =>
        observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCreateWorktree,
          git.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitRemoveWorktree]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitRemoveWorktree,
          git.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitCreateBranch]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCreateBranch,
          git.createBranch(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitCheckout]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitCheckout,
          Effect.scoped(git.checkoutBranch(input)).pipe(
            Effect.tap(() => refreshGitStatus(input.cwd)),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitInit]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitInit,
          git.initRepo(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.terminalOpen]: (input) =>
        observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalWrite]: (input) =>
        observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalResize]: (input) =>
        observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClear]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalRestart]: (input) =>
        observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClose]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
          { "rpc.aggregate": "terminal" },
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerConfig,
          Effect.gen(function* () {
            const keybindingsUpdates = keybindings.streamChanges.pipe(
              Stream.map((event) => ({
                version: 1 as const,
                type: "keybindingsUpdated" as const,
                payload: {
                  issues: event.issues,
                },
              })),
            );
            const providerStatuses = providerRegistry.streamChanges.pipe(
              Stream.map((providers) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            );
            const settingsUpdates = serverSettings.streamChanges.pipe(
              Stream.map((settings) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            );

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                type: "snapshot" as const,
                config: yield* loadServerConfig,
              }),
              Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
            );
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerLifecycle,
          Effect.gen(function* () {
            const snapshot = yield* lifecycleEvents.snapshot;
            const snapshotEvents = Array.from(snapshot.events).toSorted(
              (left, right) => left.sequence - right.sequence,
            );
            const liveEvents = lifecycleEvents.stream.pipe(
              Stream.filter((event) => event.sequence > snapshot.sequence),
            );
            return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
          }),
          { "rpc.aggregate": "server" },
        ),
    });
  }),
);

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
      spanPrefix: "ws.rpc",
      spanAttributes: {
        "rpc.transport": "websocket",
        "rpc.system": "effect-rpc",
      },
    }).pipe(Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)));
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) {
            return HttpServerResponse.text("Invalid WebSocket URL", { status: 400 });
          }
          const token = url.value.searchParams.get("token");
          if (token !== config.authToken) {
            return HttpServerResponse.text("Unauthorized WebSocket connection", { status: 401 });
          }
        }
        return yield* rpcWebSocketHttpEffect;
      }),
    );
  }),
);
