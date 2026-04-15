import { describe, expect, it } from "vitest";
import type { BeadsIssueSummary } from "@t3tools/contracts";
import {
  compareIssuesForListSort,
  filterIssuesForList,
  filterAndSortIssues,
  issueStatusesForVisibility,
  matchesIssueListVisibility,
  searchItems,
  validateIssueState,
  debounce,
  throttle,
  memoize,
  type IssueFilterOptions,
} from "../issuePanelLogic";

const createMockIssue = (overrides: Partial<BeadsIssueSummary> = {}): BeadsIssueSummary => ({
  id: "issue-1",
  title: "Test Issue",
  description: "Test description",
  notes: null,
  status: "open",
  priority: null,
  issueType: "task",
  assignee: null,
  owner: null,
  createdAt: new Date("2024-01-01").toISOString(),
  createdBy: null,
  updatedAt: new Date("2024-01-02").toISOString(),
  labels: [],
  parent: null,
  dependencyRefs: [],
  ...overrides,
});

const SAMPLE_ISSUES: readonly BeadsIssueSummary[] = [
  createMockIssue({
    id: "issue-1",
    title: "High Priority Bug",
    status: "open",
    priority: 1,
    labels: ["bug", "high-priority"],
    parent: { id: "epic-1", title: "Epic 1" },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-05T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-2",
    title: "Feature Request",
    status: "open",
    priority: 2,
    labels: ["enhancement", "feature"],
    parent: { id: "epic-2", title: "Epic 2" },
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-3",
    title: "Closed Bug Fix",
    status: "closed",
    priority: 3,
    labels: ["bug", "resolved"],
    parent: { id: "epic-1", title: "Epic 1" },
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-4",
    title: "Documentation Update",
    status: "open",
    priority: null,
    labels: ["documentation"],
    parent: null,
    createdAt: "2024-01-04T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  }),
];

describe("issuePanelLogic", () => {
  describe("matchesIssueListVisibility", () => {
    it("hides closed issues by default", () => {
      expect(matchesIssueListVisibility(SAMPLE_ISSUES[0]!, false)).toBe(true);
      expect(matchesIssueListVisibility(SAMPLE_ISSUES[2]!, false)).toBe(false);
    });

    it("includes closed issues when requested", () => {
      expect(matchesIssueListVisibility(SAMPLE_ISSUES[2]!, true)).toBe(true);
    });
  });

  describe("issueStatusesForVisibility", () => {
    it("returns only active statuses by default", () => {
      expect(issueStatusesForVisibility(false)).toEqual([
        "open",
        "in_progress",
        "blocked",
        "deferred",
      ]);
    });

    it("adds closed when closed issues are visible", () => {
      expect(issueStatusesForVisibility(true)).toEqual([
        "open",
        "in_progress",
        "blocked",
        "deferred",
        "closed",
      ]);
    });
  });

  describe("compareIssuesForListSort", () => {
    it("sorts updated newest first with title/id tiebreakers", () => {
      const issues = [
        createMockIssue({ id: "b", title: "Beta", updatedAt: "2024-01-03T00:00:00Z" }),
        createMockIssue({ id: "a", title: "Alpha", updatedAt: "2024-01-03T00:00:00Z" }),
        createMockIssue({ id: "c", title: "Gamma", updatedAt: "2024-01-02T00:00:00Z" }),
      ];

      expect(
        [...issues]
          .toSorted((left, right) => compareIssuesForListSort(left, right, "updated"))
          .map((issue) => issue.id),
      ).toEqual(["a", "b", "c"]);
    });

    it("sorts created newest first", () => {
      const issues = [
        createMockIssue({ id: "older", createdAt: "2024-01-01T00:00:00Z" }),
        createMockIssue({ id: "newer", createdAt: "2024-01-03T00:00:00Z" }),
      ];

      expect(
        [...issues]
          .toSorted((left, right) => compareIssuesForListSort(left, right, "created"))
          .map((issue) => issue.id),
      ).toEqual(["newer", "older"]);
    });

    it("sorts priority with null last", () => {
      const issues = [
        createMockIssue({ id: "null", priority: null }),
        createMockIssue({ id: "p2", priority: 2 }),
        createMockIssue({ id: "p1", priority: 1 }),
      ];

      expect(
        [...issues]
          .toSorted((left, right) => compareIssuesForListSort(left, right, "priority"))
          .map((issue) => issue.id),
      ).toEqual(["p1", "p2", "null"]);
    });

    it("sorts title alphabetically with updated tiebreaker", () => {
      const issues = [
        createMockIssue({ id: "b", title: "beta" }),
        createMockIssue({ id: "a-older", title: "Alpha", updatedAt: "2024-01-01T00:00:00Z" }),
        createMockIssue({ id: "a-newer", title: "alpha", updatedAt: "2024-01-02T00:00:00Z" }),
      ];

      expect(
        [...issues]
          .toSorted((left, right) => compareIssuesForListSort(left, right, "title"))
          .map((issue) => issue.id),
      ).toEqual(["a-newer", "a-older", "b"]);
    });
  });

  describe("filterAndSortIssues", () => {
    it("returns only active issues by default", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES);

      expect(result.issues.map((issue) => issue.id)).toEqual(["issue-1", "issue-2", "issue-4"]);
      expect(result.totalCount).toBe(4);
      expect(result.filteredCount).toBe(3);
    });

    it("includes closed issues when showClosed is enabled", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES, { showClosed: true });

      expect(result.issues.map((issue) => issue.id)).toEqual([
        "issue-1",
        "issue-2",
        "issue-3",
        "issue-4",
      ]);
    });

    it("supports label filtering", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES, {
        showClosed: true,
        selectedLabels: ["bug"],
      });

      expect(result.issues.map((issue) => issue.id)).toEqual(["issue-1", "issue-3"]);
    });

    it("sorts by created date", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES, {
        showClosed: true,
        sortBy: "created",
      });

      expect(result.issues.map((issue) => issue.id)).toEqual([
        "issue-4",
        "issue-3",
        "issue-2",
        "issue-1",
      ]);
    });

    it("sorts within tree containers instead of by raw server order", () => {
      const issues = [
        createMockIssue({
          id: "task-1",
          title: "Alpha task",
          parent: { id: "epic-z", title: "Epic Z" },
        }),
        createMockIssue({
          id: "root-1",
          title: "Beta standalone",
        }),
        createMockIssue({
          id: "epic-z",
          title: "Epic Z",
          issueType: "epic",
        }),
      ];

      const result = filterAndSortIssues(issues, {
        showClosed: true,
        sortBy: "title",
      });

      expect(result.issueTree.roots.map((node) => node.issue.id)).toEqual(["epic-z", "root-1"]);
      expect(result.issueTree.roots[0]?.children.map((node) => node.issue.id)).toEqual(["task-1"]);
    });

    it("sorts sibling issues by dependency order with createdAt tie breakers", () => {
      const issues = [
        createMockIssue({
          id: "epic-1",
          title: "Stacked PR epic",
          issueType: "epic",
          createdAt: "2024-01-01T00:00:00Z",
        }),
        createMockIssue({
          id: "pr-4",
          title: "PR4",
          parent: { id: "epic-1", title: "Stacked PR epic" },
          createdAt: "2024-01-04T00:00:00Z",
          dependencyRefs: [{ issueId: "pr-4", dependsOnId: "pr-3", dependencyType: "blocks" }],
        }),
        createMockIssue({
          id: "pr-2",
          title: "PR2",
          parent: { id: "epic-1", title: "Stacked PR epic" },
          createdAt: "2024-01-02T00:00:00Z",
          dependencyRefs: [{ issueId: "pr-2", dependsOnId: "pr-1", dependencyType: "blocks" }],
        }),
        createMockIssue({
          id: "pr-3",
          title: "PR3",
          parent: { id: "epic-1", title: "Stacked PR epic" },
          createdAt: "2024-01-03T00:00:00Z",
          dependencyRefs: [{ issueId: "pr-3", dependsOnId: "pr-2", dependencyType: "blocks" }],
        }),
        createMockIssue({
          id: "pr-1",
          title: "PR1",
          parent: { id: "epic-1", title: "Stacked PR epic" },
          createdAt: "2024-01-01T00:00:00Z",
        }),
      ];

      const result = filterAndSortIssues(issues, {
        showClosed: true,
        sortBy: "updated",
      });

      expect(result.issueTree.roots[0]?.children.map((node) => node.issue.id)).toEqual([
        "pr-1",
        "pr-2",
        "pr-3",
        "pr-4",
      ]);
    });

    it("uses search relevance before the selected sort", () => {
      const issues = [
        createMockIssue({
          id: "task-201",
          title: "General cleanup",
        }),
        createMockIssue({
          id: "issue-2",
          title: "Task-201 tracking follow-up",
        }),
      ];

      const result = filterAndSortIssues(issues, {
        showClosed: true,
        sortBy: "title",
        searchQuery: "task-201",
      });

      expect(result.issues.map((issue) => issue.id)).toEqual(["task-201", "issue-2"]);
    });

    it("handles malformed dates gracefully", () => {
      const issuesWithBadDates = [
        createMockIssue({
          id: "bad-date-1",
          createdAt: "invalid-date",
          updatedAt: "also-invalid",
        }),
      ];

      expect(() => filterAndSortIssues(issuesWithBadDates)).not.toThrow();
    });
  });

  describe("filterIssuesForList", () => {
    it("matches labels, parent titles, descriptions, and notes", () => {
      const issues = [
        createMockIssue({
          id: "issue-label",
          title: "Unrelated",
          labels: ["parser"],
        }),
        createMockIssue({
          id: "issue-parent",
          title: "Unrelated",
          parent: { id: "epic-parser", title: "Parser pipeline" },
        }),
        createMockIssue({
          id: "issue-description",
          title: "Unrelated",
          description: "Touches the parser worker",
        }),
        createMockIssue({
          id: "issue-notes",
          title: "Unrelated",
          notes: "Parser note",
        }),
      ];

      expect(
        filterIssuesForList(issues, {
          showClosed: true,
          searchQuery: "parser",
        }).map((issue) => issue.id),
      ).toEqual(["issue-label", "issue-parent", "issue-description", "issue-notes"]);
    });

    it("supports fuzzy typo-tolerant matching", () => {
      const issues = [
        createMockIssue({
          id: "issue-typo",
          title: "Implement parser pipeline",
        }),
      ];

      const result = filterIssuesForList(issues, {
        showClosed: true,
        searchQuery: "parsr",
      });

      expect(result.map((issue) => issue.id)).toEqual(["issue-typo"]);
    });

    it("treats deferred issues as active", () => {
      const issues = [
        createMockIssue({
          id: "issue-deferred",
          status: "deferred",
        }),
      ];

      const result = filterIssuesForList(issues);

      expect(result.map((issue) => issue.id)).toEqual(["issue-deferred"]);
    });
  });

  describe("searchItems", () => {
    it("searches across multiple fields", () => {
      const items = [
        { id: "1", title: "Bug Report", description: "Critical issue" },
        { id: "2", title: "Feature", description: "Enhancement request" },
      ];
      const result = searchItems(items, "bug", ["title", "description"]);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe("1");
      expect(result.query).toBe("bug");
    });

    it("returns highlight ranges", () => {
      const items = [{ id: "1", title: "Bug Report" }];
      const result = searchItems(items, "bug", ["title"]);

      expect(result.highlightRanges.size).toBeGreaterThan(0);
    });

    it("handles empty query", () => {
      const items = [{ id: "1", title: "Test" }];
      const result = searchItems(items, "", ["title"]);

      expect(result.items).toHaveLength(1);
      expect(result.query).toBe("");
    });
  });

  describe("validateIssueState", () => {
    it("validates clean state", () => {
      const result = validateIssueState(SAMPLE_ISSUES, {});

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects duplicate issue IDs", () => {
      const duplicateIssues = [
        createMockIssue({ id: "duplicate" }),
        createMockIssue({ id: "duplicate" }),
      ];
      const result = validateIssueState(duplicateIssues, {});

      expect(result.isValid).toBe(false);
      expect(result.errors.some((error) => error.includes("Duplicate issue IDs"))).toBe(true);
    });

    it("warns about too many labels", () => {
      const manyLabels = Array.from({ length: 60 }, (_, index) => `label-${index}`);
      const result = validateIssueState([], {
        selectedLabels: manyLabels,
      } satisfies IssueFilterOptions);

      expect(result.warnings.some((warning) => warning.includes("Too many labels"))).toBe(true);
    });

    it("validates search query length", () => {
      const longQuery = "a".repeat(1001);
      const result = validateIssueState([], { searchQuery: longQuery });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((error) => error.includes("too long"))).toBe(true);
    });
  });

  describe("performance utilities", () => {
    it("debounce delays function execution", async () => {
      let callCount = 0;
      const fn = () => callCount++;
      const debounced = debounce(fn, 50);

      debounced();
      debounced();
      debounced();

      expect(callCount).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(callCount).toBe(1);
    });

    it("throttle limits function calls", async () => {
      let callCount = 0;
      const fn = () => callCount++;
      const throttled = throttle(fn, 50);

      throttled();
      throttled();
      throttled();

      expect(callCount).toBe(1);
    });

    it("memoize caches function results", () => {
      let callCount = 0;
      const fn = (value: number) => {
        callCount++;
        return value * 2;
      };
      const memoized = memoize(fn);

      expect(memoized(5)).toBe(10);
      expect(memoized(5)).toBe(10);
      expect(callCount).toBe(1);
    });
  });
});
