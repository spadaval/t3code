import { describe, expect, it } from "vitest";

import { compareItemsByCreatedAt, topologicallySortByDependencies } from "./dependencyOrder.ts";

interface TestItem {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly predecessors: readonly string[];
}

const makeItem = (
  overrides: Partial<TestItem> & Pick<TestItem, "id" | "title" | "createdAt">,
): TestItem => ({
  predecessors: [],
  ...overrides,
});

describe("compareItemsByCreatedAt", () => {
  it("uses createdAt ascending with title and id fallbacks", () => {
    const older = makeItem({ id: "b", title: "Beta", createdAt: "2024-01-01T00:00:00Z" });
    const newer = makeItem({ id: "a", title: "Alpha", createdAt: "2024-01-02T00:00:00Z" });

    expect(
      compareItemsByCreatedAt(older, newer, {
        getId: (item) => item.id,
        getCreatedAt: (item) => item.createdAt,
        getTitle: (item) => item.title,
      }),
    ).toBeLessThan(0);
  });
});

describe("topologicallySortByDependencies", () => {
  it("keeps predecessor chains in strict order with createdAt tie breaking", () => {
    const items = [
      makeItem({
        id: "pr-4",
        title: "PR4",
        createdAt: "2024-01-04T00:00:00Z",
        predecessors: ["pr-3"],
      }),
      makeItem({
        id: "pr-2",
        title: "PR2",
        createdAt: "2024-01-02T00:00:00Z",
        predecessors: ["pr-1"],
      }),
      makeItem({
        id: "pr-3",
        title: "PR3",
        createdAt: "2024-01-03T00:00:00Z",
        predecessors: ["pr-2"],
      }),
      makeItem({ id: "pr-1", title: "PR1", createdAt: "2024-01-01T00:00:00Z" }),
    ];

    expect(
      topologicallySortByDependencies({
        items,
        getId: (item) => item.id,
        getCreatedAt: (item) => item.createdAt,
        getTitle: (item) => item.title,
        getPredecessorIds: (item) => item.predecessors,
      }).map((item) => item.id),
    ).toEqual(["pr-1", "pr-2", "pr-3", "pr-4"]);
  });

  it("falls back to createdAt ordering when dependencies cycle", () => {
    const items = [
      makeItem({
        id: "b",
        title: "B",
        createdAt: "2024-01-02T00:00:00Z",
        predecessors: ["a"],
      }),
      makeItem({
        id: "a",
        title: "A",
        createdAt: "2024-01-01T00:00:00Z",
        predecessors: ["b"],
      }),
    ];

    expect(
      topologicallySortByDependencies({
        items,
        getId: (item) => item.id,
        getCreatedAt: (item) => item.createdAt,
        getTitle: (item) => item.title,
        getPredecessorIds: (item) => item.predecessors,
      }).map((item) => item.id),
    ).toEqual(["a", "b"]);
  });
});
