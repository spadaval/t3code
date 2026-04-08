import type { BeadsIssueRelationSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  compareSwarmReadyIssues,
  selectDeterministicReadyIssue,
  selectDeterministicReadyIssueFromList,
} from "./swarm";

function makeIssue(id: string, priority: number | null = null): BeadsIssueRelationSummary {
  return {
    id,
    title: id,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  };
}

describe("swarm", () => {
  it("orders ready issues by priority then id", () => {
    expect(
      [
        makeIssue("TASK-3", 2),
        makeIssue("TASK-1", 1),
        makeIssue("TASK-2", 1),
        makeIssue("TASK-4", null),
      ]
        .toSorted(compareSwarmReadyIssues)
        .map((issue) => issue.id),
    ).toEqual(["TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
  });

  it("selects the first non-empty validation front", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: {
          readyFronts: [[], [makeIssue("TASK-2", 2), makeIssue("TASK-1", 1)]],
        },
        status: { ready: [makeIssue("TASK-9", 0)] },
      })?.id,
    ).toBe("TASK-1");
  });

  it("falls back to swarm status ready issues", () => {
    expect(
      selectDeterministicReadyIssue({
        validation: { readyFronts: [] },
        status: { ready: [makeIssue("TASK-2", 2), makeIssue("TASK-1", 1)] },
      })?.id,
    ).toBe("TASK-1");
  });

  it("selects deterministically from a plain issue list", () => {
    expect(
      selectDeterministicReadyIssueFromList([makeIssue("TASK-2", 2), makeIssue("TASK-1", 2)])?.id,
    ).toBe("TASK-1");
  });
});
