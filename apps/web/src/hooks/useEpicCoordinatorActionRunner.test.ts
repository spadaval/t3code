import { describe, expect, it, vi } from "vitest";

import { invalidateCoordinatorBeadsQueries } from "./useEpicCoordinatorActionRunner";

describe("invalidateCoordinatorBeadsQueries", () => {
  it("fires scoped coordinator invalidations without awaiting the refetch promises", () => {
    const invalidateQueries = vi.fn(
      () =>
        new Promise<void>(() => {
          // Intentionally unresolved to verify the helper does not await it.
        }),
    );

    expect(invalidateCoordinatorBeadsQueries({ invalidateQueries })).toBeUndefined();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ["beads"],
    });
  });
});
