// @ts-nocheck
import {
  CommandId,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
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
    epicRuns: [
      {
        runId: EpicRunId.makeUnsafe("run-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        status: "running",
        provider: "codex",
        model: "gpt-5-codex",
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: null,
        runtimeMode: "full-access",
        failureContext: null,
        requestedAt: now,
        startedAt: now,
        stopRequestedAt: null,
        stoppedAt: null,
        failedAt: null,
        completedAt: null,
        updatedAt: now,
      },
    ],
    epicIssueExecutions: [
      {
        executionId: EpicIssueExecutionId.makeUnsafe("execution-1"),
        runId: EpicRunId.makeUnsafe("run-1"),
        issueId: "TASK-1",
        workerThreadId: null,
        sequenceNumber: 1,
        status: "launching",
        workspaceKey: "shared",
        workspacePath: null,
        failureContext: null,
        requestedAt: now,
        startedAt: null,
        stopRequestedAt: null,
        stoppedAt: null,
        completedAt: null,
        failedAt: null,
        updatedAt: now,
      },
    ],
  };
}

describe("decider epic-run invariants", () => {
  it("rejects stale epic-run completion when a non-terminal execution still exists", async () => {
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "epic-run.complete",
            commandId: CommandId.makeUnsafe("cmd-run-complete"),
            runId: EpicRunId.makeUnsafe("run-1"),
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
            type: "epic-issue-execution.request",
            commandId: CommandId.makeUnsafe("cmd-execution-request-2"),
            executionId: EpicIssueExecutionId.makeUnsafe("execution-2"),
            runId: EpicRunId.makeUnsafe("run-1"),
            issueId: "TASK-2",
            workerThreadId: "thread-2" as never,
            sequenceNumber: 2,
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
      epicIssueExecutions: [
        ...makeReadModel().epicIssueExecutions,
        {
          executionId: EpicIssueExecutionId.makeUnsafe("execution-2"),
          runId: EpicRunId.makeUnsafe("run-1"),
          issueId: "TASK-2",
          workerThreadId: null,
          sequenceNumber: 2,
          status: "launching",
          workspaceKey: "shared",
          workspacePath: null,
          failureContext: null,
          requestedAt: now,
          startedAt: null,
          stopRequestedAt: null,
          stoppedAt: null,
          completedAt: null,
          failedAt: null,
          updatedAt: now,
        },
      ],
    } satisfies OrchestrationReadModel;

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "epic-issue-execution.start",
            commandId: CommandId.makeUnsafe("cmd-execution-start-stale"),
            executionId: EpicIssueExecutionId.makeUnsafe("execution-1"),
            runId: EpicRunId.makeUnsafe("run-1"),
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("is stale for run 'run-1'; current non-terminal execution is 'execution-2'");
  });
});
