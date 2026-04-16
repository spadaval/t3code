import { describe, expect, it } from "vitest";

import {
  ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
  beadsIssueGraphOptions,
  beadsQueryIssuesOptions,
} from "./beadsReactQuery";

describe("beads issue query options", () => {
  it("allows active issue lists to opt into periodic refetching", () => {
    const options = beadsQueryIssuesOptions({
      cwd: "/repo",
      statuses: ["open"],
      sortBy: "updated",
      refetchIntervalMs: ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS,
      refetchOnWindowFocus: "always",
    });

    expect(options.refetchInterval).toBe(ACTIVE_BEADS_ISSUE_REFETCH_INTERVAL_MS);
    expect(options.refetchOnWindowFocus).toBe("always");
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
  });
});
