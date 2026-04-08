import type { BeadsIssueSummary } from "@t3tools/contracts";
import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { StatusIndicator, IssueStatus, Priority } from "../shared/StatusIndicator";
import { LabelGroup } from "../shared/LabelGroup";

export interface IssueCardProps {
  issue: BeadsIssueSummary;
  className?: string;
  selected?: boolean;
  focused?: boolean;
  onClick?: () => void;
  onLabelClick?: ((label: string) => void) | undefined;
  showPriority?: boolean;
  showLabels?: boolean;
  compact?: boolean;
  actions?: ReactNode;
}

/**
 * IssueCard - Clean, scannable issue display component
 *
 * Replaces the previous badge-heavy issue display with a clean, hierarchical layout.
 * Focuses on readability and reduces visual noise significantly.
 *
 * @example
 * <IssueCard
 *   issue={issue}
 *   selected={selectedId === issue.id}
 *   onClick={() => setSelectedId(issue.id)}
 *   onLabelClick={handleLabelFilter}
 * />
 */
export function IssueCard({
  issue,
  className,
  selected = false,
  focused = false,
  onClick,
  onLabelClick,
  showPriority = true,
  showLabels = true,
  compact = false,
  actions,
}: IssueCardProps) {
  const statusVariant = getStatusVariant(issue.status);
  const priorityComponent = issue.priority !== null ? getPriorityComponent(issue.priority) : null;

  return (
    <div
      className={cn(
        "group border-l-2 border-transparent bg-background p-3 transition-all duration-200 ease-out",
        "hover:bg-muted/30 hover:shadow-sm hover:scale-[1.01] focus-within:bg-muted/30 focus-within:shadow-sm",
        selected && "border-l-primary bg-muted/50 shadow-sm animate-fade-in",
        focused && "ring-2 ring-ring ring-offset-2 bg-muted/40 shadow-md",
        onClick && "cursor-pointer active:scale-[0.99]",
        compact && "py-2 px-2.5",
        className,
      )}
      onClick={onClick}
      tabIndex={focused ? 0 : undefined}
      role={onClick ? "button" : undefined}
      aria-label={onClick ? `Select issue: ${issue.title}` : undefined}
    >
      {/* Header: Title and Status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusIndicator variant={statusVariant} size={compact ? "sm" : "md"}>
              {formatStatusDisplay(issue.status)}
            </StatusIndicator>
            {showPriority && priorityComponent && (
              <span className="transition-all duration-200 ease-out">{priorityComponent}</span>
            )}
            <span className="text-xs text-muted-foreground transition-colors duration-200 group-hover:text-foreground/80">
              #{issue.id}
            </span>
          </div>

          <h3
            className={cn(
              "font-medium text-foreground leading-snug transition-all duration-200 ease-out group-hover:text-foreground/90",
              compact ? "text-sm" : "text-base",
            )}
          >
            {issue.title}
          </h3>
        </div>

        {actions && (
          <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out transform translate-x-1 group-hover:translate-x-0">
            {actions}
          </div>
        )}
      </div>

      {/* Secondary Information with staggered animation */}
      {!compact && (
        <div className="mt-2 space-y-1.5 animate-fade-in">
          {/* Labels */}
          {showLabels && issue.labels.length > 0 && (
            <div className="transition-all duration-200 ease-out">
              <LabelGroup labels={issue.labels} onLabelClick={onLabelClick} maxVisible={4} />
            </div>
          )}

          {/* Description Preview (if available and not too long) */}
          {issue.description && issue.description.length > 0 && issue.description.length < 120 && (
            <p className="text-sm text-muted-foreground line-clamp-2 transition-colors duration-200 group-hover:text-muted-foreground/90">
              {issue.description}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground transition-colors duration-200 group-hover:text-muted-foreground/90">
            {issue.assignee && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                {issue.assignee}
              </span>
            )}
            {issue.updatedAt && (
              <span title={new Date(issue.updatedAt).toLocaleString()}>
                Updated {formatRelativeTime(issue.updatedAt)}
              </span>
            )}
            {issue.commentCount && issue.commentCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-info/60" />
                {issue.commentCount} comment{issue.commentCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions to map current badge logic to clean status display
function getStatusVariant(status: string): "success" | "warning" | "info" | "error" | "secondary" {
  switch (status) {
    case "closed":
      return "success";
    case "in_progress":
      return "warning";
    case "open":
      return "info";
    case "blocked":
      return "error";
    case "deferred":
      return "secondary";
    default:
      return "secondary";
  }
}

function formatStatusDisplay(status: string): string {
  return status.replace(/_/g, " ");
}

function getPriorityComponent(priority: number): ReactNode {
  if (priority <= 1) return <Priority.P1 />;
  if (priority === 2) return <Priority.P2 />;
  return <Priority.P3 />;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// Specialized variants for different contexts
export const CompactIssueCard = (props: Omit<IssueCardProps, "compact">) => (
  <IssueCard {...props} compact />
);

export const EpicIssueCard = (props: IssueCardProps) => (
  <IssueCard {...props} className={cn("ml-4 border-l-muted", props.className)} />
);
