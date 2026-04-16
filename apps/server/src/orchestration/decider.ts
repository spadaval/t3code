import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@t3tools/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  requireActionableProposedPlan,
  requireCurrentEpicIssueExecutionForRunInAllowedStatus,
  requireNoConflictingSharedWorkspaceRun,
  requireNoNonTerminalRunForEpic,
  requirePlanImplementationLaunch,
  requirePlanImplementationLaunchAbsent,
  requireProject,
  requireProjectAbsent,
  requireEpicIssueExecutionAbsent,
  requireEpicRunAbsent,
  requireEpicRunInAllowedStatus,
  requireEpicRunWithoutCurrentExecution,
  requireThread,
  requireThreadArchived,
  requireThreadAbsent,
  requireThreadNotArchived,
} from "./commandInvariants.ts";

const nowIso = () => new Date().toISOString();
const defaultMetadata: Omit<OrchestrationEvent, "sequence" | "type" | "payload"> = {
  eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
  aggregateKind: "thread",
  aggregateId: "" as OrchestrationEvent["aggregateId"],
  occurredAt: nowIso(),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
};

function withEventBase(
  input: Pick<OrchestrationCommand, "commandId"> & {
    readonly aggregateKind: OrchestrationEvent["aggregateKind"];
    readonly aggregateId: OrchestrationEvent["aggregateId"];
    readonly occurredAt: string;
    readonly metadata?: OrchestrationEvent["metadata"];
  },
): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    ...defaultMetadata,
    eventId: crypto.randomUUID() as OrchestrationEvent["eventId"],
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

