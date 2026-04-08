import {
  CommandId,
  ProjectId,
  SwarmRunId,
  SwarmTaskExecutionId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

const now = "2026-04-08T12:00:00.000Z";

function makeReadModel(): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(now),
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project 1",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    swarmRuns: [
      {
        runId: SwarmRunId.makeUnsafe("run-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        status: "running",
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
        cancelledAt: null,
        completedAt: null,
        updatedAt: now,
      },
    ],
    swarmTaskExecutions: [
      {
        executionId: SwarmTaskExecutionId.makeUnsafe("execution-1"),
        runId: SwarmRunId.makeUnsafe("run-1"),
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
    ],
  };
}

describe("decider swarm invariants", () => {
  it("rejects stale swarm run completion when a non-terminal execution still exists", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "swarm-run.complete",
            commandId: CommandId.makeUnsafe("cmd-run-complete"),
            runId: SwarmRunId.makeUnsafe("run-1"),
            createdAt: now,
          },
          readModel: makeReadModel(),
        }),
      ),
    ).rejects.toThrow("still has non-terminal task execution 'execution-1'");
  });

  it("rejects stale swarm execution requests while another execution is non-terminal", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "swarm-task-execution.request",
            commandId: CommandId.makeUnsafe("cmd-execution-request-2"),
            executionId: SwarmTaskExecutionId.makeUnsafe("execution-2"),
            runId: SwarmRunId.makeUnsafe("run-1"),
            issueId: "TASK-2",
            workerThreadId: "thread-2" as never,
            sequenceNumber: 2,
            originalStatus: "open",
            originalAssignee: null,
            createdAt: now,
          },
          readModel: makeReadModel(),
        }),
      ),
    ).rejects.toThrow("still has non-terminal task execution 'execution-1'");
  });

  it("rejects stale execution commands when another execution became current", async () => {
    const readModel = {
      ...makeReadModel(),
      swarmTaskExecutions: [
        ...makeReadModel().swarmTaskExecutions,
        {
          executionId: SwarmTaskExecutionId.makeUnsafe("execution-2"),
          runId: SwarmRunId.makeUnsafe("run-1"),
          issueId: "TASK-2",
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
    } satisfies OrchestrationReadModel;

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "swarm-task-execution.start",
            commandId: CommandId.makeUnsafe("cmd-execution-start-stale"),
            executionId: SwarmTaskExecutionId.makeUnsafe("execution-1"),
            runId: SwarmRunId.makeUnsafe("run-1"),
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("is stale for run 'run-1'; current non-terminal execution is 'execution-2'");
  });
});
