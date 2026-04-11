import { OrchestrationEpicRun, EpicRunId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionEpicRun = Schema.Struct({
  ...OrchestrationEpicRun.fields,
});
export type ProjectionEpicRun = typeof ProjectionEpicRun.Type;

export const GetProjectionEpicRunInput = Schema.Struct({
  runId: EpicRunId,
});
export type GetProjectionEpicRunInput = typeof GetProjectionEpicRunInput.Type;

export interface ProjectionEpicRunRepositoryShape {
  readonly upsert: (run: ProjectionEpicRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionEpicRunInput,
  ) => Effect.Effect<Option.Option<ProjectionEpicRun>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionEpicRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionEpicRunRepository extends ServiceMap.Service<
  ProjectionEpicRunRepository,
  ProjectionEpicRunRepositoryShape
>()("t3/persistence/Services/ProjectionEpicRuns/ProjectionEpicRunRepository") {}
