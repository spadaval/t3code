import type { BeadsIssueRelationSummary } from "@t3tools/contracts";
import type { MouseEvent } from "react";

import { cn } from "~/lib/utils";
import {
  formatPriorityDisplay,
  formatStatusDisplay,
  getPriorityVariant,
  getStatusVariant,
  isIssueDoneStatus,
} from "~/lib/issueConstants";
import { IssueTypeIcon } from "./IssueCard";
import { type IssueContextAction, useIssueContextMenu } from "./issueContextMenu";

// ---------------------------------------------------------------------------
// Semantic text color map (mirrors IssueCard)
// ---------------------------------------------------------------------------

const SEMANTIC_TEXT_COLOR: Record<string, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  error: "text-destructive-foreground",
  secondary: "text-muted-foreground",
  primary: "text-foreground",
};

// ---------------------------------------------------------------------------
// SubIssuesSection
// ---------------------------------------------------------------------------

export interface SubIssuesSectionProps {
  /** Direct children of the current issue. */
  subIssues: readonly BeadsIssueRelationSummary[];
  /** Called when the user clicks a child row to navigate to it. */
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextAction?:
    | ((issueId: string, action: Exclude<IssueContextAction, "copy_id" | "copy_title">) => void)
    | undefined;
  className?: string;
}

/**
 * Renders a compact table of direct child issues inside an issue detail view.
 * Used by both the sidebar detail (IssueDetail) and the full-page detail panel
 * (IssuesTab) to surface deeply nested issues that would otherwise be invisible
 * after the sidebar tree was restricted to epic-only nesting.
 */
export function SubIssuesSection({
  subIssues,
  onIssueSelect,
  onIssueContextAction,
  className,
}: SubIssuesSectionProps) {
  const handleIssueContextMenu = useIssueContextMenu(onIssueContextAction);

  if (subIssues.length === 0) return null;

  return (
    <section className={cn("space-y-1", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Children ({subIssues.length})
      </h3>
      <div className="overflow-hidden rounded-md border border-border/50">
        {subIssues.map((child, index) => (
          <SubIssueRow
            key={child.id}
            child={child}
            isLast={index === subIssues.length - 1}
            onIssueSelect={onIssueSelect}
            onIssueContextMenu={handleIssueContextMenu}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// SubIssueRow
// ---------------------------------------------------------------------------

function SubIssueRow({
  child,
  isLast,
  onIssueSelect,
  onIssueContextMenu,
}: {
  child: BeadsIssueRelationSummary;
  isLast: boolean;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextMenu?: (issue: BeadsIssueRelationSummary, event: MouseEvent) => void;
}) {
  const statusClass =
    SEMANTIC_TEXT_COLOR[getStatusVariant(child.status)] ?? "text-muted-foreground";
  const priorityDisplay = formatPriorityDisplay(child.priority);
  const priorityClass =
    child.priority !== null
      ? (SEMANTIC_TEXT_COLOR[getPriorityVariant(child.priority)] ?? "text-muted-foreground")
      : null;

  return (
    <button
      type="button"
      onClick={() => onIssueSelect?.(child.id)}
      onContextMenu={(event) => onIssueContextMenu?.(child, event)}
      className={cn(
        "group w-full px-3 py-2 text-left transition-colors hover:bg-muted/30",
        !isLast && "border-b border-border/40",
        !onIssueSelect && "cursor-default",
      )}
      aria-label={`Select child issue ${child.id}: ${child.title}`}
    >
      <div className="flex items-center gap-2">
        <IssueTypeIcon issueType={child.issueType} className="size-3.5" />
        {child.status === "blocked" ? (
          <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive">
            Blocked
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm text-foreground",
            isIssueDoneStatus(child.status) && "line-through",
          )}
        >
          {child.title}
        </span>
        <span className={cn("shrink-0 text-xs", statusClass)}>
          {formatStatusDisplay(child.status)}
        </span>
        {priorityDisplay && (
          <span className={cn("shrink-0 text-xs font-medium", priorityClass)}>
            {priorityDisplay}
          </span>
        )}
      </div>
      <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{child.id}</div>
    </button>
  );
}
