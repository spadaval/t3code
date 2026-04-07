import type {
  OrchestrationPlanImplementationLaunchStatus,
  OrchestrationProposedPlanId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveDefaultLocalBranchName } from "@t3tools/shared/git";

import { useStore } from "./store";
import type { PlanImplementationLaunch } from "./types";

export interface PlanImplementationWorktreeEligibility {
  readonly canImplement: boolean;
  readonly reason: string | null;
}

export function getPlanImplementationWorktreeEligibility(input: {
  readonly isGitRepo: boolean;
  readonly sourceThreadBranch: string | null;
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly isDefault: boolean;
    readonly isRemote?: boolean | undefined;
  }> | null;
  readonly branchesPending: boolean;
}): PlanImplementationWorktreeEligibility {
  if (!input.isGitRepo) {
    return {
      canImplement: false,
      reason: "Implementation worktrees are only available for Git projects.",
    };
  }
  if (input.sourceThreadBranch) {
    return { canImplement: true, reason: null };
  }
  if (input.branchesPending) {
    return {
      canImplement: false,
      reason: "Checking repository branches to determine the base branch.",
    };
  }
  if (resolveDefaultLocalBranchName(input.branches ?? []) !== null) {
    return { canImplement: true, reason: null };
  }
  return {
    canImplement: false,
    reason: "No default local branch is available to use as the base branch.",
  };
}

export function canImplementPlanInNewWorktree(input: {
  readonly isGitRepo: boolean;
  readonly sourceThreadBranch: string | null;
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly isDefault: boolean;
    readonly isRemote?: boolean | undefined;
  }> | null;
  readonly branchesPending: boolean;
}): boolean {
  return getPlanImplementationWorktreeEligibility(input).canImplement;
}

export function isPlanImplementationLaunchTerminal(
  status: OrchestrationPlanImplementationLaunchStatus,
): boolean {
  return status === "started" || status === "failed" || status === "cancelled";
}

export function isPlanImplementationLaunchPreparedOrLater(
  status: OrchestrationPlanImplementationLaunchStatus,
): boolean {
  return (
    status === "prepared" || status === "started" || status === "failed" || status === "cancelled"
  );
}

export function canCancelPlanImplementationLaunch(
  status: OrchestrationPlanImplementationLaunchStatus,
): boolean {
  return !isPlanImplementationLaunchTerminal(status);
}

export function canRetryPlanImplementationLaunch(
  status: OrchestrationPlanImplementationLaunchStatus,
): boolean {
  return status === "failed" || status === "cancelled";
}

export function planImplementationLaunchStatusLabel(
  status: OrchestrationPlanImplementationLaunchStatus,
): string {
  switch (status) {
    case "requested":
      return "Launch requested";
    case "prepared":
      return "Worktree prepared";
    case "started":
      return "Started";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function findPlanImplementationLaunch(
  launches: ReadonlyArray<PlanImplementationLaunch>,
  input: {
    readonly threadId: ThreadId;
    readonly planId?: OrchestrationProposedPlanId | undefined;
  },
): PlanImplementationLaunch | null {
  const matches = launches.filter((launch) => {
    const threadMatches =
      launch.sourceThreadId === input.threadId || launch.targetThreadId === input.threadId;
    if (!threadMatches) {
      return false;
    }
    if (input.planId === undefined) {
      return true;
    }
    return launch.sourcePlanId === input.planId;
  });

  const [nextLaunch] = matches.toSorted((left, right) => {
    const leftTerminal = isPlanImplementationLaunchTerminal(left.status) ? 1 : 0;
    const rightTerminal = isPlanImplementationLaunchTerminal(right.status) ? 1 : 0;
    if (leftTerminal !== rightTerminal) {
      return leftTerminal - rightTerminal;
    }
    return right.requestedAt.localeCompare(left.requestedAt);
  });

  return nextLaunch ?? null;
}

export function usePlanImplementationLaunch(threadId: ThreadId): PlanImplementationLaunch | null {
  return useStore((store) =>
    findPlanImplementationLaunch(store.planImplementationLaunches, { threadId }),
  );
}
