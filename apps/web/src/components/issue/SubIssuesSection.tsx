import type { BeadsIssueRelationSummary } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import {
  formatPriorityDisplay,
  formatStatusDisplay,
  getPriorityVariant,
  getStatusVariant,
  isIssueDoneStatus,
} from "~/lib/issueConstants";
import { IssueTypeIcon } from "./IssueCard";

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
  className?: string;
}

/**
 * Renders a compact table of direct sub-issues inside an issue detail view.
 * Used by both the sidebar detail (IssueDetail) and the full-page detail panel
 * (IssuesTab) to surface deeply nested issues that would otherwise be invisible
 * after the sidebar tree was restricted to epic-only nesting.
 */
export function SubIssuesSection({ subIssues, onIssueSelect, className }: SubIssuesSectionProps) {
  if (subIssues.length === 0) return null;

  return (
    <section className={cn("space-y-1", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sub-issues ({subIssues.length})
      </h3>
      <div className="overflow-hidden rounded-md border border-border/50">
        {subIssues.map((child, index) => (
          <SubIssueRow
            key={child.id}
            child={child}
            isLast={index === subIssues.length - 1}
            onIssueSelect={onIssueSelect}
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
}: {
  child: BeadsIssueRelationSummary;
  isLast: boolean;
  onIssueSelect?: ((issueId: string) => void) | undefined;
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
      className={cn(
        "group w-full px-3 py-2 text-left transition-colors hover:bg-muted/30",
        !isLast && "border-b border-border/40",
        !onIssueSelect && "cursor-default",
      )}
      aria-label={`Select sub-issue ${child.id}: ${child.title}`}
    >
      <div className="flex items-center gap-2">
        <IssueTypeIcon issueType={child.issueType} className="size-3.5" />
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
