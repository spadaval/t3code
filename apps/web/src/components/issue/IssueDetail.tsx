import type { BeadsIssueDetail, BeadsIssueRelationSummary } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { MessageSquareTextIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  getStatusVariant,
  formatStatusDisplay,
  getPriorityVariant,
  isIssueDoneStatus,
} from "~/lib/issueConstants";
import { formatShortTimestamp } from "~/timestampFormat";
import { useSettings } from "~/hooks/useSettings";
import { StatusIndicator } from "../shared/StatusIndicator";
import { LabelGroup } from "../shared/LabelGroup";
import { Button } from "../ui/button";
import {
  IssueParentLink,
  IssueRelationshipSummaryBar,
  IssueRelationshipsSection,
} from "./IssueRelationships";
import { SubIssuesSection } from "./SubIssuesSection";
import { IssueTypeIcon } from "./IssueCard";
import type { IssueContextAction } from "./issueContextMenu";

export interface IssueDetailProps {
  issue: BeadsIssueDetail;
  parent?: BeadsIssueRelationSummary | null;
  /** Direct child issues. When provided, renders a children section. */
  subIssues?: readonly BeadsIssueRelationSummary[] | undefined;
  dependents?: readonly BeadsIssueRelationSummary[] | undefined;
  className?: string;
  onDependencyClick?: ((dependencyId: string) => void) | undefined;
  onSubIssueClick?: ((issueId: string) => void) | undefined;
  onSubIssueContextAction?:
    | ((issueId: string, action: Exclude<IssueContextAction, "copy_id" | "copy_title">) => void)
    | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
  showCompactSections?: boolean;
  // Enhanced interaction props
  loading?: boolean;
  sectionsLoading?: {
    comments?: boolean;
    dependencies?: boolean;
  };
  onClose?: () => void;
  autoFocus?: boolean;
}

/**
 * IssueDetail - Enhanced clean, focused issue detail display component
 *
 * Features:
 * - Keyboard navigation and shortcuts
 * - Focus management for accessibility
 * - Loading states for different sections
 *
 * Replaces the monolithic badge-heavy IssueOverviewContent with a clean,
 * hierarchical layout that implements progressive disclosure patterns.
 * Reduces visual noise significantly while maintaining all functionality.
 *
 * Keyboard shortcuts:
 * - Escape: Close detail view (if onClose provided)
 * - C: Toggle comments section
 *
 * @example
 * <IssueDetail
 *   issue={issueDetail}
 *   onDependencyClick={handleDependencySelect}
 *   onLabelClick={handleLabelFilter}
 *   autoFocus
 *   onClose={handleClose}
 * />
 */
