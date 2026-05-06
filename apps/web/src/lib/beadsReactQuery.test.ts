import { describe, expect, it } from "vitest";

import { beadsQueryKeys, beadsResolveIssueRefsOptions } from "./beadsReactQuery";

describe("beads issue reference query options", () => {
  it("sorts and deduplicates issue ref query keys", () => {
    expect(beadsQueryKeys.issueRefs("/repo", ["TASK-2", "TASK-1", "TASK-1"])).toEqual([
      "beads",
      "issue-refs",
      "/repo",
      ["TASK-1", "TASK-2"],
    ]);
  });

  it("disables issue ref queries without cwd or issue ids", () => {
    expect(beadsResolveIssueRefsOptions(null).enabled).toBe(false);
    expect(beadsResolveIssueRefsOptions({ cwd: "", issueIds: ["TASK-1"] }).enabled).toBe(false);
    expect(beadsResolveIssueRefsOptions({ cwd: "/repo", issueIds: [] }).enabled).toBe(false);
    expect(beadsResolveIssueRefsOptions({ cwd: "/repo", issueIds: ["TASK-1"] }).enabled).toBe(true);
  });
});
