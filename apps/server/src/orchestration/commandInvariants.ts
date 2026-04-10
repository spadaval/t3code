import type {
  OrchestrationCommand,
  OrchestrationPlanImplementationLaunch,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestrationStartEpicRunInput,
  OrchestrationEpicRun,
  OrchestrationSwarmRunStatus,
  OrchestrationEpicIssueExecution,
  OrchestrationSwarmTaskExecutionStatus,
  OrchestrationThread,
  ProjectId,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import {
  deriveSwarmRunExecutionState,
  isNonTerminalSharedWorkspaceRun,
  isNonTerminalSwarmRunStatus,
} from "@t3tools/shared/swarm";
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
  runId: EpicRunId,
): OrchestrationEpicRun | undefined {
  return readModel.epicRuns.find((run) => run.runId === runId);
}

export function findSwarmTaskExecutionById(
  readModel: OrchestrationReadModel,
  executionId: EpicIssueExecutionId,
): OrchestrationEpicIssueExecution | undefined {
  return readModel.epicIssueExecutions.find((execution) => execution.executionId === executionId);
}

const SWARM_RUN_ALLOWED_TRANSITIONS = {
  "swarm-run.mark-started": ["pending"],
  "swarm-run.mark-idle": ["running"],
  "swarm-run.pause": ["pending", "running", "stopping"],
  "swarm-run.resume": [],
  "swarm-run.block": ["pending", "running", "stopping"],
  "swarm-run.fail": ["pending", "running", "stopping"],
  "swarm-run.cancel": ["pending", "running", "stopping"],
  "swarm-run.complete": ["pending", "running"],
  "swarm-task-execution.request": ["pending", "running"],
  "swarm-task-execution.start": ["pending", "running"],
  "swarm-task-execution.complete": ["pending", "running", "stopping"],
  "swarm-task-execution.fail": ["pending", "running", "stopping"],
  "swarm-task-execution.cancel": ["pending", "running", "stopping"],
} as const satisfies Partial<
  Record<OrchestrationCommand["type"], ReadonlyArray<OrchestrationSwarmRunStatus>>
>;

const SWARM_TASK_EXECUTION_ALLOWED_TRANSITIONS = {
  "swarm-task-execution.start": ["launching"],
  "swarm-task-execution.complete": ["launching", "running", "stopping"],
  "swarm-task-execution.fail": ["launching", "running", "stopping"],
  "swarm-task-execution.cancel": ["launching", "running", "stopping"],
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

export function requireActionableProposedPlan(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly threadId: ThreadId;
  readonly planId: string;
}): Effect.Effect<
  OrchestrationThread["proposedPlans"][number],
  OrchestrationCommandInvariantError
> {
  return requireThread({
    readModel: input.readModel,
    command: input.command,
    threadId: input.threadId,
  }).pipe(
    Effect.flatMap((thread) => {
      const proposedPlan = thread.proposedPlans.find((entry) => entry.id === input.planId);
      if (!proposedPlan) {
        return Effect.fail(
          invariantError(
            input.command.type,
            `Proposed plan '${input.planId}' does not exist on thread '${input.threadId}'.`,
          ),
        );
      }

      if (proposedPlan.followUpOutcome !== null) {
        return Effect.fail(
          invariantError(
            input.command.type,
            `Proposed plan '${input.planId}' on thread '${input.threadId}' already has terminal follow-up '${proposedPlan.followUpOutcome.kind}'.`,
          ),
        );
      }

      return Effect.succeed(proposedPlan);
    }),
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
  readonly runId: EpicRunId;
}): Effect.Effect<OrchestrationEpicRun, OrchestrationCommandInvariantError> {
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
  readonly runId: EpicRunId;
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

export function findNonTerminalRunForEpic(input: {
  readonly readModel: OrchestrationReadModel;
  readonly projectId: ProjectId;
  readonly epicIssueId: string;
}): OrchestrationEpicRun | undefined {
  return input.readModel.epicRuns.find(
    (run) =>
      run.projectId === input.projectId &&
      run.epicIssueId === input.epicIssueId &&
      isNonTerminalSwarmRunStatus(run.status),
  );
}

export function requireNoNonTerminalRunForEpic(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
  readonly epicIssueId: string;
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  const existingRun = findNonTerminalRunForEpic(input);
  if (!existingRun) {
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      `Epic '${input.epicIssueId}' in project '${input.projectId}' already has non-terminal run '${existingRun.runId}' in status '${existingRun.status}'.`,
    ),
  );
}

export function findConflictingSharedWorkspaceRunForProject(input: {
  readonly readModel: OrchestrationReadModel;
  readonly projectId: ProjectId;
}): OrchestrationEpicRun | undefined {
  return input.readModel.epicRuns.find(
    (run) => run.projectId === input.projectId && isNonTerminalSharedWorkspaceRun(run),
  );
}

export function requireNoConflictingSharedWorkspaceRun(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly projectId: ProjectId;
  readonly workspaceMode: OrchestrationStartEpicRunInput["workspaceMode"];
}): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (input.workspaceMode !== "shared") {
    return Effect.void;
  }

  const conflictingRun = findConflictingSharedWorkspaceRunForProject(input);
  if (!conflictingRun) {
    return Effect.void;
  }

  return Effect.fail(
    invariantError(
      input.command.type,
      `Project '${input.projectId}' already has non-terminal shared-workspace run '${conflictingRun.runId}' for epic '${conflictingRun.epicIssueId}' in status '${conflictingRun.status}'.`,
    ),
  );
}

export function requireSwarmTaskExecution(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly executionId: EpicIssueExecutionId;
}): Effect.Effect<OrchestrationEpicIssueExecution, OrchestrationCommandInvariantError> {
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
  readonly executionId: EpicIssueExecutionId;
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
  readonly run: OrchestrationEpicRun;
}): Effect.Effect<OrchestrationEpicRun, OrchestrationCommandInvariantError> {
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
  readonly runId: EpicRunId;
}): Effect.Effect<OrchestrationEpicRun, OrchestrationCommandInvariantError> {
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
  runId: EpicRunId,
): OrchestrationEpicIssueExecution | null {
  return deriveSwarmRunExecutionState({
    runId,
    executions: readModel.epicIssueExecutions,
  }).currentExecution;
}

export function requireSwarmRunWithoutCurrentExecution(input: {
  readonly readModel: OrchestrationReadModel;
  readonly command: OrchestrationCommand;
  readonly runId: EpicRunId;
}): Effect.Effect<OrchestrationEpicRun, OrchestrationCommandInvariantError> {
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
  readonly executionId: EpicIssueExecutionId;
  readonly runId: EpicRunId;
}): Effect.Effect<OrchestrationEpicIssueExecution, OrchestrationCommandInvariantError> {
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
  readonly executionId: EpicIssueExecutionId;
  readonly runId: EpicRunId;
}): Effect.Effect<OrchestrationEpicIssueExecution, OrchestrationCommandInvariantError> {
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
