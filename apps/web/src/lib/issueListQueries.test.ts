import { describe, expect, it } from "vitest";

import { buildIssueListQueryInput } from "./issueListQueries";

describe("buildIssueListQueryInput", () => {
  it("omits status filtering so hidden closed issues still count toward epic progress", () => {
    const queryInput = buildIssueListQueryInput({
      cwd: "/repo",
      sortBy: "updated",
      enabled: true,
      refetchIntervalMs: 15_000,
      refetchOnWindowFocus: "always",
    });

    expect(queryInput).toEqual({
      cwd: "/repo",
      mode: "all",
      sortBy: "updated",
      enabled: true,
      refetchIntervalMs: 15_000,
      refetchOnWindowFocus: "always",
    });
    expect("statuses" in queryInput).toBe(false);
  });
});
