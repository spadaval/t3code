import type { BeadsIssueRelationSummary, ThreadId } from "@t3tools/contracts";
import type { KeyboardEvent, MouseEvent } from "react";
import { ArrowRightIcon, ExternalLinkIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";

import type { EpicChildExecutionRow, EpicChildExecutionState } from "~/lib/epicExecutionView";
import { cn } from "~/lib/utils";
import {
  formatPriorityDisplay,
  formatStatusDisplay,
  getPriorityVariant,
  getStatusVariant,
  isIssueDoneStatus,
} from "~/lib/issueConstants";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  executionRows?: readonly EpicChildExecutionRow[] | undefined;
  executionError?: Error | null | undefined;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
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
  executionRows,
  executionError,
  onOpenThread,
  onIssueSelect,
  onIssueContextAction,
  className,
}: SubIssuesSectionProps) {
  const handleIssueContextMenu = useIssueContextMenu(onIssueContextAction);
  const rows =
    executionRows ??
    subIssues.map((child) => ({
      child,
      execution: null,
    }));

  if (subIssues.length === 0) return null;

  return (
    <section className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Children ({subIssues.length})
        </h3>
        {executionError ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex items-center gap-1 text-xs text-warning-foreground" />
              }
            >
              <TriangleAlertIcon className="size-3.5" />
              Execution status unavailable
            </TooltipTrigger>
            <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap leading-tight">
              {executionError.message}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border/50">
        {rows.map((row, index) => (
          <SubIssueRow
            key={row.child.id}
            row={row}
            isLast={index === rows.length - 1}
            onOpenThread={onOpenThread}
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
  row,
  isLast,
  onOpenThread,
  onIssueSelect,
  onIssueContextMenu,
}: {
  row: { child: BeadsIssueRelationSummary; execution: EpicChildExecutionState | null };
  isLast: boolean;
  onOpenThread?: ((threadId: ThreadId) => void) | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextMenu?: (issue: BeadsIssueRelationSummary, event: MouseEvent) => void;
}) {
  const { child, execution } = row;
  const statusClass =
    SEMANTIC_TEXT_COLOR[getStatusVariant(child.status)] ?? "text-muted-foreground";
  const priorityDisplay = formatPriorityDisplay(child.priority);
  const priorityClass =
    child.priority !== null
      ? (SEMANTIC_TEXT_COLOR[getPriorityVariant(child.priority)] ?? "text-muted-foreground")
      : null;
  const ariaLabel = execution
    ? `Select child issue ${child.id}: ${child.title}. Execution status: ${execution.label}.`
    : `Select child issue ${child.id}: ${child.title}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onIssueSelect?.(child.id);
  };

  const handleOpenThread = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (execution?.workerThreadId) {
      onOpenThread?.(execution.workerThreadId);
    }
  };

  return (
    <div
      role="button"
      tabIndex={onIssueSelect ? 0 : undefined}
      onClick={() => onIssueSelect?.(child.id)}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => onIssueContextMenu?.(child, event)}
      className={cn(
        "group w-full px-3 py-2 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        !isLast && "border-b border-border/40",
        !onIssueSelect && "cursor-default",
      )}
      aria-label={ariaLabel}
    >
      <div className="flex items-center gap-2">
        <ExecutionIndicator execution={execution} />
        <IssueTypeIcon issueType={child.issueType} className="size-3.5" />
        <BlockedScopePill execution={execution} childStatus={child.status} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm text-foreground",
            isIssueDoneStatus(child.status) && "line-through",
          )}
        >
          {child.title}
        </span>
        {execution ? <ExecutionPill execution={execution} /> : null}
        <span className={cn("shrink-0 text-xs", statusClass)}>
          {formatStatusDisplay(child.status)}
        </span>
        {priorityDisplay && (
          <span className={cn("shrink-0 text-xs font-medium", priorityClass)}>
            {priorityDisplay}
          </span>
        )}
        {execution?.workerThreadId && onOpenThread ? (
          <button
            type="button"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Open worker thread for ${child.id}`}
            onClick={handleOpenThread}
          >
            <ExternalLinkIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-11 text-[11px] text-muted-foreground">
        <span>{child.id}</span>
        {execution?.sequenceLabel ? <span>{execution.sequenceLabel}</span> : null}
        {execution?.failureMessage ? (
          <span className="min-w-0 truncate text-destructive">{execution.failureMessage}</span>
        ) : null}
      </div>
    </div>
  );
}

function BlockedScopePill({
  childStatus,
  execution,
}: {
  childStatus: BeadsIssueRelationSummary["status"];
  execution: EpicChildExecutionState | null;
}) {
  const scope = execution?.blockedScope ?? null;
  if (scope === null && childStatus !== "blocked") {
    return null;
  }

  const label =
    scope === "internal"
      ? "Internal block"
      : scope === "external"
        ? "External block"
        : scope === "unknown"
          ? "Dependency error"
          : "Blocked";
  const description =
    scope === "internal"
      ? "Blocked by another child in this epic."
      : scope === "external"
        ? "Blocked by work outside this epic. Resolve before starting the epic."
        : scope === "unknown"
          ? "Dependency metadata is incomplete. Fix the tracker dependency before starting the epic."
          : "Blocked by an open dependency.";

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
            scope === "internal"
              ? "border-warning/25 bg-warning/10 text-warning-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-72 leading-tight">
        {description}
      </TooltipPopup>
    </Tooltip>
  );
}

function ExecutionIndicator({ execution }: { execution: EpicChildExecutionState | null }) {
  if (execution?.isNext) {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center text-info-foreground"
        aria-label="Next to run"
      >
        <ArrowRightIcon className="size-3.5" />
      </span>
    );
  }

  if (execution?.kind === "active") {
    return (
      <span
        className="inline-flex size-4 shrink-0 items-center justify-center text-info-foreground"
        aria-label={execution.label}
      >
        <Loader2Icon className="size-3 animate-spin" />
      </span>
    );
  }

  return <span className="size-4 shrink-0" aria-hidden="true" />;
}

function executionPillClassName(kind: EpicChildExecutionState["kind"]) {
  switch (kind) {
    case "next":
    case "ready":
    case "active":
      return "border-info/25 bg-info/10 text-info-foreground";
    case "blocked":
    case "stopped":
    case "waiting":
      return "border-warning/25 bg-warning/10 text-warning-foreground";
    case "failed":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "completed":
      return "border-success/25 bg-success/10 text-success-foreground";
    case "unknown":
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function ExecutionPill({ execution }: { execution: EpicChildExecutionState }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        executionPillClassName(execution.kind),
      )}
    >
      {execution.label}
    </span>
  );
}
