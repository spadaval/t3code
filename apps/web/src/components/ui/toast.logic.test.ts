import { describe, expect, it } from "vitest";

import { listVisibleToastPositions, resolveToastPosition, type ToastPosition } from "./toast.logic";

describe("toast.logic", () => {
  it("falls back to the provider position when a toast does not set one", () => {
    expect(resolveToastPosition(undefined, "top-right")).toBe("top-right");
  });

  it("preserves an explicit per-toast position", () => {
    expect(resolveToastPosition("bottom-right", "top-right")).toBe("bottom-right");
  });

  it("lists unique visible toast positions in encounter order", () => {
    const visibleToasts = [
      { data: {} },
      { data: { position: "bottom-right" as ToastPosition } },
      { data: { position: "bottom-right" as ToastPosition } },
      { data: { position: "top-left" as ToastPosition } },
    ];

    expect(listVisibleToastPositions(visibleToasts, "top-right")).toEqual([
      "top-right",
      "bottom-right",
      "top-left",
    ]);
  });

  it("returns the provider position when there are no visible toasts", () => {
    expect(listVisibleToastPositions([], "top-right")).toEqual(["top-right"]);
  });
});
