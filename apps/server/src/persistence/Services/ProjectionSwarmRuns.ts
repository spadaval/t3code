import { OrchestrationSwarmRun, SwarmRunId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionSwarmRun = OrchestrationSwarmRun;
export type ProjectionSwarmRun = typeof ProjectionSwarmRun.Type;

export const GetProjectionSwarmRunInput = Schema.Struct({
  runId: SwarmRunId,
});
export type GetProjectionSwarmRunInput = typeof GetProjectionSwarmRunInput.Type;

export interface ProjectionSwarmRunRepositoryShape {
  readonly upsert: (run: ProjectionSwarmRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionSwarmRunInput,
  ) => Effect.Effect<Option.Option<ProjectionSwarmRun>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionSwarmRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionSwarmRunRepository extends ServiceMap.Service<
  ProjectionSwarmRunRepository,
  ProjectionSwarmRunRepositoryShape
>()("t3/persistence/Services/ProjectionSwarmRuns/ProjectionSwarmRunRepository") {}
