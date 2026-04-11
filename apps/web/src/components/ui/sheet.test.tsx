import { describe, expect, it } from "vitest";

import { getSheetPopupSideClassName } from "./sheet";

describe("sheet side sizing", () => {
  it("keeps right sheets at full viewport height", () => {
    const className = getSheetPopupSideClassName("right");

    expect(className).toContain("col-start-2");
    expect(className).toContain("h-full");
  });

  it("keeps left sheets at full viewport height", () => {
    const className = getSheetPopupSideClassName("left");

    expect(className).toContain("border-e");
    expect(className).toContain("h-full");
  });
});
