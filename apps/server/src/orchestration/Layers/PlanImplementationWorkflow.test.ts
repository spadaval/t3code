// @ts-nocheck
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CommandId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { GitVcsDriver, type GitVcsDriverShape } from "../../vcs/GitVcsDriver.ts";
import { ServerConfig, type ServerConfigShape } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ProjectionPlanImplementationLaunchRepositoryLive } from "../../persistence/Layers/ProjectionPlanImplementationLaunches.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { PlanImplementationWorkflow } from "../Services/PlanImplementationWorkflow.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { PlanImplementationWorkflowLive } from "./PlanImplementationWorkflow.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const now = "2026-03-10T12:00:00.000Z";

describe("PlanImplementationWorkflow", () => {
  let runtime: ManagedRuntime.ManagedRuntime<any, unknown> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness() {
    const createWorktree = vi.fn((params: { newRefName?: string; refName: string }) =>
      Effect.succeed({
        worktree: {
          path: `/tmp/worktrees/${params.newRefName ?? params.refName}`,
          refName: params.newRefName ?? params.refName,
        },
      }),
    );
    const listBranches = vi.fn(() =>
      Effect.succeed({
        isRepo: true,
        branches: [{ name: "main", isDefault: true, current: true, worktreePath: null }],
      }),
    );
    const listLocalBranchNames = vi.fn(() => Effect.succeed([]));
    const removeWorktree = vi.fn(() => Effect.void);
    const deleteLocalBranch = vi.fn(() => Effect.void);

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );

    const layer = PlanImplementationWorkflowLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(ProjectionPlanImplementationLaunchRepositoryLive),
      Layer.provideMerge(SqlitePersistenceMemory),
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
      Layer.provideMerge(
        Layer.succeed(GitVcsDriver, {
          createWorktree,
          listBranches,
          listLocalBranchNames,
          removeWorktree,
          deleteLocalBranch,
        } as unknown as GitVcsDriverShape),
      ),
      Layer.provideMerge(
        Layer.succeed(ServerConfig, {
          logLevel: "Info",
          traceMinLevel: "Info",
          traceTimingEnabled: true,
          traceBatchWindowMs: 200,
          traceMaxBytes: 10 * 1024 * 1024,
          traceMaxFiles: 10,
          otlpTracesUrl: undefined,
          otlpMetricsUrl: undefined,
          otlpExportIntervalMs: 10_000,
          otlpServiceName: "t3-server",
          mode: "web",
          port: 0,
          host: undefined,
          cwd: "/repo/project",
          baseDir: "/tmp/t3code-plan-implementation",
          keybindingsConfigPath: "/tmp/t3code-plan-implementation/keybindings.json",
          settingsPath: "/tmp/t3code-plan-implementation/settings.json",
          stateDir: "/tmp/t3code-plan-implementation",
          dbPath: "/tmp/t3code-plan-implementation/state.sqlite",
          worktreesDir: "/tmp/t3code-plan-implementation/worktrees",
          attachmentsDir: "/tmp/t3code-plan-implementation/attachments",
          logsDir: "/tmp/t3code-plan-implementation/logs",
          serverLogPath: "/tmp/t3code-plan-implementation/logs/server.log",
          serverTracePath: "/tmp/t3code-plan-implementation/logs/server.trace.ndjson",
          providerLogsDir: "/tmp/t3code-plan-implementation/logs/provider",
          providerEventLogPath: "/tmp/t3code-plan-implementation/logs/provider/events.log",
          terminalLogsDir: "/tmp/t3code-plan-implementation/logs/terminals",
          anonymousIdPath: "/tmp/t3code-plan-implementation/anonymous-id",
          staticDir: undefined,
          devUrl: undefined,
          noBrowser: true,
          authToken: undefined,
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
        } satisfies ServerConfigShape),
      ),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const workflow = await runtime.runPromise(Effect.service(PlanImplementationWorkflow));

    const projectId = asProjectId("project-1");
    const threadId = asThreadId("thread-1");

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project"),
        projectId,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt: now,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread"),
        threadId,
        projectId,
        title: "Planning thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
          options: [{ id: "reasoningEffort", value: "low" }],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/source",
        worktreePath: null,
        createdAt: now,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: CommandId.makeUnsafe("cmd-plan"),
        threadId,
        proposedPlan: {
          id: "plan-1",
          turnId: null,
          planIntent: "code-implementation",
          followUpOutcome: null,
          planMarkdown: "# Auth flow\n\n1. Implement it",
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    return {
      engine,
      workflow,
      createWorktree,
      listBranches,
      removeWorktree,
      deleteLocalBranch,
      threadId,
    };
  }

  it("launches a plan into a prepared worktree thread and marks it started", async () => {
    const harness = await createHarness();

    const result = await runtime!.runPromise(
      harness.workflow.launchPlanImplementation({
        sourceThreadId: harness.threadId,
        planId: "plan-1",
        runtimeMode: "full-access",
        launchMode: "worktree",
        runSetup: false,
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const launch = snapshot.planImplementationLaunches.find(
      (entry) => entry.launchId === result.launchId,
    );
    const targetThread = snapshot.threads.find((thread) => thread.id === result.targetThreadId);
    const pendingTurns = await runtime!.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          readonly sourceProposedPlanThreadId: string | null;
          readonly sourceProposedPlanId: string | null;
        }>`
          SELECT
            source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
            source_proposed_plan_id AS "sourceProposedPlanId"
          FROM projection_turns
          WHERE thread_id = ${result.targetThreadId}
            AND turn_id IS NULL
            AND state = 'pending'
        `;
      }),
    );

    expect(launch?.status).toBe("started");
    expect(launch?.preparedAt).not.toBeNull();
    expect(launch?.startedAt).not.toBeNull();
    expect(targetThread?.branch).toMatch(/^t3code\/[0-9a-f]{8}$/);
    expect(targetThread?.worktreePath).toContain(targetThread?.branch ?? "");
    expect(pendingTurns).toEqual([
      {
        sourceProposedPlanThreadId: harness.threadId,
        sourceProposedPlanId: "plan-1",
      },
    ]);
    expect(targetThread?.messages.at(-1)?.text).toContain("PLEASE IMPLEMENT THIS PLAN");
    expect(targetThread?.modelSelection.options).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "fastMode", value: true },
    ]);
    expect(harness.createWorktree).toHaveBeenCalled();
    expect(harness.listBranches).not.toHaveBeenCalled();
  });

  it("keeps explicit fast mode false on plan implementation launches", async () => {
    const harness = await createHarness();

    const result = await runtime!.runPromise(
      harness.workflow.launchPlanImplementation({
        sourceThreadId: harness.threadId,
        planId: "plan-1",
        modelOptions: [{ id: "fastMode", value: false }],
        runtimeMode: "full-access",
        launchMode: "worktree",
        runSetup: false,
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const targetThread = snapshot.threads.find((thread) => thread.id === result.targetThreadId);

    expect(targetThread?.modelSelection.options).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "fastMode", value: false },
    ]);
  });

  it("rejects retrying a started launch", async () => {
    const harness = await createHarness();

    const launch = await runtime!.runPromise(
      harness.workflow.launchPlanImplementation({
        sourceThreadId: harness.threadId,
        planId: "plan-1",
        runtimeMode: "full-access",
        launchMode: "worktree",
        runSetup: false,
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    await expect(
      runtime!.runPromise(
        harness.workflow.retryPlanImplementationLaunch({
          launchId: launch.launchId,
        }),
      ),
    ).rejects.toThrow("Only failed or cancelled launches can be retried.");
  });

  it("rejects launching a plan that already has a terminal follow-up outcome", async () => {
    const harness = await createHarness();
    const now = new Date().toISOString();

    await runtime!.runPromise(
      harness.engine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: CommandId.makeUnsafe("cmd-plan-closed"),
        threadId: harness.threadId,
        proposedPlan: {
          id: "plan-1",
          turnId: null,
          planIntent: "code-implementation",
          followUpOutcome: {
            kind: "implement-code",
            completedAt: now,
            targetThreadId: ThreadId.makeUnsafe("thread-existing"),
          },
          planMarkdown: "# Auth flow\n\n1. Implement it",
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await expect(
      runtime!.runPromise(
        harness.workflow.launchPlanImplementation({
          sourceThreadId: harness.threadId,
          planId: "plan-1",
          runtimeMode: "full-access",
          launchMode: "worktree",
          runSetup: false,
        }),
      ),
    ).rejects.toThrow("already has terminal follow-up");
  });
});
