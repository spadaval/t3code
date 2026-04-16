import type { ContextMenuItem } from "@t3tools/contracts";

export type ManagedIssueRowContextAction = "open_issue_sidebar" | "open_issue_tracker";

export function buildManagedIssueRowContextMenuItems(input: {
  readonly canOpenIssueInSidebar: boolean;
}): ContextMenuItem<ManagedIssueRowContextAction>[] {
  return [
    {
      id: "open_issue_sidebar",
      label: "Open in sidebar",
      disabled: !input.canOpenIssueInSidebar,
    },
    {
      id: "open_issue_tracker",
      label: "Open in tracker",
    },
  ];
}

export type EpicGroupContextAction = "start_new_run" | "open_epic";

export function buildEpicGroupContextMenuItems(input: {
  readonly canStartNewRun: boolean;
}): ContextMenuItem<EpicGroupContextAction>[] {
  return [
    {
      id: "start_new_run",
      label: "Start new run",
      disabled: !input.canStartNewRun,
    },
    {
      id: "open_epic",
      label: "Open epic",
    },
  ];
}
