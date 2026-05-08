import { describe, expect, it } from "vitest";

import {
  buildCanonicalIssuesRouteSearch,
  issuesRouteSearchNeedsRedirect,
  parseIssuesRouteSearch,
  resolveCanonicalIssuesRouteSearch,
} from "./issuesRouteSearch";

describe("parseIssuesRouteSearch", () => {
  it("parses issue search state for the issue-first surface", () => {
    expect(
      parseIssuesRouteSearch({
        tab: "issues",
        epicId: "EPIC-1",
        issueId: "TASK-1",
        showClosed: "true",
        sort: "created",
      }),
    ).toEqual({
      tab: "issues",
      epicId: "EPIC-1",
      issueId: "TASK-1",
      showClosed: true,
      sort: "created",
    });
  });

  it("drops coordinator-only and invalid search params", () => {
    expect(
      parseIssuesRouteSearch({
        tab: "coordinator",
        runId: "run-1",
        epicId: "  ",
        issueId: "  ",
        showClosed: "maybe",
        sort: "oldest-first",
      }),
    ).toEqual({});
  });
});

describe("resolveCanonicalIssuesRouteSearch", () => {
  it("redirects coordinator deep links onto the issues tab", () => {
    expect(
      resolveCanonicalIssuesRouteSearch({
        tab: "coordinator",
        epicId: "EPIC-1",
        issueId: "TASK-1",
        runId: "run-9",
      }),
    ).toEqual({
      tab: "issues",
      epicId: "EPIC-1",
      issueId: "TASK-1",
    });
  });

  it("defaults empty or invalid tabs to issues while preserving valid filters", () => {
    expect(
      resolveCanonicalIssuesRouteSearch({
        tab: "wat",
        epicId: "EPIC-2",
        showClosed: "false",
        sort: "priority",
      }),
    ).toEqual({
      tab: "issues",
      epicId: "EPIC-2",
      showClosed: false,
      sort: "priority",
    });
  });
});

describe("buildCanonicalIssuesRouteSearch", () => {
  it("always emits the canonical issues tab and keeps valid filters", () => {
    expect(
      buildCanonicalIssuesRouteSearch({
        epicId: "EPIC-2",
        issueId: "TASK-7",
        showClosed: false,
        sort: "priority",
      }),
    ).toEqual({
      tab: "issues",
      epicId: "EPIC-2",
      issueId: "TASK-7",
      showClosed: false,
      sort: "priority",
    });
  });
});

describe("issuesRouteSearchNeedsRedirect", () => {
  it("requires redirect for coordinator links and stale run ids", () => {
    expect(
      issuesRouteSearchNeedsRedirect({
        tab: "coordinator",
        epicId: "EPIC-1",
      }),
    ).toBe(true);

    expect(
      issuesRouteSearchNeedsRedirect({
        tab: "issues",
        runId: "run-1",
      }),
    ).toBe(true);
  });

  it("accepts canonical issue searches as-is and redirects legacy board links", () => {
    expect(
      issuesRouteSearchNeedsRedirect({
        tab: "issues",
        epicId: "EPIC-1",
        issueId: "TASK-1",
      }),
    ).toBe(false);

    expect(
      issuesRouteSearchNeedsRedirect({
        tab: "board",
        showClosed: "true",
      }),
    ).toBe(true);

    expect(
      resolveCanonicalIssuesRouteSearch({
        tab: "board",
        showClosed: "true",
      }),
    ).toEqual({
      tab: "issues",
      showClosed: true,
    });
  });
});
