import type { BeadsIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildIssueTree,
  collectIssueTreeBranchIds,
  countIssueTreeDescendantStatuses,
  flattenVisibleIssueTree,
} from "./issueTree";

function makeIssue(input: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">) {
  const { id, title, ...rest } = input;

  return {
    id,
    title,
    description: null,
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    labels: [],
    parent: null,
    ...rest,
  } satisfies BeadsIssueSummary;
}

describe("buildIssueTree", () => {
  it("nests children under epic parents, flattens non-epic parent references to roots", () => {
    // STORY-1 (feature) is parented to EPIC-1 (epic) → nested under EPIC-1
    // TASK-1 is parented to STORY-1 (feature, non-epic) → promoted to root
    // SUBTASK-1 is parented to TASK-1 (task, non-epic) → promoted to root
    const issues = [
      makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      makeIssue({
        id: "STORY-1",
        title: "Story 1",
        issueType: "feature",
        parent: { id: "EPIC-1", title: "Epic 1" },
      }),
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        parent: { id: "STORY-1", title: "Story 1" },
      }),
      makeIssue({
        id: "SUBTASK-1",
        title: "Subtask 1",
        status: "blocked",
        parent: { id: "TASK-1", title: "Task 1" },
      }),
    ];

    const tree = buildIssueTree(issues);

    // EPIC-1 is the only epic root; TASK-1 and SUBTASK-1 are promoted to roots
    expect(tree.roots.map((n) => n.issue.id)).toEqual(["EPIC-1", "TASK-1", "SUBTASK-1"]);
    expect(tree.roots[0]?.issue.id).toBe("EPIC-1");
    expect(tree.roots[0]?.children[0]?.issue.id).toBe("STORY-1");
    // STORY-1 is a leaf inside the epic (no epic children)
    expect(tree.roots[0]?.children[0]?.children).toHaveLength(0);

    expect(collectIssueTreeBranchIds(tree.roots)).toEqual(["EPIC-1"]);

    expect(flattenVisibleIssueTree(tree.roots, {})).toEqual([
      expect.objectContaining({ issue: issues[0], depth: 0, isCollapsed: true }),
      expect.objectContaining({ issue: issues[2], depth: 0, isCollapsed: false }),
      expect.objectContaining({ issue: issues[3], depth: 0, isCollapsed: false }),
    ]);

    expect(
      flattenVisibleIssueTree(tree.roots, { "EPIC-1": false }).map((row) => row.issue.id),
    ).toEqual(["EPIC-1", "STORY-1", "TASK-1", "SUBTASK-1"]);
  });

  it("preserves epic-to-epic nesting", () => {
    const issues = [
      makeIssue({ id: "EPIC-1", title: "Epic 1", issueType: "epic" }),
      makeIssue({
        id: "EPIC-2",
        title: "Epic 2",
        issueType: "epic",
        parent: { id: "EPIC-1", title: "Epic 1" },
      }),
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        parent: { id: "EPIC-2", title: "Epic 2" },
      }),
    ];

    const tree = buildIssueTree(issues);

    expect(tree.roots.map((n) => n.issue.id)).toEqual(["EPIC-1"]);
    expect(tree.roots[0]?.children[0]?.issue.id).toBe("EPIC-2");
    expect(tree.roots[0]?.children[0]?.children[0]?.issue.id).toBe("TASK-1");
  });

  it("promotes non-epic issues to roots even when parent is in the set", () => {
    const issues = [
      makeIssue({ id: "STORY-1", title: "Story 1", issueType: "feature" }),
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        parent: { id: "STORY-1", title: "Story 1" },
      }),
    ];

    const tree = buildIssueTree(issues);

    // Neither STORY-1 nor TASK-1 are epics; both should be roots with no children
    expect(tree.roots.map((n) => n.issue.id)).toEqual(["STORY-1", "TASK-1"]);
    expect(tree.roots[0]?.children).toHaveLength(0);
    expect(tree.roots[1]?.children).toHaveLength(0);
    expect(collectIssueTreeBranchIds(tree.roots)).toEqual([]);
  });

  it("anchors a visible parent subtree at the earliest visible descendant", () => {
    const issues = [
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        parent: { id: "EPIC-1", title: "Epic 1" },
      }),
      makeIssue({
        id: "ROOT-1",
        title: "Standalone root",
      }),
      makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
    ];

    const tree = buildIssueTree(issues);

    expect(tree.roots.map((node) => node.issue.id)).toEqual(["EPIC-1", "ROOT-1"]);
    expect(
      flattenVisibleIssueTree(tree.roots, {
        "EPIC-1": false,
      }).map((row) => row.issue.id),
    ).toEqual(["EPIC-1", "TASK-1", "ROOT-1"]);
  });

  it("promotes visible descendants to roots when their parent is filtered out", () => {
    const issues = [
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        parent: { id: "STORY-1", title: "Story 1" },
      }),
      makeIssue({
        id: "TASK-2",
        title: "Task 2",
        parent: { id: "missing-parent", title: "Missing parent" },
      }),
    ];

    const tree = buildIssueTree(issues);

    expect(tree.roots.map((node) => node.issue.id)).toEqual(["TASK-1", "TASK-2"]);
  });

  it("counts visible descendant statuses recursively for epic summaries", () => {
    const issues = [
      makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
      makeIssue({
        id: "STORY-1",
        title: "Story 1",
        parent: { id: "EPIC-1", title: "Epic 1" },
        status: "in_progress",
      }),
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        // Parented to EPIC-1 directly so it nests under the epic
        parent: { id: "EPIC-1", title: "Epic 1" },
        status: "closed",
      }),
      makeIssue({
        id: "TASK-2",
        title: "Task 2",
        parent: { id: "EPIC-1", title: "Epic 1" },
        status: "blocked",
      }),
    ];

    const tree = buildIssueTree(issues);

    expect(countIssueTreeDescendantStatuses(tree.roots[0]!)).toEqual({
      closed: 1,
      inProgress: 1,
      blocked: 1,
      total: 3,
    });
  });
});
