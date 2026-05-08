import { describe, expect, it } from "vitest";

import {
  buildEpicGroupContextMenuItems,
  buildManagedIssueRowContextMenuItems,
} from "./sidebarContextMenus";

describe("buildManagedIssueRowContextMenuItems", () => {
  it("builds the managed issue row actions with sidebar enabled", () => {
    expect(
      buildManagedIssueRowContextMenuItems({
        canOpenIssueInSidebar: true,
      }),
    ).toEqual([
      {
        id: "open_issue_sidebar",
        label: "Open in sidebar",
        disabled: false,
      },
      {
        id: "open_issue_tracker",
        label: "Open in tracker",
      },
    ]);
  });

  it("disables open in sidebar when no same-project thread is open", () => {
    expect(
      buildManagedIssueRowContextMenuItems({
        canOpenIssueInSidebar: false,
      }),
    ).toEqual([
      {
        id: "open_issue_sidebar",
        label: "Open in sidebar",
        disabled: true,
      },
      {
        id: "open_issue_tracker",
        label: "Open in tracker",
      },
    ]);
  });
});

describe("buildEpicGroupContextMenuItems", () => {
  it("builds the epic group actions with start enabled", () => {
    expect(
      buildEpicGroupContextMenuItems({
        canStartNewRun: true,
      }),
    ).toEqual([
      {
        id: "start_new_run",
        label: "Start new run",
        disabled: false,
      },
      {
        id: "open_epic",
        label: "Open epic",
      },
    ]);
  });

  it("disables start when the epic cannot currently start a run", () => {
    expect(
      buildEpicGroupContextMenuItems({
        canStartNewRun: false,
      }),
    ).toEqual([
      {
        id: "start_new_run",
        label: "Start new run",
        disabled: true,
      },
      {
        id: "open_epic",
        label: "Open epic",
      },
    ]);
  });
});
