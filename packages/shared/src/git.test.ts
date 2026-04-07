import type { GitStatusRemoteResult, GitStatusResult } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  applyGitStatusStreamEvent,
  buildTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranchName,
  resolveDefaultLocalBranchName,
} from "./git";

describe("buildTemporaryWorktreeBranchName", () => {
  it("creates a temporary t3code branch name", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "abcdef12-3456-7890-abcd-ef1234567890",
    );

    expect(buildTemporaryWorktreeBranchName()).toBe("t3code/abcdef12");
  });
});

describe("isTemporaryWorktreeBranchName", () => {
  it("detects the temporary worktree branch pattern", () => {
    expect(isTemporaryWorktreeBranchName("t3code/abcdef12")).toBe(true);
    expect(isTemporaryWorktreeBranchName("feature/abcdef12")).toBe(false);
  });
});

describe("resolveDefaultLocalBranchName", () => {
  it("returns the default local branch name", () => {
    expect(
      resolveDefaultLocalBranchName([
        { name: "origin/main", isDefault: true, isRemote: true },
        { name: "main", isDefault: true, isRemote: false },
      ]),
    ).toBe("main");
  });

  it("returns null when no default local branch exists", () => {
    expect(resolveDefaultLocalBranchName([{ name: "feature/test", isDefault: false }])).toBeNull();
  });
});

describe("applyGitStatusStreamEvent", () => {
  it("treats a remote-only update as a repository when local state is missing", () => {
    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(null, { _tag: "remoteUpdated", remote })).toEqual({
      isRepo: true,
      hasOriginRemote: false,
      isDefaultBranch: false,
      branch: null,
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });

  it("preserves local-only fields when applying a remote update", () => {
    const current: GitStatusResult = {
      isRepo: true,
      hostingProvider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      hasOriginRemote: true,
      isDefaultBranch: false,
      branch: "feature/demo",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/demo.ts", insertions: 1, deletions: 0 }],
        insertions: 1,
        deletions: 0,
      },
      hasUpstream: false,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };

    const remote: GitStatusRemoteResult = {
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    };

    expect(applyGitStatusStreamEvent(current, { _tag: "remoteUpdated", remote })).toEqual({
      ...current,
      hasUpstream: true,
      aheadCount: 2,
      behindCount: 1,
      pr: null,
    });
  });
});
