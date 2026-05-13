import { OrchestrationEpicRun, EpicRunId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

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

export class ProjectionEpicRunRepository extends Context.Service<
  ProjectionEpicRunRepository,
  ProjectionEpicRunRepositoryShape
>()("t3/persistence/Services/ProjectionEpicRuns/ProjectionEpicRunRepository") {}
