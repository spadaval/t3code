import { describe, expect, it } from "vitest";
import type { BeadsIssueSummary } from "@t3tools/contracts";
import {
  filterIssuesForList,
  filterAndSortIssues,
  searchItems,
  validateIssueState,
  debounce,
  throttle,
  memoize,
  type IssueFilterOptions,
} from "../issuePanelLogic";

// ── Test Fixtures ───────────────────────────────────────────────────────

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
  ...overrides,
});

const SAMPLE_ISSUES: readonly BeadsIssueSummary[] = [
  createMockIssue({
    id: "issue-1",
    title: "High Priority Bug",
    status: "open",
    labels: ["bug", "high-priority"],
    parent: { id: "epic-1", title: "Epic 1" },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-05T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-2",
    title: "Feature Request",
    status: "open",
    labels: ["enhancement", "feature"],
    parent: { id: "epic-2", title: "Epic 2" },
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-3",
    title: "Closed Bug Fix",
    status: "closed",
    labels: ["bug", "resolved"],
    parent: { id: "epic-1", title: "Epic 1" },
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
  }),
  createMockIssue({
    id: "issue-4",
    title: "Documentation Update",
    status: "open",
    labels: ["documentation"],
    parent: null, // No epic
    createdAt: "2024-01-04T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z", // Older update time
  }),
];

