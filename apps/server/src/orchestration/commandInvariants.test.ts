import { describe, expect, it } from "vitest";
import {
  MessageId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";

import {
  requireActionableProposedPlan,
  findThreadById,
  isAllowedSwarmRunStatusTransition,
  isAllowedSwarmTaskExecutionStatusTransition,
  listThreadsByProjectId,
  requireNonNegativeInteger,
  requireCurrentSwarmTaskExecutionForRunInAllowedStatus,
  requireSwarmTaskExecutionForRunInAllowedStatus,
  requireSwarmRunWithoutCurrentExecution,
  requireSwarmRunInAllowedStatus,
  requireThread,
  requireThreadAbsent,
} from "./commandInvariants.ts";

const now = new Date().toISOString();

const readModel: OrchestrationReadModel = {
  snapshotSequence: 2,
  updatedAt: now,
  projects: [
    {
      id: ProjectId.makeUnsafe("project-a"),
      title: "Project A",
      workspaceRoot: "/tmp/project-a",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: ProjectId.makeUnsafe("project-b"),
      title: "Project B",
      workspaceRoot: "/tmp/project-b",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: ProjectId.makeUnsafe("project-a"),
      title: "Thread A",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      issueLink: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
    {
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: ProjectId.makeUnsafe("project-b"),
      title: "Thread B",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      issueLink: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
  ],
  planImplementationLaunches: [],
  swarmRuns: [
    {
      runId: "run-1" as never,
      projectId: ProjectId.makeUnsafe("project-a"),
      epicIssueId: "EPIC-1",
      status: "blocked",
      schedulerMode: "automatic",
      workspaceMode: "shared",
      provider: "codex",
      model: "gpt-5-codex",
      modelOptions: null,
      providerOptions: null,
      assistantDeliveryMode: null,
      runtimeMode: "full-access",
      lastError: null,
      requestedAt: now,
      startedAt: now,
      idledAt: null,
      pausedAt: null,
      blockedAt: now,
      blockedContext: null,
      failedAt: null,
      cancelledAt: null,
      completedAt: null,
      updatedAt: now,
    },
    {
      runId: "run-2" as never,
      projectId: ProjectId.makeUnsafe("project-a"),
      epicIssueId: "EPIC-2",
      status: "cancelled",
      schedulerMode: "automatic",
      workspaceMode: "shared",
      provider: "codex",
      model: "gpt-5-codex",
      modelOptions: null,
      providerOptions: null,
      assistantDeliveryMode: null,
      runtimeMode: "full-access",
      lastError: null,
      requestedAt: now,
      startedAt: now,
      idledAt: null,
      pausedAt: null,
      blockedAt: null,
      blockedContext: null,
      failedAt: null,
      cancelledAt: now,
      completedAt: null,
      updatedAt: now,
    },
  ],
  swarmTaskExecutions: [
    {
      executionId: "execution-1" as never,
      runId: "run-1" as never,
      issueId: "TASK-1",
      workerThreadId: null,
      sequenceNumber: 1,
      status: "requested",
      originalStatus: "open",
      originalAssignee: "issue-owner",
      lastError: null,
      requestedAt: now,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      updatedAt: now,
    },
    {
      executionId: "execution-2" as never,
      runId: "run-2" as never,
      issueId: "TASK-2",
      workerThreadId: null,
      sequenceNumber: 1,
      status: "completed",
      originalStatus: "open",
      originalAssignee: null,
      lastError: null,
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      failedAt: null,
      cancelledAt: null,
      updatedAt: now,
    },
  ],
};

const messageSendCommand: OrchestrationCommand = {
  type: "thread.turn.start",
  commandId: CommandId.makeUnsafe("cmd-1"),
  threadId: ThreadId.makeUnsafe("thread-1"),
  message: {
    messageId: MessageId.makeUnsafe("msg-1"),
    role: "user",
    text: "hello",
    attachments: [],
  },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "approval-required",
  createdAt: now,
};

describe("commandInvariants", () => {
  it("finds threads by id and project", () => {
    expect(findThreadById(readModel, ThreadId.makeUnsafe("thread-1"))?.projectId).toBe("project-a");
    expect(findThreadById(readModel, ThreadId.makeUnsafe("missing"))).toBeUndefined();
    expect(
      listThreadsByProjectId(readModel, ProjectId.makeUnsafe("project-b")).map(
        (thread) => thread.id,
      ),
    ).toEqual([ThreadId.makeUnsafe("thread-2")]);
  });

  it("requires existing thread", async () => {
    const thread = await Effect.runPromise(
      requireThread({
        readModel,
        command: messageSendCommand,
        threadId: ThreadId.makeUnsafe("thread-1"),
      }),
    );
    expect(thread.id).toBe(ThreadId.makeUnsafe("thread-1"));

    await expect(
      Effect.runPromise(
        requireThread({
          readModel,
          command: messageSendCommand,
          threadId: ThreadId.makeUnsafe("missing"),
        }),
      ),
    ).rejects.toThrow("does not exist");
  });

  it("requires missing thread for create flows", async () => {
    await Effect.runPromise(
      requireThreadAbsent({
        readModel,
        command: {
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-2"),
          threadId: ThreadId.makeUnsafe("thread-3"),
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "new",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        threadId: ThreadId.makeUnsafe("thread-3"),
      }),
    );

    await expect(
      Effect.runPromise(
        requireThreadAbsent({
          readModel,
          command: {
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-3"),
            threadId: ThreadId.makeUnsafe("thread-1"),
            projectId: ProjectId.makeUnsafe("project-a"),
            title: "dup",
            modelSelection: {
              provider: "codex",
              model: "gpt-5-codex",
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "full-access",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
          threadId: ThreadId.makeUnsafe("thread-1"),
        }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("requires proposed plans without terminal follow-up outcomes", async () => {
    const readModelWithPlan: OrchestrationReadModel = {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id !== ThreadId.makeUnsafe("thread-1")
          ? thread
          : {
              ...thread,
              proposedPlans: [
                {
                  id: "plan-open" as never,
                  turnId: null,
                  planMarkdown: "# Open plan",
                  planIntent: "code-implementation",
                  followUpOutcome: null,
                  createdAt: now,
                  updatedAt: now,
                },
                {
                  id: "plan-closed" as never,
                  turnId: null,
                  planMarkdown: "# Closed plan",
                  planIntent: "tracker-refinement",
                  followUpOutcome: {
                    kind: "convert-to-tracker",
                    completedAt: now,
                    targetThreadId: null,
                  },
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
      ),
    };

    const actionablePlan = await Effect.runPromise(
      requireActionableProposedPlan({
        readModel: readModelWithPlan,
        command: messageSendCommand,
        threadId: ThreadId.makeUnsafe("thread-1"),
        planId: "plan-open",
      }),
    );
    expect(actionablePlan.id).toBe("plan-open");

    await expect(
      Effect.runPromise(
        requireActionableProposedPlan({
          readModel: readModelWithPlan,
          command: messageSendCommand,
          threadId: ThreadId.makeUnsafe("thread-1"),
          planId: "plan-closed",
        }),
      ),
    ).rejects.toThrow("already has terminal follow-up");
  });

  it("requires non-negative integers", async () => {
    await Effect.runPromise(
      requireNonNegativeInteger({
        commandType: "thread.checkpoint.revert",
        field: "turnCount",
        value: 0,
      }),
    );

    await expect(
      Effect.runPromise(
        requireNonNegativeInteger({
          commandType: "thread.checkpoint.revert",
          field: "turnCount",
          value: -1,
        }),
      ),
    ).rejects.toThrow("greater than or equal to 0");
  });

  it("checks swarm run status transitions", async () => {
    expect(
      isAllowedSwarmRunStatusTransition({
        commandType: "swarm-run.resume",
        status: "blocked",
      }),
    ).toBe(true);
    expect(
      isAllowedSwarmRunStatusTransition({
        commandType: "swarm-run.resume",
        status: "cancelled",
      }),
    ).toBe(true);
    expect(
      isAllowedSwarmRunStatusTransition({
        commandType: "swarm-run.resume",
        status: "completed",
      }),
    ).toBe(false);

    await Effect.runPromise(
      requireSwarmRunInAllowedStatus({
        readModel,
        command: {
          type: "swarm-run.resume",
          commandId: CommandId.makeUnsafe("cmd-run-resume"),
          runId: "run-1" as never,
          createdAt: now,
        },
        runId: "run-1" as never,
      }),
    );

    await Effect.runPromise(
      requireSwarmRunInAllowedStatus({
        readModel,
        command: {
          type: "swarm-run.resume",
          commandId: CommandId.makeUnsafe("cmd-run-resume-cancelled"),
          runId: "run-2" as never,
          createdAt: now,
        },
        runId: "run-2" as never,
      }),
    );
  });

  it("checks swarm task execution run ownership and status transitions", async () => {
    expect(
      isAllowedSwarmTaskExecutionStatusTransition({
        commandType: "swarm-task-execution.complete",
        status: "requested",
      }),
    ).toBe(true);
    expect(
      isAllowedSwarmTaskExecutionStatusTransition({
        commandType: "swarm-task-execution.complete",
        status: "completed",
      }),
    ).toBe(false);

    await Effect.runPromise(
      requireSwarmTaskExecutionForRunInAllowedStatus({
        readModel,
        command: {
          type: "swarm-task-execution.complete",
          commandId: CommandId.makeUnsafe("cmd-execution-complete"),
          executionId: "execution-1" as never,
          runId: "run-1" as never,
          createdAt: now,
        },
        executionId: "execution-1" as never,
        runId: "run-1" as never,
      }),
    );

    await expect(
      Effect.runPromise(
        requireSwarmTaskExecutionForRunInAllowedStatus({
          readModel,
          command: {
            type: "swarm-task-execution.complete",
            commandId: CommandId.makeUnsafe("cmd-execution-complete-stale"),
            executionId: "execution-2" as never,
            runId: "run-1" as never,
            createdAt: now,
          },
          executionId: "execution-2" as never,
          runId: "run-1" as never,
        }),
      ),
    ).rejects.toThrow(/belongs to run|cannot transition/);
  });

  it("rejects run commands while a non-terminal swarm task execution still exists", async () => {
    await expect(
      Effect.runPromise(
        requireSwarmRunWithoutCurrentExecution({
          readModel,
          command: {
            type: "swarm-run.complete",
            commandId: CommandId.makeUnsafe("cmd-run-complete-stale"),
            runId: "run-1" as never,
            createdAt: now,
          },
          runId: "run-1" as never,
        }),
      ),
    ).rejects.toThrow("still has non-terminal task execution 'execution-1'");
  });

  it("rejects stale swarm task execution commands when another execution is current", async () => {
    const readModelWithNewerExecution: OrchestrationReadModel = {
      ...readModel,
      swarmRuns: readModel.swarmRuns.map((run) =>
        run.runId === ("run-1" as never) ? { ...run, status: "running" } : run,
      ),
      swarmTaskExecutions: [
        ...readModel.swarmTaskExecutions,
        {
          executionId: "execution-3" as never,
          runId: "run-1" as never,
          issueId: "TASK-3",
          workerThreadId: null,
          sequenceNumber: 2,
          status: "requested",
          originalStatus: "open",
          originalAssignee: null,
          lastError: null,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          cancelledAt: null,
          updatedAt: now,
        },
      ],
    };

    await expect(
      Effect.runPromise(
        requireCurrentSwarmTaskExecutionForRunInAllowedStatus({
          readModel: readModelWithNewerExecution,
          command: {
            type: "swarm-task-execution.start",
            commandId: CommandId.makeUnsafe("cmd-execution-start-stale"),
            executionId: "execution-1" as never,
            runId: "run-1" as never,
            createdAt: now,
          },
          executionId: "execution-1" as never,
          runId: "run-1" as never,
        }),
      ),
    ).rejects.toThrow("is stale for run 'run-1'; current non-terminal execution is 'execution-3'");
  });
});