export const decideOrchestrationCommand = Effect.fn("decideOrchestrationCommand")(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  Omit<OrchestrationEvent, "sequence"> | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  OrchestrationCommandInvariantError
> {
  switch (command.type) {
    case "project.create": {
      yield* requireProjectAbsent({
        readModel,
        command,
        projectId: command.projectId,
      });

      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "project.created",
        payload: {
          projectId: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "project.meta.update": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.meta-updated",
        payload: {
          projectId: command.projectId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "project.delete": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "project",
          aggregateId: command.projectId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "project.deleted",
        payload: {
          projectId: command.projectId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.create": {
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireThreadAbsent({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.created",
        payload: {
          threadId: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          issueLink: command.issueLink ?? null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.delete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.deleted",
        payload: {
          threadId: command.threadId,
          deletedAt: occurredAt,
        },
      };
    }

    case "thread.archive": {
      yield* requireThreadNotArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.archived",
        payload: {
          threadId: command.threadId,
          archivedAt: occurredAt,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.unarchive": {
      yield* requireThreadArchived({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.unarchived",
        payload: {
          threadId: command.threadId,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.meta.update": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.meta-updated",
        payload: {
          threadId: command.threadId,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          ...(command.issueLink !== undefined ? { issueLink: command.issueLink } : {}),
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.runtime-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.runtime-mode-set",
        payload: {
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.interaction-mode.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const occurredAt = nowIso();
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt,
          commandId: command.commandId,
        }),
        type: "thread.interaction-mode-set",
        payload: {
          threadId: command.threadId,
          interactionMode: command.interactionMode,
          updatedAt: occurredAt,
        },
      };
    }

    case "thread.turn.start": {
      const targetThread = yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const sourceProposedPlan = command.sourceProposedPlan;
      const sourceThread = sourceProposedPlan
        ? yield* requireThread({
            readModel,
            command,
            threadId: sourceProposedPlan.threadId,
          })
        : null;
      if (sourceProposedPlan && sourceThread) {
        yield* requireActionableProposedPlan({
          readModel,
          command,
          threadId: sourceProposedPlan.threadId,
          planId: sourceProposedPlan.planId,
        });
      }
      if (sourceThread && sourceThread.projectId !== targetThread.projectId) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Proposed plan '${sourceProposedPlan?.planId}' belongs to thread '${sourceThread.id}' in a different project.`,
        });
      }
      const userMessageEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          role: "user",
          text: command.message.text,
          attachments: command.message.attachments,
          turnId: null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
      const turnStartRequestedEvent: Omit<OrchestrationEvent, "sequence"> = {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        causationEventId: userMessageEvent.eventId,
        type: "thread.turn-start-requested",
        payload: {
          threadId: command.threadId,
          messageId: command.message.messageId,
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.titleSeed !== undefined ? { titleSeed: command.titleSeed } : {}),
          runtimeMode: targetThread.runtimeMode,
          interactionMode: targetThread.interactionMode,
          ...(sourceProposedPlan !== undefined ? { sourceProposedPlan } : {}),
          createdAt: command.createdAt,
        },
      };
      return [userMessageEvent, turnStartRequestedEvent];
    }

    case "thread.turn.interrupt": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-interrupt-requested",
        payload: {
          threadId: command.threadId,
          ...(command.turnId !== undefined ? { turnId: command.turnId } : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.approval.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.approval-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          decision: command.decision,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.user-input.respond": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            requestId: command.requestId,
          },
        }),
        type: "thread.user-input-response-requested",
        payload: {
          threadId: command.threadId,
          requestId: command.requestId,
          answers: command.answers,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.checkpoint.revert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-revert-requested",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.stop": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.session-stop-requested",
        payload: {
          threadId: command.threadId,
          createdAt: command.createdAt,
        },
      };
    }

    case "thread.session.set": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {},
        }),
        type: "thread.session-set",
        payload: {
          threadId: command.threadId,
          session: command.session,
          ...(command.settledTurn !== undefined ? { settledTurn: command.settledTurn } : {}),
        },
      };
    }

    case "thread.message.assistant.delta": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: command.delta,
          turnId: command.turnId ?? null,
          streaming: true,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.message.assistant.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.message-sent",
        payload: {
          threadId: command.threadId,
          messageId: command.messageId,
          role: "assistant",
          text: "",
          turnId: command.turnId ?? null,
          streaming: false,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "thread.proposed-plan.upsert": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.proposed-plan-upserted",
        payload: {
          threadId: command.threadId,
          proposedPlan: command.proposedPlan,
        },
      };
    }

    case "thread.checkpoint.capture.request": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.checkpoint-capture-requested",
        payload: {
          threadId: command.threadId,
          request: {
            turnId: command.turnId,
            checkpointTurnCount: command.checkpointTurnCount,
            assistantMessageId: command.assistantMessageId ?? null,
            requestedAt: command.requestedAt,
          },
        },
      };
    }

    case "thread.turn.diff.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.turn-diff-completed",
        payload: {
          threadId: command.threadId,
          turnId: command.turnId,
          checkpointTurnCount: command.checkpointTurnCount,
          checkpointRef: command.checkpointRef,
          status: command.status,
          files: command.files,
          assistantMessageId: command.assistantMessageId ?? null,
          completedAt: command.completedAt,
        },
      };
    }

    case "thread.revert.complete": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "thread.reverted",
        payload: {
          threadId: command.threadId,
          turnCount: command.turnCount,
        },
      };
    }

    case "thread.activity.append": {
      yield* requireThread({
        readModel,
        command,
        threadId: command.threadId,
      });
      const requestId =
        typeof command.activity.payload === "object" &&
        command.activity.payload !== null &&
        "requestId" in command.activity.payload &&
        typeof (command.activity.payload as { requestId?: unknown }).requestId === "string"
          ? ((command.activity.payload as { requestId: string })
              .requestId as OrchestrationEvent["metadata"]["requestId"])
          : undefined;
      return {
        ...withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          ...(requestId !== undefined ? { metadata: { requestId } } : {}),
        }),
        type: "thread.activity-appended",
        payload: {
          threadId: command.threadId,
          activity: command.activity,
        },
      };
    }

    case "plan-implementation-launch.request": {
      yield* requirePlanImplementationLaunchAbsent({
        readModel,
        command,
        launchId: command.launchId,
      });
      yield* requireThread({
        readModel,
        command,
        threadId: command.sourceThreadId,
      });
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "planImplementationLaunch",
          aggregateId: command.launchId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "plan-implementation-launch.requested",
        payload: {
          launchId: command.launchId,
          sourceThreadId: command.sourceThreadId,
          sourcePlanId: command.sourcePlanId,
          projectId: command.projectId,
          targetThreadId: command.targetThreadId,
          retryOfLaunchId: command.retryOfLaunchId ?? null,
          title: command.title,
          setupEnabled: command.setupEnabled,
          launchMode: command.launchMode,
          promptText: command.promptText,
          provider: command.provider ?? null,
          model: command.model ?? null,
          modelOptions: command.modelOptions ?? null,
          providerOptions: command.providerOptions ?? null,
          assistantDeliveryMode: command.assistantDeliveryMode ?? null,
          runtimeMode: command.runtimeMode,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "plan-implementation-launch.mark-worktree-prepared": {
      yield* requirePlanImplementationLaunch({
        readModel,
        command,
        launchId: command.launchId,
      });
      return {
        ...withEventBase({
          aggregateKind: "planImplementationLaunch",
          aggregateId: command.launchId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "plan-implementation-launch.worktree-prepared",
        payload: {
          launchId: command.launchId,
          branch: command.branch,
          worktreePath: command.worktreePath,
          preparedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "plan-implementation-launch.mark-started": {
      yield* requirePlanImplementationLaunch({
        readModel,
        command,
        launchId: command.launchId,
      });
      return {
        ...withEventBase({
          aggregateKind: "planImplementationLaunch",
          aggregateId: command.launchId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "plan-implementation-launch.started",
        payload: {
          launchId: command.launchId,
          startedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "plan-implementation-launch.fail": {
      yield* requirePlanImplementationLaunch({
        readModel,
        command,
        launchId: command.launchId,
      });
      return {
        ...withEventBase({
          aggregateKind: "planImplementationLaunch",
          aggregateId: command.launchId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "plan-implementation-launch.failed",
        payload: {
          launchId: command.launchId,
          failureReason: command.failureReason,
          cleanupStatus: command.cleanupStatus,
          cleanupError: command.cleanupError ?? null,
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "plan-implementation-launch.cancel": {
      yield* requirePlanImplementationLaunch({
        readModel,
        command,
        launchId: command.launchId,
      });
      return {
        ...withEventBase({
          aggregateKind: "planImplementationLaunch",
          aggregateId: command.launchId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "plan-implementation-launch.cancelled",
        payload: {
          launchId: command.launchId,
          cleanupStatus: command.cleanupStatus,
          cleanupError: command.cleanupError ?? null,
          cancelledAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-run.request": {
      yield* requireEpicRunAbsent({
        readModel,
        command,
        runId: command.runId,
      });
      yield* requireProject({
        readModel,
        command,
        projectId: command.projectId,
      });
      yield* requireNoNonTerminalRunForEpic({
        readModel,
        command,
        projectId: command.projectId,
        epicIssueId: command.epicIssueId,
      });
      yield* requireNoConflictingSharedWorkspaceRun({
        readModel,
        command,
        projectId: command.projectId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicRun",
          aggregateId: command.runId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-run.requested",
        payload: {
          runId: command.runId,
          projectId: command.projectId,
          epicIssueId: command.epicIssueId,
          provider: command.provider ?? null,
          model: command.model ?? null,
          modelOptions: command.modelOptions ?? null,
          providerOptions: command.providerOptions ?? null,
          assistantDeliveryMode: command.assistantDeliveryMode ?? null,
          runtimeMode: command.runtimeMode,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-run.mark-started": {
      yield* requireEpicRunInAllowedStatus({
        readModel,
        command,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicRun",
          aggregateId: command.runId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-run.started",
        payload: {
          runId: command.runId,
          startedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-run.fail": {
      yield* requireEpicRunInAllowedStatus({
        readModel,
        command,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicRun",
          aggregateId: command.runId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-run.failed",
        payload: {
          runId: command.runId,
          reason: command.reason,
          issueId: command.issueId ?? null,
          executionId: command.executionId ?? null,
          workerThreadId: command.workerThreadId ?? null,
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-run.stop": {
      yield* requireEpicRunWithoutCurrentExecution({
        readModel,
        command,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicRun",
          aggregateId: command.runId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-run.stopped",
        payload: {
          runId: command.runId,
          stoppedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-run.complete": {
      yield* requireEpicRunWithoutCurrentExecution({
        readModel,
        command,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicRun",
          aggregateId: command.runId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-run.completed",
        payload: {
          runId: command.runId,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-issue-execution.request": {
      yield* requireEpicRunWithoutCurrentExecution({
        readModel,
        command,
        runId: command.runId,
      });
      yield* requireEpicIssueExecutionAbsent({
        readModel,
        command,
        executionId: command.executionId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicIssueExecution",
          aggregateId: command.executionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-issue-execution.requested",
        payload: {
          executionId: command.executionId,
          runId: command.runId,
          issueId: command.issueId,
          workerThreadId: command.workerThreadId,
          sequenceNumber: command.sequenceNumber,
          requestedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-issue-execution.start": {
      yield* requireCurrentEpicIssueExecutionForRunInAllowedStatus({
        readModel,
        command,
        executionId: command.executionId,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicIssueExecution",
          aggregateId: command.executionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-issue-execution.started",
        payload: {
          executionId: command.executionId,
          runId: command.runId,
          startedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-issue-execution.complete": {
      yield* requireCurrentEpicIssueExecutionForRunInAllowedStatus({
        readModel,
        command,
        executionId: command.executionId,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicIssueExecution",
          aggregateId: command.executionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-issue-execution.completed",
        payload: {
          executionId: command.executionId,
          runId: command.runId,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-issue-execution.fail": {
      yield* requireCurrentEpicIssueExecutionForRunInAllowedStatus({
        readModel,
        command,
        executionId: command.executionId,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicIssueExecution",
          aggregateId: command.executionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-issue-execution.failed",
        payload: {
          executionId: command.executionId,
          runId: command.runId,
          reason: command.reason,
          failedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    case "epic-issue-execution.stop": {
      yield* requireCurrentEpicIssueExecutionForRunInAllowedStatus({
        readModel,
        command,
        executionId: command.executionId,
        runId: command.runId,
      });
      return {
        ...withEventBase({
          aggregateKind: "epicIssueExecution",
          aggregateId: command.executionId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "epic-issue-execution.stopped",
        payload: {
          executionId: command.executionId,
          runId: command.runId,
          stoppedAt: command.createdAt,
          updatedAt: command.createdAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* new OrchestrationCommandInvariantError({
        commandType: fallback.type,
        detail: `Unknown command type: ${fallback.type}`,
      });
    }
  }
});
