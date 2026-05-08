import type { EnvironmentId } from "@t3tools/contracts";

import { ensureEnvironmentApi } from "~/environmentApi";
import { selectProjectsAcrossEnvironments, useStore } from "~/store";

export function resolveEnvironmentIdForCwd(cwd: string): EnvironmentId {
  const project = selectProjectsAcrossEnvironments(useStore.getState()).find(
    (candidate) => candidate.cwd === cwd,
  );
  if (!project) {
    throw new Error(`No environment found for cwd: ${cwd}`);
  }
  return project.environmentId;
}

export function environmentApiForCwd(cwd: string) {
  return ensureEnvironmentApi(resolveEnvironmentIdForCwd(cwd));
}
