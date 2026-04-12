import type { BeadsIssueDependency, BeadsIssueRelationSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildIssueRelationshipModel } from "./issueRelationships";

function makeDependency(
  id: string,
  dependencyType: string,
  overrides: Partial<BeadsIssueDependency> = {},
): BeadsIssueDependency {
  return {
    id,
    title: `Issue ${id}`,
    description: null,
    status: "open",
    priority: null,
    issueType: "task",
    owner: null,
    createdAt: "2026-04-10T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-04-10T00:00:00.000Z",
    dependencyType,
    ...overrides,
  };
}

function makeRelation(
  id: string,
  overrides: Partial<BeadsIssueRelationSummary> = {},
): BeadsIssueRelationSummary {
  return {
    id,
    title: `Issue ${id}`,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
    ...overrides,
  };
}

describe("buildIssueRelationshipModel", () => {
  it("separates blocker, prerequisite, and downstream relationships by exact dependency type", () => {
    const model = buildIssueRelationshipModel({
      parent: null,
      children: [],
      dependencies: [
        makeDependency("PARENT-1", "parent-child"),
        makeDependency("BLOCKER-1", "blocked_by"),
        makeDependency("PREREQ-1", "depends_on"),
        makeDependency("DOWNSTREAM-1", "blocks"),
      ],
      dependents: [makeRelation("FOLLOW-1")],
    });

    expect(model.parent?.id).toBe("PARENT-1");
    expect(
      model.sections.find((section) => section.key === "blocked_by")?.items.map((item) => item.id),
    ).toEqual(["BLOCKER-1"]);
    expect(
      model.sections.find((section) => section.key === "depends_on")?.items.map((item) => item.id),
    ).toEqual(["PREREQ-1"]);
    expect(
      model.sections
        .find((section) => section.key === "incoming_blocks")
        ?.items.map((item) => item.id),
    ).toEqual(["DOWNSTREAM-1"]);
    expect(
      model.sections
        .find((section) => section.key === "outgoing_blocks")
        ?.items.map((item) => item.id),
    ).toEqual(["FOLLOW-1"]);
  });

  it("dedupes reverse dependents without merging them into incoming blocks", () => {
    const model = buildIssueRelationshipModel({
      parent: null,
      children: [makeRelation("CHILD-1")],
      dependencies: [makeDependency("UPSTREAM-1", "blocks")],
      dependents: [makeRelation("FOLLOW-1"), makeRelation("FOLLOW-1"), makeRelation("FOLLOW-2")],
    });

    expect(
      model.sections
        .find((section) => section.key === "incoming_blocks")
        ?.items.map((item) => item.id),
    ).toEqual(["UPSTREAM-1"]);
    expect(
      model.sections
        .find((section) => section.key === "outgoing_blocks")
        ?.items.map((item) => item.id),
    ).toEqual(["FOLLOW-1", "FOLLOW-2"]);
    expect(model.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "children", count: 1 }),
        expect.objectContaining({ key: "incoming_blocks", count: 1 }),
        expect.objectContaining({ key: "outgoing_blocks", count: 2 }),
      ]),
    );
  });
});