describe("issuePanelLogic", () => {
  describe("filterAndSortIssues", () => {
    it("returns all issues when no filters applied", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES, { scopeFilter: "all" });

      expect(result.issues).toHaveLength(4);
      expect(result.totalCount).toBe(4);
      expect(result.filteredCount).toBe(4);
    });

    it("filters by scope - active only (default)", () => {
      const result = filterAndSortIssues(SAMPLE_ISSUES); // Default should be active

      expect(result.issues).toHaveLength(3);
      expect(result.issues.every((issue) => issue.status === "open")).toBe(true);
      expect(result.filteredCount).toBe(3);
      expect(result.totalCount).toBe(4);
    });

    it("filters by scope - closed only", () => {
      const options: IssueFilterOptions = {
        scopeFilter: "closed",
      };
      const result = filterAndSortIssues(SAMPLE_ISSUES, options);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.status).toBe("closed");
      expect(result.filteredCount).toBe(1);
    });

    it("filters by search query - case insensitive title match", () => {
      const options: IssueFilterOptions = {
        searchQuery: "bug",
        scopeFilter: "all", // Include all to get both open and closed bug issues
      };
      const result = filterAndSortIssues(SAMPLE_ISSUES, options);

      expect(result.issues).toHaveLength(2);
      expect(result.issues.map((i) => i.id)).toEqual(["issue-1", "issue-3"]);
    });

    it("filters by search query - label match", () => {
      const options: IssueFilterOptions = {
        searchQuery: "feature",
      };
      const result = filterAndSortIssues(SAMPLE_ISSUES, options);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe("issue-2");
    });

    it("filters by selected labels", () => {
      const options: IssueFilterOptions = {
        selectedLabels: ["bug"],
        scopeFilter: "all", // Include all to get both open and closed bug issues
      };
      const result = filterAndSortIssues(SAMPLE_ISSUES, options);

      expect(result.issues).toHaveLength(2);
      expect(result.issues.every((issue) => issue.labels.includes("bug"))).toBe(true);
    });

    it("combines multiple filters", () => {
      const options: IssueFilterOptions = {
        scopeFilter: "active",
        selectedLabels: ["bug"],
        searchQuery: "priority",
      };
      const result = filterAndSortIssues(SAMPLE_ISSUES, options);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe("issue-1");
    });

    describe("sorting", () => {
      it("sorts by updated date descending (default)", () => {
        const result = filterAndSortIssues(SAMPLE_ISSUES, { scopeFilter: "all" });

        // Only checking open issues since default scope is active, but we want all for testing
        const expectedOrder = ["issue-1", "issue-2", "issue-3", "issue-4"];
        expect(result.issues.map((i) => i.id)).toEqual(expectedOrder);
      });

      it("sorts by updated date ascending", () => {
        const options: IssueFilterOptions = {
          sortBy: "updated",
          sortDirection: "asc",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        const expectedOrder = ["issue-4", "issue-3", "issue-2", "issue-1"];
        expect(result.issues.map((i) => i.id)).toEqual(expectedOrder);
      });

      it("sorts by title alphabetically", () => {
        const options: IssueFilterOptions = {
          sortBy: "title",
          sortDirection: "asc",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        const titles = result.issues.map((i) => i.title);
        expect(titles).toEqual([
          "Closed Bug Fix",
          "Documentation Update",
          "Feature Request",
          "High Priority Bug",
        ]);
      });

      it("sorts by created date", () => {
        const options: IssueFilterOptions = {
          sortBy: "created",
          sortDirection: "desc",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        const expectedOrder = ["issue-4", "issue-3", "issue-2", "issue-1"];
        expect(result.issues.map((i) => i.id)).toEqual(expectedOrder);
      });
    });

    describe("grouping", () => {
      it("groups by epic", () => {
        const options: IssueFilterOptions = {
          groupBy: "epic",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        expect(result.groupedIssues.get("epic-1")).toHaveLength(2);
        expect(result.groupedIssues.get("epic-2")).toHaveLength(1);
        expect(result.groupedIssues.get("no-epic")).toHaveLength(1);
      });

      it("groups by status", () => {
        const options: IssueFilterOptions = {
          groupBy: "status",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        expect(result.groupedIssues.get("open")).toHaveLength(3);
        expect(result.groupedIssues.get("closed")).toHaveLength(1);
      });

      it("groups by labels", () => {
        const options: IssueFilterOptions = {
          groupBy: "labels",
          scopeFilter: "all",
        };
        const result = filterAndSortIssues(SAMPLE_ISSUES, options);

        // Each issue should be in a group for each of its labels
        expect(result.groupedIssues.get("bug")).toHaveLength(2);
        expect(result.groupedIssues.get("enhancement")).toHaveLength(1);
        expect(result.groupedIssues.get("documentation")).toHaveLength(1);
      });
    });

    describe("edge cases", () => {
      it("handles empty issues array", () => {
        const result = filterAndSortIssues([]);

        expect(result.issues).toHaveLength(0);
        expect(result.totalCount).toBe(0);
        expect(result.filteredCount).toBe(0);
        // The empty result still has an "all" group for the default groupBy: "none"
        expect(result.groupedIssues.get("all")).toHaveLength(0);
      });

      it("handles issues with missing/null fields", () => {
        const incompleteIssues = [
          createMockIssue({
            id: "incomplete-1",
            title: "",
            labels: [],
            parent: null,
          }),
        ];

        const result = filterAndSortIssues(incompleteIssues);
        expect(result.issues).toHaveLength(1);
      });

      it("handles malformed dates gracefully", () => {
        const issuesWithBadDates = [
          createMockIssue({
            id: "bad-date-1",
            createdAt: "invalid-date",
            updatedAt: "also-invalid",
          }),
        ];

        // Should not throw and should handle gracefully
        expect(() => filterAndSortIssues(issuesWithBadDates)).not.toThrow();
      });
    });
  });

  describe("filterIssuesForList", () => {
    it("returns scoped issues in original order when search is empty", () => {
      const result = filterIssuesForList(SAMPLE_ISSUES, {
        scopeFilter: "active",
      });

      expect(result.map((issue) => issue.id)).toEqual(["issue-1", "issue-2", "issue-4"]);
    });

    it("matches issue ids before title matches", () => {
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

      const result = filterIssuesForList(issues, {
        scopeFilter: "all",
        searchQuery: "task-201",
      });

      expect(result.map((issue) => issue.id)).toEqual(["task-201", "issue-2"]);
    });

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
          scopeFilter: "all",
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
        scopeFilter: "all",
        searchQuery: "parsr",
      });

      expect(result.map((issue) => issue.id)).toEqual(["issue-typo"]);
    });

    it("ranks title matches above description-only matches", () => {
      const issues = [
        createMockIssue({
          id: "issue-title",
          title: "Parser improvements",
          description: "General cleanup",
        }),
        createMockIssue({
          id: "issue-description",
          title: "General cleanup",
          description: "Parser improvements",
        }),
      ];

      const result = filterIssuesForList(issues, {
        scopeFilter: "all",
        searchQuery: "parser",
      });

      expect(result.map((issue) => issue.id)).toEqual(["issue-title", "issue-description"]);
    });

    it("treats deferred issues as active", () => {
      const issues = [
        createMockIssue({
          id: "issue-deferred",
          status: "deferred",
        }),
      ];

      const result = filterIssuesForList(issues, {
        scopeFilter: "active",
      });

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
      expect(result.errors.some((e) => e.includes("Duplicate issue IDs"))).toBe(true);
    });

    it("warns about too many labels", () => {
      const manyLabels = Array.from({ length: 60 }, (_, i) => `label-${i}`);
      const result = validateIssueState([], { selectedLabels: manyLabels });

      expect(result.warnings.some((w) => w.includes("Too many labels"))).toBe(true);
    });

    it("validates search query length", () => {
      const longQuery = "a".repeat(1001);
      const result = validateIssueState([], { searchQuery: longQuery });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("too long"))).toBe(true);
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
      const fn = (x: number) => {
        callCount++;
        return x * 2;
      };
      const memoized = memoize(fn);

      expect(memoized(5)).toBe(10);
      expect(memoized(5)).toBe(10);
      expect(callCount).toBe(1);
    });
  });
});
