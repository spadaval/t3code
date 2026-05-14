import {
  IsoDateTime,
  OrchestrationSubagentEntryKind,
  OrchestrationSubagentRunStatus,
  ProviderInstanceId,
  ProviderItemId,
  ProviderKind,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSubagentRun = Schema.Struct({
  runId: Schema.String,
  threadId: ThreadId,
  turnId: TurnId,
  parentItemId: ProviderItemId,
  provider: ProviderKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  providerRunId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  agentType: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  config: Schema.Unknown,
  status: OrchestrationSubagentRunStatus,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type ProjectionThreadSubagentRun = typeof ProjectionThreadSubagentRun.Type;

export const ProjectionThreadSubagentEntry = Schema.Struct({
  entryId: Schema.String,
  runId: Schema.String,
  kind: OrchestrationSubagentEntryKind,
  title: Schema.NullOr(Schema.String),
  text: Schema.String,
  payload: Schema.Unknown,
  createdAt: IsoDateTime,
});
export type ProjectionThreadSubagentEntry = typeof ProjectionThreadSubagentEntry.Type;

export const ThreadSubagentRunIdInput = Schema.Struct({ runId: Schema.String });
export type ThreadSubagentRunIdInput = typeof ThreadSubagentRunIdInput.Type;

export const ThreadSubagentThreadIdInput = Schema.Struct({ threadId: ThreadId });
export type ThreadSubagentThreadIdInput = typeof ThreadSubagentThreadIdInput.Type;

export interface ProjectionThreadSubagentRunRepositoryShape {
  readonly upsert: (
    run: ProjectionThreadSubagentRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByRunId: (
    input: ThreadSubagentRunIdInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSubagentRun>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ThreadSubagentThreadIdInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagentRun>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: ThreadSubagentThreadIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export interface ProjectionThreadSubagentEntryRepositoryShape {
  readonly upsert: (
    entry: ProjectionThreadSubagentEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByRunId: (
    input: ThreadSubagentRunIdInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadSubagentEntry>, ProjectionRepositoryError>;
  readonly deleteByRunId: (
    input: ThreadSubagentRunIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: ThreadSubagentThreadIdInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadSubagentRunRepository extends Context.Service<
  ProjectionThreadSubagentRunRepository,
  ProjectionThreadSubagentRunRepositoryShape
>()("t3/persistence/Services/ProjectionThreadSubagents/ProjectionThreadSubagentRunRepository") {}

export class ProjectionThreadSubagentEntryRepository extends Context.Service<
  ProjectionThreadSubagentEntryRepository,
  ProjectionThreadSubagentEntryRepositoryShape
>()("t3/persistence/Services/ProjectionThreadSubagents/ProjectionThreadSubagentEntryRepository") {}
