import type { GitCoreShape } from "../git/Services/GitCore.ts";
import { Effect } from "effect";
import {
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranchName,
} from "@t3tools/shared/git";

export interface TemporaryWorktree {
  branch: string;
  path: string;
}

export interface TemporaryWorktreeCleanupResult {
  cleanupStatus: "not-required" | "pending" | "succeeded" | "failed";
  cleanupError: string | null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export const createTemporaryWorktree = (input: {
  git: GitCoreShape;
  cwd: string;
  baseBranch: string;
}) =>
  Effect.gen(function* () {
    const existingBranches = new Set(yield* input.git.listLocalBranchNames(input.cwd));
    let branch = buildTemporaryWorktreeBranchName();
    while (existingBranches.has(branch)) {
      branch = buildTemporaryWorktreeBranchName();
    }

    const worktree = yield* input.git.createWorktree({
      cwd: input.cwd,
      branch: input.baseBranch,
      newBranch: branch,
      path: null,
    });

    return {
      branch: worktree.worktree.branch,
      path: worktree.worktree.path,
    };
  });

export const cleanupTemporaryWorktree = (input: {
  git: GitCoreShape;
  cwd: string;
  branch: string | null;
  worktreePath: string | null;
}): Effect.Effect<TemporaryWorktreeCleanupResult> =>
  Effect.gen(function* () {
    let cleanupError: string | null = null;

    if (input.worktreePath) {
      const removeResult = yield* Effect.exit(
        input.git.removeWorktree({
          cwd: input.cwd,
          path: input.worktreePath,
          force: true,
        }),
      );
      if (removeResult._tag === "Failure") {
        cleanupError = toErrorMessage(removeResult.cause);
      }
    }

    if (input.branch && isTemporaryWorktreeBranchName(input.branch)) {
      const deleteResult = yield* Effect.exit(
        input.git.deleteLocalBranch({
          cwd: input.cwd,
          branch: input.branch,
          force: true,
        }),
      );
      if (deleteResult._tag === "Failure" && cleanupError === null) {
        cleanupError = toErrorMessage(deleteResult.cause);
      }
    }

    if (!input.worktreePath && !input.branch) {
      return {
        cleanupStatus: "not-required" as const,
        cleanupError: null,
      };
    }

    return cleanupError === null
      ? {
          cleanupStatus: "succeeded" as const,
          cleanupError: null,
        }
      : {
          cleanupStatus: "failed" as const,
          cleanupError,
        };
  });
