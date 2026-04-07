import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import { type GitCoreShape, GitCore } from "../../git/Services/GitCore.ts";
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

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const now = "2026-03-10T12:00:00.000Z";

describe("PlanImplementationWorkflow", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | PlanImplementationWorkflow,
    unknown
  > | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  async function createHarness() {
    const createWorktree = vi.fn((params: { newBranch?: string; branch: string }) =>
      Effect.succeed({
        worktree: {
          path: `/tmp/worktrees/${params.newBranch ?? params.branch}`,
          branch: params.newBranch ?? params.branch,
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
        Layer.succeed(GitCore, {
          createWorktree,
          listBranches,
          listLocalBranchNames,
          removeWorktree,
          deleteLocalBranch,
        } as unknown as GitCoreShape),
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
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
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
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
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
          implementedAt: null,
          implementationThreadId: null,
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
        runSetup: false,
      }),
    );
    await runtime!.runPromise(harness.workflow.drain);

    const snapshot = await runtime!.runPromise(harness.engine.getReadModel());
    const launch = snapshot.planImplementationLaunches.find(
      (entry) => entry.launchId === result.launchId,
    );
    const targetThread = snapshot.threads.find((thread) => thread.id === result.targetThreadId);

    expect(launch?.status).toBe("started");
    expect(launch?.preparedAt).not.toBeNull();
    expect(launch?.startedAt).not.toBeNull();
    expect(targetThread?.branch).toMatch(/^t3code\/[0-9a-f]{8}$/);
    expect(targetThread?.worktreePath).toContain(targetThread?.branch ?? "");
    expect(targetThread?.messages.at(-1)?.text).toContain("PLEASE IMPLEMENT THIS PLAN");
    expect(harness.createWorktree).toHaveBeenCalled();
    expect(harness.listBranches).not.toHaveBeenCalled();
  });

  it("rejects retrying a started launch", async () => {
    const harness = await createHarness();

    const launch = await runtime!.runPromise(
      harness.workflow.launchPlanImplementation({
        sourceThreadId: harness.threadId,
        planId: "plan-1",
        runtimeMode: "full-access",
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
});
