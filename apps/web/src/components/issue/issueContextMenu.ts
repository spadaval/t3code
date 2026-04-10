import type { BeadsIssueRelationSummary, BeadsIssueSummary } from "@t3tools/contracts";
import { useCallback, type MouseEvent } from "react";

import { readNativeApi } from "~/nativeApi";

export type IssueContextAction =
  | "implement"
  | "refine"
  | "quick_refine"
  | "planned_refine"
  | "copy_id"
  | "copy_title"
  | "open_in_tracker"
  | "mark_closed";

type IssueContextMenuIssue = Pick<
  BeadsIssueSummary | BeadsIssueRelationSummary,
  "id" | "title" | "status" | "issueType"
>;

export function buildIssueContextMenuItems(issue: IssueContextMenuIssue): Array<{
  id: IssueContextAction;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}> {
  const isEpic = issue.issueType.toLowerCase() === "epic";
  const isClosed = issue.status === "closed";
  const items: Array<{
    id: IssueContextAction;
    label: string;
    destructive?: boolean;
    disabled?: boolean;
  }> = [];

  if (!isClosed) {
    if (isEpic) {
      items.push({ id: "quick_refine", label: "Quick refine" });
      items.push({ id: "planned_refine", label: "Planned refine" });
    } else {
      items.push({ id: "implement", label: "Implement" });
      items.push({ id: "refine", label: "Refine" });
    }
  }

  items.push({ id: "copy_id", label: "Copy ID" });
  items.push({ id: "copy_title", label: "Copy title" });
  items.push({ id: "open_in_tracker", label: "Open in tracker" });

  if (!isClosed) {
    items.push({ id: "mark_closed", label: "Mark closed", destructive: true });
  }

  return items;
}

export function useIssueContextMenu(
  onIssueContextAction?:
    | ((issueId: string, action: Exclude<IssueContextAction, "copy_id" | "copy_title">) => void)
    | undefined,
) {
  return useCallback(
    (issue: IssueContextMenuIssue, event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readNativeApi();
      if (!api) {
        return;
      }

      void api.contextMenu
        .show(buildIssueContextMenuItems(issue), {
          x: event.clientX,
          y: event.clientY,
        })
        .then((action) => {
          if (!action) {
            return;
          }

          if (action === "copy_id") {
            void navigator.clipboard.writeText(issue.id);
            return;
          }

          if (action === "copy_title") {
            void navigator.clipboard.writeText(issue.title);
            return;
          }

          onIssueContextAction?.(issue.id, action);
        });
    },
    [onIssueContextAction],
  );
}
