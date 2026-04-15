import { describe, expect, it } from "vitest";

import { parseIssuesRouteSearch } from "./issuesRouteSearch";

describe("parseIssuesRouteSearch", () => {
  it("parses showClosed and sort when present", () => {
    expect(
      parseIssuesRouteSearch({
        tab: "issues",
        runId: "run-1",
        issueId: "TASK-1",
        showClosed: "true",
        sort: "created",
      }),
    ).toEqual({
      tab: "issues",
      runId: "run-1",
      issueId: "TASK-1",
      showClosed: true,
      sort: "created",
    });
  });

  it("drops invalid showClosed, sort, and blank run ids", () => {
    expect(
      parseIssuesRouteSearch({
        runId: "  ",
        showClosed: "maybe",
        sort: "oldest-first",
      }),
    ).toEqual({});
  });
});
