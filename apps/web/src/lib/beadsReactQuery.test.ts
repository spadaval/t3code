import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
  beadsIssueGraphOptions,
  getProjectRunSummaryEpicTitle,
  beadsQueryIssuesOptions,
  selectProjectRunSummaryEpic,
} from "./beadsReactQuery";

describe("beads issue query options", () => {
  it("allows active issue lists to opt into periodic refetching", () => {
    const options = beadsQueryIssuesOptions({
      cwd: "/repo",
      mode: "all",
      statuses: ["open"],
      sortBy: "updated",
      refetchIntervalMs: ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: "always",
    });

    expect(options.refetchInterval).toBe(ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS);
    expect(options.refetchOnWindowFocus).toBe("always");
    expect(options.retry).toBe(false);
  });

  it("propagates refresh settings for issue graph queries", () => {
    const options = beadsIssueGraphOptions({
      cwd: "/repo",
      epicIssueId: "EPIC-1",
      refetchIntervalMs: ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: "always",
    });

    expect(options.refetchInterval).toBe(ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS);
    expect(options.refetchOnWindowFocus).toBe("always");
    expect(options.retry).toBe(false);
  });

  it("reads epic titles from project run summary payloads", () => {
    const summary = {
      projectId: ProjectId.make("project-1"),
      epics: [
        {
          epicIssueId: "EPIC-1",
          epicTitle: "Epic Title",
          runs: [],
          executions: [],
        },
      ],
    };

    expect(selectProjectRunSummaryEpic(summary, "EPIC-1")?.epicTitle).toBe("Epic Title");
    expect(getProjectRunSummaryEpicTitle(summary, "EPIC-1")).toBe("Epic Title");
    expect(getProjectRunSummaryEpicTitle(summary, "EPIC-2")).toBeNull();
  });
});
