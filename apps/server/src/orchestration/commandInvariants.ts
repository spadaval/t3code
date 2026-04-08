import type {
  OrchestrationCommand,
  OrchestrationPlanImplementationLaunch,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationSwarmRun,
  OrchestrationSwarmRunStatus,
  OrchestrationSwarmTaskExecution,
  OrchestrationSwarmTaskExecutionStatus,
  OrchestrationThread,
  ProjectId,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import { deriveSwarmRunExecutionState } from "@t3tools/shared/swarm";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

function invariantError(commandType: string, detail: string): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType,
    detail,
  });
}

export function findThreadById(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationThread | undefined {
  return readModel.threads.find((thread) => thread.id === threadId);
}

export function findProjectById(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): OrchestrationProject | undefined {
  return readModel.projects.find((project) => project.id === projectId);
}

export function findPlanImplementationLaunchById(
  readModel: OrchestrationReadModel,
  launchId: OrchestrationPlanImplementationLaunch["launchId"],
): OrchestrationPlanImplementationLaunch | undefined {
  return readModel.planImplementationLaunches.find((launch) => launch.launchId === launchId);
}

export function findSwarmRunById(
  readModel: OrchestrationReadModel,
  runId: SwarmRunId,
): OrchestrationSwarmRun | undefined {
  return readModel.swarmRuns.find((run) => run.runId === runId);
}

export function findSwarmTaskExecutionById(
  readModel: OrchestrationReadModel,
  executionId: SwarmTaskExecutionId,
): OrchestrationSwarmTaskExecution | undefined {
  return readModel.swarmTaskExecutions.find((execution) => execution.executionId === executionId);
}

const SWARM_RUN_ALLOWED_TRANSITIONS = {
  "swarm-run.mark-started": ["requested"],
  "swarm-run.mark-idle": ["running"],
  "swarm-run.pause": ["requested", "running", "idle", "blocked"],
  "swarm-run.resume": ["idle", "paused", "blocked"],
  "swarm-run.block": ["requested", "running", "idle", "blocked"],
  "swarm-run.fail": ["requested", "running", "idle", "paused", "blocked"],
  "swarm-run.cancel": ["requested", "running", "idle", "paused", "blocked"],
  "swarm-run.complete": ["requested", "running", "idle", "blocked"],
  "swarm-task-execution.request": ["requested", "running", "idle", "blocked"],
  "swarm-task-execution.start": ["requested", "running", "idle", "blocked"],
  "swarm-task-execution.complete": ["requested", "running", "idle", "blocked"],
  "swarm-task-execution.fail": ["requested", "running", "idle", "blocked"],
  "swarm-task-execution.cancel": ["requested", "running", "idle", "blocked"],
} as const satisfies Partial<
  Record<OrchestrationCommand["type"], ReadonlyArray<OrchestrationSwarmRunStatus>>
>;

const SWARM_TASK_EXECUTION_ALLOWED_TRANSITIONS = {
  "swarm-task-execution.start": ["requested"],
  "swarm-task-execution.complete": ["requested", "active"],
  "swarm-task-execution.fail": ["requested", "active"],
  "swarm-task-execution.cancel": ["requested", "active"],
} as const satisfies Partial<
  Record<OrchestrationCommand["type"], ReadonlyArray<OrchestrationSwarmTaskExecutionStatus>>
>;

export function listThreadsByProjectId(
  readModel: OrchestrationReadModel,
  projectId: ProjectId,
): ReadonlyArray<OrchestrationThread> {
  return readModel.threads.filter((thread) => thread.projectId === projectId);
}

export function requireProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<OrchestrationProject, OrchestrationCommandInvariantError> {
  const project = findProjectById(input.readModel, input.projectId);
  if (project) {
    return Effect.succeed(project);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireProjectAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findProjectById(input.readModel, input.projectId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireThread(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  const thread = findThreadById(input.readModel, input.threadId);
  if (thread) {
    return Effect.succeed(thread);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireThreadArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt !== null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is not archived for command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadNotArchived(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<OrchestrationThread, OrchestrationCommandInvariantError> {
  return requireThread(input).pipe(
    Effect.flatMap((thread) =>
      thread.archivedAt === null
        ? Effect.succeed(thread)
        : Effect.fail(
            invariantError(
              input.command.type,
              `Thread '${input.threadId}' is already archived and cannot handle command '${input.command.type}'.`,
            ),
          ),
    ),
  );
}

export function requireThreadAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findThreadById(input.readModel, input.threadId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Thread '${input.threadId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requirePlanImplementationLaunch(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly launchId: OrchestrationPlanImplementationLaunch["launchId"];
}): Effect.Effect<OrchestrationPlanImplementationLaunch, OrchestrationCommandInvariantError> {
  const launch = findPlanImplementationLaunchById(input.readModel, input.launchId);
  if (launch) {
    return Effect.succeed(launch);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Plan implementation launch '${input.launchId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requirePlanImplementationLaunchAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly launchId: OrchestrationPlanImplementationLaunch["launchId"];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findPlanImplementationLaunchById(input.readModel, input.launchId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Plan implementation launch '${input.launchId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireSwarmRun(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly runId: SwarmRunId;
}): Effect.Effect<OrchestrationSwarmRun, OrchestrationCommandInvariantError> {
  const run = findSwarmRunById(input.readModel, input.runId);
  if (run) {
    return Effect.succeed(run);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Swarm run '${input.runId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireSwarmRunAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly runId: SwarmRunId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findSwarmRunById(input.readModel, input.runId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Swarm run '${input.runId}' already exists and cannot be created twice.`,
    ),
  );
}

export function requireSwarmTaskExecution(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly executionId: SwarmTaskExecutionId;
}): Effect.Effect<OrchestrationSwarmTaskExecution, OrchestrationCommandInvariantError> {
  const execution = findSwarmTaskExecutionById(input.readModel, input.executionId);
  if (execution) {
    return Effect.succeed(execution);
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Swarm task execution '${input.executionId}' does not exist for command '${input.command.type}'.`,
    ),
  );
}

export function requireSwarmTaskExecutionAbsent(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly executionId: SwarmTaskExecutionId;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (!findSwarmTaskExecutionById(input.readModel, input.executionId)) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.command.type,
      `Swarm task execution '${input.executionId}' already exists and cannot be created twice.`,
    ),
  );
}

export function isAllowedSwarmRunStatusTransition(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly status: OrchestrationSwarmRunStatus;
}): boolean {
  const allowed =
    input.commandType in SWARM_RUN_ALLOWED_TRANSITIONS
      ? SWARM_RUN_ALLOWED_TRANSITIONS[
          input.commandType as keyof typeof SWARM_RUN_ALLOWED_TRANSITIONS
        ]
      : undefined;
  return allowed
    ? (allowed as ReadonlyArray<OrchestrationSwarmRunStatus>).includes(input.status)
    : true;
}

export function requireSwarmRunStatusTransition(input: {
  readonly command: OrchestrationCommand;
  readonly run: OrchestrationSwarmRun;
}): Effect.Effect<OrchestrationSwarmRun, OrchestrationCommandInvariantError> {
  if (
    isAllowedSwarmRunStatusTransition({
      commandType: input.command.type,
      status: input.run.status,
    })
  ) {
    return Effect.succeed(input.run);
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      `Swarm run '${input.run.runId}' in status '${input.run.status}' cannot transition via '${input.command.type}'.`,
    ),
  );
}

export function requireSwarmRunInAllowedStatus(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly runId: SwarmRunId;
}): Effect.Effect<OrchestrationSwarmRun, OrchestrationCommandInvariantError> {
  return requireSwarmRun(input).pipe(
    Effect.flatMap((run) =>
      requireSwarmRunStatusTransition({
        command: input.command,
        run,
      }),
    ),
  );
}

function getCurrentSwarmTaskExecutionForRun(
  readModel: OrchestrationReadModel,
  runId: SwarmRunId,
): OrchestrationSwarmTaskExecution | null {
  return deriveSwarmRunExecutionState({
    runId,
    executions: readModel.swarmTaskExecutions,
  }).currentExecution;
}

export function requireSwarmRunWithoutCurrentExecution(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly runId: SwarmRunId;
}): Effect.Effect<OrchestrationSwarmRun, OrchestrationCommandInvariantError> {
  return requireSwarmRunInAllowedStatus(input).pipe(
    Effect.flatMap((run) => {
      const currentExecution = getCurrentSwarmTaskExecutionForRun(input.readModel, input.runId);
      if (currentExecution === null) {
        return Effect.succeed(run);
      }

      return Effect.fail(
        invariantError(
          input.command.type,
          `Swarm run '${input.runId}' still has non-terminal task execution '${currentExecution.executionId}' in status '${currentExecution.status}'.`,
        ),
      );
    }),
  );
}

export function isAllowedSwarmTaskExecutionStatusTransition(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly status: OrchestrationSwarmTaskExecutionStatus;
}): boolean {
  const allowed =
    input.commandType in SWARM_TASK_EXECUTION_ALLOWED_TRANSITIONS
      ? SWARM_TASK_EXECUTION_ALLOWED_TRANSITIONS[
          input.commandType as keyof typeof SWARM_TASK_EXECUTION_ALLOWED_TRANSITIONS
        ]
      : undefined;
  return allowed
    ? (allowed as ReadonlyArray<OrchestrationSwarmTaskExecutionStatus>).includes(input.status)
    : true;
}

export function requireSwarmTaskExecutionForRunInAllowedStatus(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly executionId: SwarmTaskExecutionId;
  readonly runId: SwarmRunId;
}): Effect.Effect<OrchestrationSwarmTaskExecution, OrchestrationCommandInvariantError> {
  return requireSwarmTaskExecution(input).pipe(
    Effect.flatMap((execution) => {
      if (execution.runId !== input.runId) {
        return Effect.fail(
          invariantError(
            input.command.type,
            `Swarm task execution '${input.executionId}' belongs to run '${execution.runId}', not '${input.runId}'.`,
          ),
        );
      }

      if (
        isAllowedSwarmTaskExecutionStatusTransition({
          commandType: input.command.type,
          status: execution.status,
        })
      ) {
        return Effect.succeed(execution);
      }

      return Effect.fail(
        invariantError(
          input.command.type,
          `Swarm task execution '${input.executionId}' in status '${execution.status}' cannot transition via '${input.command.type}'.`,
        ),
      );
    }),
  );
}

export function requireCurrentSwarmTaskExecutionForRunInAllowedStatus(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly executionId: SwarmTaskExecutionId;
  readonly runId: SwarmRunId;
}): Effect.Effect<OrchestrationSwarmTaskExecution, OrchestrationCommandInvariantError> {
  return requireSwarmTaskExecutionForRunInAllowedStatus(input).pipe(
    Effect.flatMap((execution) => {
      const currentExecution = getCurrentSwarmTaskExecutionForRun(input.readModel, input.runId);
      if (currentExecution === null) {
        return Effect.fail(
          invariantError(
            input.command.type,
            `Swarm run '${input.runId}' does not have a current non-terminal task execution for command '${input.command.type}'.`,
          ),
        );
      }

      if (currentExecution.executionId === execution.executionId) {
        return Effect.succeed(execution);
      }

      return Effect.fail(
        invariantError(
          input.command.type,
          `Swarm task execution '${execution.executionId}' is stale for run '${input.runId}'; current non-terminal execution is '${currentExecution.executionId}'.`,
        ),
      );
    }),
  );
}

export function requireNonNegativeInteger(input: {
  readonly commandType: OrchestrationCommand["type"];
  readonly field: string;
  readonly value: number;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Effect.void;
  }
  return Effect.fail(
    invariantError(
      input.commandType,
      `${input.field} must be an integer greater than or equal to 0.`,
    ),
  );
}
