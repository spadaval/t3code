import { describe, expect, it, vi } from "vitest";

import { invalidateCoordinatorBeadsQueries } from "./useEpicCoordinatorActionRunner";

describe("invalidateCoordinatorBeadsQueries", () => {
  it("fires scoped coordinator invalidations without awaiting the refetch promises", () => {
    const invalidateQueries = vi.fn(
      (_input: unknown) =>
        new Promise<void>(() => {
          // Intentionally unresolved to verify the helper does not await it.
        }),
    );

    expect(invalidateCoordinatorBeadsQueries({ invalidateQueries })).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const call = invalidateQueries.mock.calls[0]?.[0] as
      | { predicate: (query: { queryKey: readonly unknown[] }) => boolean }
      | undefined;
    expect(call).toBeDefined();
    if (!call) {
      return;
    }
    expect(call).toMatchObject({
      predicate: expect.any(Function),
    });
    expect(
      call.predicate({ queryKey: ["beads", "project-run-summary", "/repo", "project-1"] }),
    ).toBe(true);
    expect(call.predicate({ queryKey: ["beads", "issues", "/repo", "all"] })).toBe(false);
  });
});
