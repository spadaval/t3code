import { describe, expect, it } from "vitest";

import { parseIssuesRouteSearch } from "./issuesRouteSearch";

describe("parseIssuesRouteSearch", () => {
  it("parses showClosed and sort when present", () => {
    expect(
      parseIssuesRouteSearch({
        tab: "issues",
        issueId: "TASK-1",
        showClosed: "true",
        sort: "created",
      }),
    ).toEqual({
      tab: "issues",
      issueId: "TASK-1",
      showClosed: true,
      sort: "created",
    });
  });

  it("drops invalid showClosed and sort values", () => {
    expect(
      parseIssuesRouteSearch({
        showClosed: "maybe",
        sort: "oldest-first",
      }),
    ).toEqual({});
  });
});
