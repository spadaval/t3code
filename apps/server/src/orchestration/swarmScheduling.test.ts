import { describe, expect, it } from "vitest";

import { selectDeterministicReadyIssue } from "./swarmScheduling.ts";

function issue(id: string, priority: number | null) {
  return {
    id,
    title: id,
    status: "open",
    priority,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  } as const;
}

describe("swarmScheduling", () => {
  it("selects the lowest numeric priority and uses issue id as a tie-breaker", () => {
    const selected = selectDeterministicReadyIssue({
      validation: {
        readyFronts: [
          [issue("TASK-9", 2), issue("TASK-2", 2), issue("TASK-1", 1), issue("TASK-8", null)],
        ],
      },
      status: null,
    });

    expect(selected?.id).toBe("TASK-1");
  });

  it("falls back to status.ready and orders null priority last", () => {
    const selected = selectDeterministicReadyIssue({
      validation: { readyFronts: [] },
      status: {
        ready: [issue("TASK-7", null), issue("TASK-3", 3), issue("TASK-1", 3)],
      },
    });

    expect(selected?.id).toBe("TASK-1");
  });
});
