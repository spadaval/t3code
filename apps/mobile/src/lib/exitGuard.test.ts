import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({}));

import { createExitGuard, EXIT_CONFIRM_WINDOW_MS } from "./exitGuard";

describe("createExitGuard", () => {
  it("lets only a second Back within the window leave the app", () => {
    let now = 0;
    const warn = vi.fn();
    const guard = createExitGuard(() => now, warn);

    expect(guard()).toBe(true);
    now += EXIT_CONFIRM_WINDOW_MS;
    expect(guard()).toBe(true);
    now += EXIT_CONFIRM_WINDOW_MS - 1;
    expect(guard()).toBe(false);
    expect(guard()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