export function IssueDetail({
  issue,
  parent = null,
  subIssues,
  dependents = [],
  className,
  onDependencyClick,
  onSubIssueClick,
  onSubIssueContextAction,
  onLabelClick,
  showCompactSections = false,
  loading = false,
  sectionsLoading = {},
  onClose,
  autoFocus = false,
}: IssueDetailProps) {
  const settings = useSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const [commentsExpanded, setCommentsExpanded] = useState(false);

  const statusVariant = getStatusVariant(issue.status);
  const priorityComponent = issue.priority !== null ? getPriorityDisplay(issue.priority) : null;

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!autoFocus) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when this component has focus
      if (!containerRef.current?.contains(document.activeElement)) return;

      switch (event.key) {
        case "Escape":
          if (onClose) {
            event.preventDefault();
            onClose();
          }
          break;
        case "c":
        case "C":
          if (issue.comments.length > 0 && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            setCommentsExpanded((prev) => !prev);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [issue, onClose, autoFocus]);

  // Auto focus on mount
  useEffect(() => {
    if (autoFocus && containerRef.current) {
      // Small delay to ensure proper focus
      setTimeout(() => {
        containerRef.current?.focus();
      }, 100);
    }
  }, [autoFocus]);

  // Progressive disclosure limits
  const PREVIEW_LIMIT = showCompactSections ? 2 : 3;
  const visibleComments = commentsExpanded
    ? issue.comments
    : issue.comments.slice(0, PREVIEW_LIMIT);

  const hasHiddenComments = issue.comments.length > PREVIEW_LIMIT;

  const handleToggleComments = useCallback(() => {
    setCommentsExpanded(!commentsExpanded);
  }, [commentsExpanded]);

  if (loading) {
    return (
      <div className={cn("space-y-6 animate-pulse", className)}>
        {/* Header skeleton */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="w-16 h-5 bg-muted rounded" />
            <div className="w-12 h-5 bg-muted rounded" />
            <div className="w-8 h-5 bg-muted rounded" />
          </div>
          <div className="w-3/4 h-6 bg-muted rounded" />
          <div className="w-1/2 h-4 bg-muted rounded" />
        </div>

        {/* Content skeleton */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="w-20 h-3 bg-muted rounded" />
            <div className="space-y-1">
              <div className="w-full h-3 bg-muted rounded" />
              <div className="w-4/5 h-3 bg-muted rounded" />
              <div className="w-3/5 h-3 bg-muted rounded" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="w-16 h-3 bg-muted rounded" />
            <div className="flex gap-1">
              <div className="w-12 h-5 bg-muted rounded" />
              <div className="w-16 h-5 bg-muted rounded" />
              <div className="w-20 h-5 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("space-y-6 focus-visible:outline-none", className)}
      tabIndex={autoFocus ? 0 : undefined}
      role="main"
      aria-label={`Issue details for ${issue.title}`}
    >
      {/* Primary: Status and Metadata */}
      <IssueDetailHeader
        issue={issue}
        parent={parent}
        onParentClick={onDependencyClick}
        statusVariant={statusVariant}
        priorityComponent={priorityComponent}
        timestampFormat={settings.timestampFormat}
      />

      <IssueRelationshipSummaryBar
        parent={parent}
        subIssues={subIssues ?? []}
        dependencies={issue.dependencies}
        dependents={dependents}
      />

      {/* Secondary: Description and Notes */}
      <IssueDetailContent issue={issue} />

      {/* Children of this issue */}
      {subIssues && subIssues.length > 0 && (
        <SubIssuesSection
          subIssues={subIssues}
          onIssueSelect={onSubIssueClick}
          onIssueContextAction={onSubIssueContextAction}
        />
      )}

      {/* Secondary: Labels */}
      {issue.labels.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Labels
          </h3>
          <LabelGroup
            labels={issue.labels}
            onLabelClick={onLabelClick}
            maxVisible={6}
            variant="default"
            expandable
          />
        </div>
      )}

      {/* Tertiary: Progressive Disclosure Sections */}
      <div className="space-y-6">
        <IssueRelationshipsSection
          parent={parent}
          subIssues={subIssues ?? []}
          dependencies={issue.dependencies}
          dependents={dependents}
          onIssueSelect={onDependencyClick}
          compact={showCompactSections}
        />

        {/* Comments */}
        {issue.comments.length > 0 && (
          <ProgressiveSection
            title={`Comments (${issue.comments.length})`}
            expanded={commentsExpanded}
            onToggle={handleToggleComments}
            hasHidden={hasHiddenComments}
            hiddenCount={issue.comments.length - PREVIEW_LIMIT}
            compact={showCompactSections}
            loading={sectionsLoading.comments ?? false}
            shortcut="C"
          >
            {sectionsLoading.comments ? (
              <div className="space-y-3">
                {["comment-skeleton-1", "comment-skeleton-2"].map((key) => (
                  <div key={key} className="animate-pulse">
                    <div className="flex gap-2 mb-2">
                      <div className="w-4 h-4 bg-muted rounded" />
                      <div className="w-20 h-4 bg-muted rounded" />
                      <div className="w-16 h-4 bg-muted rounded" />
                    </div>
                    <div className="space-y-1 pl-6">
                      <div className="w-full h-3 bg-muted rounded" />
                      <div className="w-3/4 h-3 bg-muted rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {visibleComments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    timestampFormat={settings.timestampFormat}
                    compact={showCompactSections}
                  />
                ))}
              </div>
            )}
          </ProgressiveSection>
        )}
      </div>

      {/* Keyboard shortcuts help */}
      {autoFocus && (
        <div className="mt-8 p-3 bg-muted/30 rounded-lg border border-border/30">
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Keyboard shortcuts:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span>
                <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> Close
              </span>
              {issue.comments.length > 0 && (
                <span>
                  <kbd className="px-1 py-0.5 bg-muted rounded text-xs">C</kbd> Comments
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Header component with primary information
function IssueDetailHeader({
  issue,
  parent,
  onParentClick,
  statusVariant,
  priorityComponent,
  timestampFormat,
}: {
  issue: BeadsIssueDetail;
  parent: BeadsIssueRelationSummary | null;
  onParentClick?: ((issueId: string) => void) | undefined;
  statusVariant: "success" | "warning" | "info" | "error" | "secondary" | "primary";
  priorityComponent: ReactNode;
  timestampFormat: TimestampFormat;
}) {
  const metadataItems: string[] = [];

  if (issue.owner) {
    metadataItems.push(`Owner: ${issue.owner}`);
  }
  if (issue.assignee) {
    metadataItems.push(`Assigned to: ${issue.assignee}`);
  }
  metadataItems.push(`Updated ${formatShortTimestamp(issue.updatedAt, timestampFormat)}`);

  if (issue.createdAt !== issue.updatedAt) {
    metadataItems.push(`Created ${formatShortTimestamp(issue.createdAt, timestampFormat)}`);
  }

  return (
    <div className="space-y-3">
      <IssueParentLink parent={parent} onClick={onParentClick} />

      {/* Status and Priority Row */}
      <div className="flex items-center gap-3">
        <IssueTypeIcon issueType={issue.issueType} />
        <StatusIndicator variant={statusVariant}>
          {formatStatusDisplay(issue.status)}
        </StatusIndicator>
        {priorityComponent}
        <span className="text-sm text-muted-foreground">#{issue.id}</span>
      </div>

      {/* Title */}
      <h1
        className={cn(
          "text-xl font-semibold text-foreground leading-tight",
          isIssueDoneStatus(issue.status) && "line-through",
        )}
      >
        {issue.title}
      </h1>

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {metadataItems.map((item) => (
          <span key={item} className="flex items-center gap-2">
            {metadataItems.indexOf(item) > 0 && <span className="opacity-40">·</span>}
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// Content sections (description and notes)
function IssueDetailContent({ issue }: { issue: BeadsIssueDetail }) {
  return (
    <div className="space-y-4">
      {/* Description */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Description
        </h3>
        <div className="prose prose-sm max-w-none text-sm text-foreground">
          {issue.description?.trim() ? (
            <div className="whitespace-pre-wrap">{issue.description}</div>
          ) : (
            <span className="text-muted-foreground italic">No description provided.</span>
          )}
        </div>
      </div>

      {/* Notes */}
      {issue.notes?.trim() && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </h3>
          <div className="prose prose-sm max-w-none text-sm text-foreground">
            <div className="whitespace-pre-wrap">{issue.notes}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Enhanced progressive disclosure wrapper component
function ProgressiveSection({
  title,
  expanded,
  onToggle,
  hasHidden,
  hiddenCount,
  compact,
  loading = false,
  shortcut,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  hasHidden: boolean;
  hiddenCount: number;
  compact?: boolean;
  loading?: boolean;
  shortcut?: string;
  children: ReactNode;
}) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
          {loading && (
            <span className="size-3 border border-current border-t-transparent rounded-full animate-spin opacity-50" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {shortcut && (
            <kbd className="px-1 py-0.5 text-xs font-mono bg-muted/50 text-muted-foreground rounded">
              {shortcut}
            </kbd>
          )}
          {hasHidden && !expanded && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="h-auto p-0 text-xs text-info-foreground hover:text-info hover:bg-transparent hover:underline focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`Show ${hiddenCount} more ${title.toLowerCase()}`}
            >
              Show {hiddenCount} more
            </Button>
          )}
        </div>
      </div>

      <div className={cn("space-y-2", compact && "space-y-1")}>{children}</div>

      {expanded && hasHidden && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          onKeyDown={handleKeyDown}
          disabled={loading}
          className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`Show less ${title.toLowerCase()}`}
        >
          Show less
        </Button>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  timestampFormat,
  compact,
}: {
  comment: BeadsIssueDetail["comments"][0];
  timestampFormat: TimestampFormat;
  compact?: boolean;
}) {
  return (
    <div className={cn("py-3 first:pt-0 last:pb-0", compact && "py-2")}>
      <div className="flex items-center gap-2 mb-2">
        <MessageSquareTextIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-sm text-foreground">{comment.author || "Unknown"}</span>
        <span className="text-xs text-muted-foreground opacity-60">·</span>
        <span className="text-xs text-muted-foreground">
          {formatShortTimestamp(comment.createdAt, timestampFormat)}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-sm text-foreground pl-5">{comment.text}</div>
    </div>
  );
}

// Helper function for priority display
function getPriorityDisplay(priority: number): ReactNode {
  const variant = getPriorityVariant(priority);
  return (
    <StatusIndicator variant={variant} size="sm" showDot={false}>
      P{priority}
    </StatusIndicator>
  );
}

// Export specialized variants for different contexts
export const CompactIssueDetail = (props: Omit<IssueDetailProps, "showCompactSections">) => (
  <IssueDetail {...props} showCompactSections />
);
