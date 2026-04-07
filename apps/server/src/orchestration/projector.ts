import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationPlanImplementationLaunch,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  MessageSentPayloadSchema,
  PlanImplementationLaunchCancelledPayload,
  PlanImplementationLaunchFailedPayload,
  PlanImplementationLaunchRequestedPayload,
  PlanImplementationLaunchStartedPayload,
  PlanImplementationLaunchWorktreePreparedPayload,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  SwarmRunBlockedPayload,
  SwarmRunCancelledPayload,
  SwarmRunCompletedPayload,
  SwarmRunFailedPayload,
  SwarmRunIdledPayload,
  SwarmRunPausedPayload,
  SwarmRunRequestedPayload,
  SwarmRunResumedPayload,
  SwarmRunStartedPayload,
  SwarmTaskExecutionCancelledPayload,
  SwarmTaskExecutionCompletedPayload,
  SwarmTaskExecutionFailedPayload,
  SwarmTaskExecutionStartedPayload,
  ThreadActivityAppendedPayload,
  ThreadArchivedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadUnarchivedPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function updateLaunch(
  launches: ReadonlyArray<OrchestrationPlanImplementationLaunch>,
  launchId: OrchestrationPlanImplementationLaunch["launchId"],
  patch: Partial<OrchestrationPlanImplementationLaunch>,
): OrchestrationPlanImplementationLaunch[] {
  return launches.map((launch) =>
    launch.launchId === launchId ? { ...launch, ...patch } : launch,
  );
}

function updateSwarmRun(
  runs: ReadonlyArray<OrchestrationSwarmRun>,
  runId: OrchestrationSwarmRun["runId"],
  patch: Partial<OrchestrationSwarmRun>,
): OrchestrationSwarmRun[] {
  return runs.map((run) => (run.runId === runId ? { ...run, ...patch } : run));
}

