import type { BeadsIssueRelationSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildEpicCoordinationGraph,
  deriveEpicCoordinationStatus,
  validateEpicCoordinationGraph,
} from "./epicCoordination.ts";

function issue(id: string): BeadsIssueRelationSummary {
  return {
    id,
    title: id,
    status: "open",
    priority: 1,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
  };
}

describe("epicCoordination", () => {
  it("keeps blocked breakdowns while rejecting unknown dependency metadata", () => {
    const internal = issue("TASK-INTERNAL");
    const external = issue("TASK-EXTERNAL");
    const unknown = issue("TASK-UNKNOWN");
    const graph = buildEpicCoordinationGraph({
      epicId: "EPIC-1",
      epicTitle: "Epic",
      nodes: [
        {
          issue: issue("TASK-READY"),
          internalDependencyIds: [],
          externalDependencyIds: [],
          unknownDependencyIds: [],
          hasOpenDescendants: false,
        },
        {
          issue: internal,
          internalDependencyIds: ["TASK-READY"],
          externalDependencyIds: [],
          unknownDependencyIds: [],
          hasOpenDescendants: false,
        },
        {
          issue: external,
          internalDependencyIds: [],
          externalDependencyIds: ["TASK-OUTSIDE"],
          unknownDependencyIds: [],
          hasOpenDescendants: false,
        },
        {
          issue: unknown,
          internalDependencyIds: [],
          externalDependencyIds: [],
          unknownDependencyIds: ["TASK-UNKNOWN:unknown:0"],
          hasOpenDescendants: false,
        },
      ],
    });

    expect(deriveEpicCoordinationStatus(graph).blockedBreakdown).toEqual({
      internal: [internal],
      external: [external],
      unknown: [unknown],
    });

    expect(validateEpicCoordinationGraph(graph)).toMatchObject({
      valid: false,
      errors: [
        "Blocked child TASK-UNKNOWN has an open dependency that could not be identified. Fix dependency metadata before starting the epic.",
      ],
    });
  });
});
