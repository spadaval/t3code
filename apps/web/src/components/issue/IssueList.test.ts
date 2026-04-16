import type { BeadsIssueSummary } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IssueList } from "./IssueList";
import { buildIssueContextMenuItems } from "./issueContextMenu";

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

describe("buildIssueContextMenuItems", () => {
  it("keeps implement/refine actions for standard issues", () => {
    const items = buildIssueContextMenuItems(
      makeIssue({
        id: "TASK-1",
        title: "Task 1",
        issueType: "task",
      }),
    );

    expect(items.map((item) => item.id)).toEqual([
      "implement",
      "refine",
      "copy_id",
      "copy_title",
      "open_in_tracker",
      "mark_closed",
    ]);
  });

  it("swaps in epic refine actions for epics", () => {
    const items = buildIssueContextMenuItems(
      makeIssue({
        id: "EPIC-1",
        title: "Epic 1",
        issueType: "epic",
      }),
    );

    expect(items.map((item) => item.id)).toEqual([
      "quick_refine",
      "planned_refine",
      "copy_id",
      "copy_title",
      "open_in_tracker",
      "mark_closed",
    ]);
  });
});

describe("IssueList hierarchy rendering", () => {
  it("strikes through closed flat issue titles without affecting open titles", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueList, {
        issues: [
          makeIssue({
            id: "TASK-CLOSED",
            title: "Closed task",
            status: "closed",
          }),
          makeIssue({
            id: "TASK-OPEN",
            title: "Open task",
            status: "open",
          }),
        ],
        showClosed: true,
      }),
    );

    expect(markup).toMatch(/<p class="[^"]*line-through[^"]*">Closed task<\/p>/);
    expect(markup).not.toMatch(/<p class="[^"]*line-through[^"]*">Open task<\/p>/);
  });

  it("renders actual epic branches with epic disclosure labels", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueList, {
        issues: [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
            status: "closed",
          }),
          makeIssue({
            id: "TASK-1",
            title: "Task 1",
            parent: { id: "EPIC-1", title: "Epic 1" },
          }),
        ],
        showClosed: true,
      }),
    );

    expect(markup).toContain('aria-label="Expand epic EPIC-1"');
    expect(markup).toContain("Epic 1");
    expect(markup).toMatch(/<span class="[^"]*">EPIC-1<\/span>/);
    expect(markup).toContain("0/1 done");
    expect(markup).toMatch(/<p class="[^"]*line-through[^"]*">Epic 1<\/p>/);
  });

  it("renders non-epic issues as flat leaf rows, not nested branches", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueList, {
        issues: [
          makeIssue({
            id: "STORY-1",
            title: "Story 1",
            issueType: "feature",
          }),
          makeIssue({
            id: "TASK-1",
            title: "Task 1",
            // Parented to a non-epic — should NOT create nesting
            parent: { id: "STORY-1", title: "Story 1" },
          }),
        ],
        showClosed: true,
      }),
    );

    // Neither is an epic, so neither gets the epic expand label
    expect(markup).not.toContain('aria-label="Expand epic STORY-1"');
    expect(markup).not.toContain("Expand epic group");
    // Non-epic parents no longer create a BranchIssueRow; both are flat leaves
    expect(markup).not.toContain('aria-label="Expand issue STORY-1"');
    // Both issues are visible as flat rows
    expect(markup).toContain("Story 1");
    expect(markup).toContain("Task 1");
  });

  it("promotes matching descendants when filtered ancestors are hidden", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueList, {
        issues: [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
          }),
          makeIssue({
            id: "STORY-1",
            title: "Hidden story",
            issueType: "feature",
            parent: { id: "EPIC-1", title: "Epic 1" },
          }),
          makeIssue({
            id: "TASK-1",
            title: "Fix matching task",
            parent: { id: "STORY-1", title: "Hidden story" },
          }),
        ],
        showClosed: true,
        searchValue: "matching",
      }),
    );

    expect(markup).toContain("Fix matching task");
    expect(markup).not.toContain("Hidden story");
    expect(markup).not.toContain("Epic 1");
  });

  it("keeps epic progress counts stable when closed children are filtered out", () => {
    const markup = renderToStaticMarkup(
      createElement(IssueList, {
        issues: [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
          }),
          makeIssue({
            id: "TASK-OPEN",
            title: "Open task",
            parent: { id: "EPIC-1", title: "Epic 1" },
            status: "open",
          }),
          makeIssue({
            id: "TASK-CLOSED",
            title: "Closed task",
            parent: { id: "EPIC-1", title: "Epic 1" },
            status: "closed",
          }),
        ],
        showClosed: false,
      }),
    );

    expect(markup).toContain("1/2 done");
    expect(markup).not.toContain("Closed task");
  });
});
