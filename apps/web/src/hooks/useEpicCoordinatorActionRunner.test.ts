import { describe, expect, it, vi } from "vitest";

import { invalidateCoordinatorBeadsQueries } from "./useEpicCoordinatorActionRunner";

describe("invalidateCoordinatorBeadsQueries", () => {
  it("fires beads invalidation without returning or awaiting the refetch promise", () => {
    const invalidateQueries = vi.fn(
      () =>
        new Promise<void>(() => {
          // Intentionally unresolved to verify the helper does not await it.
        }),
    );

    expect(invalidateCoordinatorBeadsQueries({ invalidateQueries })).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["beads"],
    });
  });
});
