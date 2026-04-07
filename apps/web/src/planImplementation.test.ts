import { describe, expect, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";

import {
  canImplementPlanInNewWorktree,
  findPlanImplementationLaunch,
  getPlanImplementationWorktreeEligibility,
  isPlanImplementationLaunchPreparedOrLater,
  planImplementationLaunchStatusLabel,
} from "./planImplementation";

describe("canImplementPlanInNewWorktree", () => {
  it("returns a reason when the project is not a git repo", () => {
    expect(
      getPlanImplementationWorktreeEligibility({
        isGitRepo: false,
        sourceThreadBranch: null,
        branches: null,
        branchesPending: false,
      }),
    ).toEqual({
      canImplement: false,
      reason: "Implementation worktrees are only available for Git projects.",
    });
  });

  it("allows the action when the source thread already has a branch", () => {
    expect(
      canImplementPlanInNewWorktree({
        isGitRepo: true,
        sourceThreadBranch: "feature/source",
        branches: null,
        branchesPending: true,
      }),
    ).toBe(true);
  });

  it("blocks the action while branches are still loading and no source branch exists", () => {
    expect(
      getPlanImplementationWorktreeEligibility({
        isGitRepo: true,
        sourceThreadBranch: null,
        branches: null,
        branchesPending: true,
      }),
    ).toEqual({
      canImplement: false,
      reason: "Checking repository branches to determine the base branch.",
    });
  });

  it("allows the action when a default local branch is available", () => {
    expect(
      canImplementPlanInNewWorktree({
        isGitRepo: true,
        sourceThreadBranch: null,
        branches: [{ name: "main", isDefault: true, isRemote: false }],
        branchesPending: false,
      }),
    ).toBe(true);
  });

  it("blocks the action when no default local branch can be resolved", () => {
    expect(
      getPlanImplementationWorktreeEligibility({
        isGitRepo: true,
        sourceThreadBranch: null,
        branches: [{ name: "origin/main", isDefault: true, isRemote: true }],
        branchesPending: false,
      }),
    ).toEqual({
      canImplement: false,
      reason: "No default local branch is available to use as the base branch.",
    });
  });

  it("prefers the newest non-terminal launch for a thread", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");
    const selected = findPlanImplementationLaunch(
      [
        {
          launchId: "launch-1" as never,
          sourceThreadId: threadId,
          sourcePlanId: "plan-1",
          projectId: "project-1" as never,
          targetThreadId: "thread-2" as never,
          retryOfLaunchId: null,
          status: "failed",
          launchMode: "worktree",
          branch: null,
          worktreePath: null,
          failureReason: "boom",
          cleanupStatus: "failed",
          cleanupError: "cleanup failed",
          title: "Failed launch",
          setupEnabled: true,
          requestedAt: "2026-03-11T10:00:00.000Z",
          preparedAt: null,
          startedAt: null,
          failedAt: "2026-03-11T10:01:00.000Z",
          cancelledAt: null,
          updatedAt: "2026-03-11T10:01:00.000Z",
        },
        {
          launchId: "launch-2" as never,
          sourceThreadId: threadId,
          sourcePlanId: "plan-1",
          projectId: "project-1" as never,
          targetThreadId: "thread-3" as never,
          retryOfLaunchId: null,
          status: "prepared",
          launchMode: "worktree",
          branch: "t3code/next",
          worktreePath: "/tmp/worktree",
          failureReason: null,
          cleanupStatus: "not-required",
          cleanupError: null,
          title: "Running launch",
          setupEnabled: true,
          requestedAt: "2026-03-11T10:02:00.000Z",
          preparedAt: "2026-03-11T10:02:30.000Z",
          startedAt: null,
          failedAt: null,
          cancelledAt: null,
          updatedAt: "2026-03-11T10:02:45.000Z",
        },
      ],
      { threadId, planId: "plan-1" },
    );

    expect(selected?.launchId).toBe("launch-2");
  });

  it("recognizes prepared-or-later statuses", () => {
    expect(isPlanImplementationLaunchPreparedOrLater("requested")).toBe(false);
    expect(isPlanImplementationLaunchPreparedOrLater("prepared")).toBe(true);
    expect(isPlanImplementationLaunchPreparedOrLater("started")).toBe(true);
  });

  it("formats launch status labels", () => {
    expect(planImplementationLaunchStatusLabel("prepared")).toBe("Worktree prepared");
    expect(planImplementationLaunchStatusLabel("cancelled")).toBe("Cancelled");
  });
});