function updateSwarmTaskExecution(
  executions: ReadonlyArray<OrchestrationSwarmTaskExecution>,
  executionId: OrchestrationSwarmTaskExecution["executionId"],
  patch: Partial<OrchestrationSwarmTaskExecution>,
): OrchestrationSwarmTaskExecution[] {
  return executions.map((execution) =>
    execution.executionId === executionId ? { ...execution, ...patch } : execution,
  );
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    planImplementationLaunches: [],
    swarmRuns: [],
    swarmTaskExecutions: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            workspaceRoot: payload.workspaceRoot,
            defaultModelSelection: payload.defaultModelSelection,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  ...(payload.title !== undefined ? { title: payload.title } : {}),
                  ...(payload.workspaceRoot !== undefined
                    ? { workspaceRoot: payload.workspaceRoot }
                    : {}),
                  ...(payload.defaultModelSelection !== undefined
                    ? { defaultModelSelection: payload.defaultModelSelection }
                    : {}),
                  ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                  updatedAt: payload.updatedAt,
                }
              : project,
          ),
        })),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            modelSelection: payload.modelSelection,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            issueLink: payload.issueLink,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            archivedAt: null,
            deletedAt: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.archived":
      return decodeForEvent(ThreadArchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: payload.archivedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.unarchived":
      return decodeForEvent(ThreadUnarchivedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            archivedAt: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.modelSelection !== undefined
              ? { modelSelection: payload.modelSelection }
              : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            ...(payload.issueLink !== undefined ? { issueLink: payload.issueLink } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session,
            latestTurn:
              session.status === "running" && session.activeTurnId !== null
                ? {
                    turnId: session.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : session.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? (thread.latestTurn.startedAt ?? session.updatedAt)
                        : session.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === session.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  }
                : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            checkpoints,
            latestTurn: {
              turnId: payload.turnId,
              state: checkpointStatusToLatestTurnState(payload.status),
              requestedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? thread.latestTurn.requestedAt
                  : payload.completedAt,
              startedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? (thread.latestTurn.startedAt ?? payload.completedAt)
                  : payload.completedAt,
              completedAt: payload.completedAt,
              assistantMessageId: payload.assistantMessageId,
            },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "plan-implementation-launch.requested":
      return decodeForEvent(
        PlanImplementationLaunchRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const launch: OrchestrationPlanImplementationLaunch = {
            launchId: payload.launchId,
            sourceThreadId: payload.sourceThreadId,
            sourcePlanId: payload.sourcePlanId,
            projectId: payload.projectId,
            targetThreadId: payload.targetThreadId,
            retryOfLaunchId: payload.retryOfLaunchId,
            status: "requested",
            launchMode: payload.launchMode,
            branch: null,
            worktreePath: null,
            failureReason: null,
            cleanupStatus: "not-required",
            cleanupError: null,
            title: payload.title,
            setupEnabled: payload.setupEnabled,
            requestedAt: payload.requestedAt,
            preparedAt: null,
            startedAt: null,
            failedAt: null,
            cancelledAt: null,
            updatedAt: payload.updatedAt,
          };

          return {
            ...nextBase,
            planImplementationLaunches: [
              ...nextBase.planImplementationLaunches.filter(
                (entry) => entry.launchId !== payload.launchId,
              ),
              launch,
            ].toSorted((left, right) => left.requestedAt.localeCompare(right.requestedAt)),
          };
        }),
      );

    case "plan-implementation-launch.worktree-prepared":
      return decodeForEvent(
        PlanImplementationLaunchWorktreePreparedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          planImplementationLaunches: updateLaunch(
            nextBase.planImplementationLaunches,
            payload.launchId,
            {
              status: "prepared" as const,
              branch: payload.branch,
              worktreePath: payload.worktreePath,
              preparedAt: payload.preparedAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "plan-implementation-launch.started":
      return decodeForEvent(
        PlanImplementationLaunchStartedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          planImplementationLaunches: updateLaunch(
            nextBase.planImplementationLaunches,
            payload.launchId,
            {
              status: "started" as const,
              startedAt: payload.startedAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "plan-implementation-launch.failed":
      return decodeForEvent(
        PlanImplementationLaunchFailedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          planImplementationLaunches: updateLaunch(
            nextBase.planImplementationLaunches,
            payload.launchId,
            {
              status: "failed" as const,
              failureReason: payload.failureReason,
              cleanupStatus: payload.cleanupStatus,
              cleanupError: payload.cleanupError,
              failedAt: payload.failedAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "plan-implementation-launch.cancelled":
      return decodeForEvent(
        PlanImplementationLaunchCancelledPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          planImplementationLaunches: updateLaunch(
            nextBase.planImplementationLaunches,
            payload.launchId,
            {
              status: "cancelled" as const,
              cleanupStatus: payload.cleanupStatus,
              cleanupError: payload.cleanupError,
              cancelledAt: payload.cancelledAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "swarm-run.requested":
      return decodeForEvent(SwarmRunRequestedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const run: OrchestrationSwarmRun = {
            runId: payload.runId,
            projectId: payload.projectId,
            epicIssueId: payload.epicIssueId,
            swarmId: payload.swarmId,
            status: "requested",
            schedulerMode: payload.schedulerMode,
            workspaceMode: payload.workspaceMode,
            provider: payload.provider,
            model: payload.model,
            modelOptions: payload.modelOptions,
            providerOptions: payload.providerOptions,
            assistantDeliveryMode: payload.assistantDeliveryMode,
            runtimeMode: payload.runtimeMode,
            activeTaskExecutionId: null,
            latestTaskExecutionId: null,
            lastError: null,
            requestedAt: payload.requestedAt,
            startedAt: null,
            idledAt: null,
            pausedAt: null,
            blockedAt: null,
            failedAt: null,
            cancelledAt: null,
            completedAt: null,
            updatedAt: payload.updatedAt,
          };

          return {
            ...nextBase,
            swarmRuns: [
              ...nextBase.swarmRuns.filter((entry) => entry.runId !== payload.runId),
              run,
            ].toSorted(
              (left, right) =>
                left.requestedAt.localeCompare(right.requestedAt) ||
                left.runId.localeCompare(right.runId),
            ),
          };
        }),
      );

    case "swarm-run.started":
      return decodeForEvent(SwarmRunStartedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "running",
            startedAt: payload.startedAt,
            lastError: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.idled":
      return decodeForEvent(SwarmRunIdledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "idle",
            activeTaskExecutionId: null,
            idledAt: payload.idledAt,
            lastError: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.paused":
      return decodeForEvent(SwarmRunPausedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "paused",
            activeTaskExecutionId: null,
            pausedAt: payload.pausedAt,
            lastError: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.resumed":
      return decodeForEvent(SwarmRunResumedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "running",
            lastError: null,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.blocked":
      return decodeForEvent(SwarmRunBlockedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "blocked",
            activeTaskExecutionId: null,
            lastError: payload.reason,
            blockedAt: payload.blockedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.failed":
      return decodeForEvent(SwarmRunFailedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "failed",
            activeTaskExecutionId: null,
            lastError: payload.reason,
            failedAt: payload.failedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.cancelled":
      return decodeForEvent(SwarmRunCancelledPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "cancelled",
            activeTaskExecutionId: null,
            cancelledAt: payload.cancelledAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-run.completed":
      return decodeForEvent(SwarmRunCompletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            status: "completed",
            activeTaskExecutionId: null,
            completedAt: payload.completedAt,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "swarm-task-execution.started":
      return decodeForEvent(
        SwarmTaskExecutionStartedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const execution: OrchestrationSwarmTaskExecution = {
            executionId: payload.executionId,
            runId: payload.runId,
            issueId: payload.issueId,
            workerThreadId: payload.workerThreadId,
            sequenceNumber: payload.sequenceNumber,
            status: "active",
            lastError: null,
            startedAt: payload.startedAt,
            completedAt: null,
            failedAt: null,
            cancelledAt: null,
            updatedAt: payload.updatedAt,
          };

          return {
            ...nextBase,
            swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
              activeTaskExecutionId: payload.executionId,
              latestTaskExecutionId: payload.executionId,
              updatedAt: payload.updatedAt,
            }),
            swarmTaskExecutions: [
              ...nextBase.swarmTaskExecutions.filter(
                (entry) => entry.executionId !== payload.executionId,
              ),
              execution,
            ].toSorted(
              (left, right) =>
                left.runId.localeCompare(right.runId) ||
                left.sequenceNumber - right.sequenceNumber ||
                left.executionId.localeCompare(right.executionId),
            ),
          };
        }),
      );

    case "swarm-task-execution.completed":
      return decodeForEvent(
        SwarmTaskExecutionCompletedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            activeTaskExecutionId: null,
            latestTaskExecutionId: payload.executionId,
            updatedAt: payload.updatedAt,
          }),
          swarmTaskExecutions: updateSwarmTaskExecution(
            nextBase.swarmTaskExecutions,
            payload.executionId,
            {
              status: "completed",
              lastError: null,
              completedAt: payload.completedAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "swarm-task-execution.failed":
      return decodeForEvent(
        SwarmTaskExecutionFailedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            activeTaskExecutionId: null,
            latestTaskExecutionId: payload.executionId,
            updatedAt: payload.updatedAt,
          }),
          swarmTaskExecutions: updateSwarmTaskExecution(
            nextBase.swarmTaskExecutions,
            payload.executionId,
            {
              status: "failed",
              lastError: payload.reason,
              failedAt: payload.failedAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    case "swarm-task-execution.cancelled":
      return decodeForEvent(
        SwarmTaskExecutionCancelledPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          swarmRuns: updateSwarmRun(nextBase.swarmRuns, payload.runId, {
            activeTaskExecutionId: null,
            latestTaskExecutionId: payload.executionId,
            updatedAt: payload.updatedAt,
          }),
          swarmTaskExecutions: updateSwarmTaskExecution(
            nextBase.swarmTaskExecutions,
            payload.executionId,
            {
              status: "cancelled",
              lastError: null,
              cancelledAt: payload.cancelledAt,
              updatedAt: payload.updatedAt,
            },
          ),
        })),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
