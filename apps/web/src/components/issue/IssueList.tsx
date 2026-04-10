import type { BeadsIssueSortBy, BeadsIssueSummary } from "@t3tools/contracts";
import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Checkbox } from "../ui/checkbox";
import { filterAndSortIssues } from "~/lib/issuePanelLogic";
import { isIssueDoneStatus } from "~/lib/issueConstants";
import {
  buildIssueTree,
  buildIssueTreeNodeLookup,
  collectIssueTreeBranchIds,
  countIssueTreeDescendantStatuses,
  flattenVisibleIssueTree,
  type IssueTreeDescendantStatusCounts,
  type IssueTreeNode,
} from "~/lib/issueTree";
import { cn } from "~/lib/utils";
import { showContextMenuFallback } from "~/contextMenuFallback";
import { IssueCard, IssueTypeIcon } from "./IssueCard";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueListProps {
  issues: readonly BeadsIssueSummary[];
  className?: string | undefined;
  selectedIssueId?: string | null | undefined;
  searchValue?: string | undefined;
  showClosed?: boolean | undefined;
  sortBy?: BeadsIssueSortBy | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onSearchChange?: ((search: string) => void) | undefined;
  onShowClosedChange?: ((showClosed: boolean) => void) | undefined;
  onSortByChange?: ((sortBy: BeadsIssueSortBy) => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
  onIssueContextAction?: ((issueId: string, action: IssueContextAction) => void) | undefined;
  loading?: boolean | undefined;
  emptyMessage?: string | undefined;
  actions?: ReactNode | undefined;
  enableKeyboardNavigation?: boolean | undefined;
  searchDebounceMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// Context menu action types
// ---------------------------------------------------------------------------

export type IssueContextAction =
  | "implement"
  | "refine"
  | "quick_refine"
  | "planned_refine"
  | "copy_id"
  | "copy_title"
  | "open_in_tracker"
  | "mark_closed";

export function buildIssueContextMenuItems(issue: BeadsIssueSummary): Array<{
  id: IssueContextAction;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
}> {
  const isEpic = issue.issueType?.toLowerCase() === "epic";
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

// ---------------------------------------------------------------------------
// IssueList
// ---------------------------------------------------------------------------

/**
 * IssueList — Merged design: old-style density + new-style component structure.
 *
 * Key design decisions:
 * - Epic-linked issues grouped under collapsible headers, visually distinct
 * - Free-floating issues rendered in a separate section below
 * - Keyboard navigation preserved from new design
 * - Minimal chrome: no shadows, no scale transforms, thin borders
 */
export function IssueList({
  issues,
  className,
  selectedIssueId,
  searchValue = "",
  showClosed = false,
  sortBy = "updated",
  onIssueSelect,
  onSearchChange,
  onShowClosedChange,
  onSortByChange,
  onLabelClick,
  onIssueContextAction,
  loading = false,
  emptyMessage = "No issues found",
  actions,
  enableKeyboardNavigation = true,
}: IssueListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIssueIndex, setFocusedIssueIndex] = useState(-1);
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});

  const filteredResult = useMemo(() => {
    return filterAndSortIssues(issues, {
      searchQuery: searchValue,
      showClosed,
      sortBy,
    });
  }, [issues, searchValue, showClosed, sortBy]);
  const filteredIssues = filteredResult.issues;
  const issueTree = filteredResult.issueTree;
  const fullIssueTree = useMemo(() => buildIssueTree(issues), [issues]);
  const fullTreeNodesById = useMemo(
    () => buildIssueTreeNodeLookup(fullIssueTree.roots),
    [fullIssueTree.roots],
  );

  const branchIds = useMemo(() => collectIssueTreeBranchIds(issueTree.roots), [issueTree.roots]);

  useEffect(() => {
    setCollapsedById((previous) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      for (const branchId of branchIds) {
        next[branchId] = previous[branchId] ?? true;
        if (previous[branchId] === undefined) {
          changed = true;
        }
      }

      if (!changed) {
        const previousKeys = Object.keys(previous);
        changed = previousKeys.length !== branchIds.length;
      }

      return changed ? next : previous;
    });
  }, [branchIds]);

  const visibleRows = useMemo(
    () => flattenVisibleIssueTree(issueTree.roots, collapsedById),
    [collapsedById, issueTree.roots],
  );

  const focusedIssueId =
    focusedIssueIndex >= 0 ? (visibleRows[focusedIssueIndex]?.issue.id ?? null) : null;

  useEffect(() => {
    if (focusedIssueIndex < visibleRows.length) {
      return;
    }

    setFocusedIssueIndex(visibleRows.length === 0 ? -1 : visibleRows.length - 1);
  }, [focusedIssueIndex, visibleRows.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation || visibleRows.length === 0) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setFocusedIssueIndex((prev) => (prev <= 0 ? visibleRows.length - 1 : prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setFocusedIssueIndex((prev) => (prev >= visibleRows.length - 1 ? 0 : prev + 1));
          break;
        case "Enter":
          event.preventDefault();
          if (focusedIssueIndex >= 0 && visibleRows[focusedIssueIndex]) {
            onIssueSelect?.(visibleRows[focusedIssueIndex].issue.id);
          }
          break;
        case "Escape":
          event.preventDefault();
          setFocusedIssueIndex(-1);
          break;
      }
    },
    [enableKeyboardNavigation, focusedIssueIndex, onIssueSelect, visibleRows],
  );

  // Reset focus when filter changes — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: showClosed, sortBy, and searchValue are intentional triggers
  useEffect(() => {
    setFocusedIssueIndex(-1);
  }, [showClosed, sortBy, searchValue]);

  const handleIssueContextMenu = useCallback(
    (issue: BeadsIssueSummary, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      void showContextMenuFallback(buildIssueContextMenuItems(issue), {
        x: event.clientX,
        y: event.clientY,
      }).then((action) => {
        if (!action) return;

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

  const toggleBranch = useCallback((issueId: string) => {
    setCollapsedById((previous) => ({
      ...previous,
      [issueId]: !(previous[issueId] ?? true),
    }));
  }, []);

  if (loading) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <IssueListHeader
          searchValue={searchValue}
          showClosed={showClosed}
          sortBy={sortBy}
          onSearchChange={onSearchChange}
          onShowClosedChange={onShowClosedChange}
          onSortByChange={onSortByChange}
          actions={actions}
          totalCount={issues.length}
          loading
        />
        <div className="flex-1 p-4 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`skeleton-${String(i)}`}
              className="animate-pulse border-b border-border/30 px-4 py-2.5"
            >
              <div className="flex items-center gap-2">
                <div className="size-4 rounded bg-muted" />
                <div className="h-3.5 flex-1 rounded bg-muted" />
                <div className="h-3 w-10 rounded bg-muted" />
              </div>
              <div className="mt-1 flex gap-2 pl-6">
                <div className="h-3 w-12 rounded bg-muted" />
                <div className="h-3 w-16 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = issueTree.roots.length === 0;

  return (
    <div
      ref={containerRef}
      className={cn("flex flex-col h-full", className)}
      onKeyDown={handleKeyDown}
      tabIndex={enableKeyboardNavigation ? 0 : undefined}
      role="listbox"
      aria-label="Issues list"
    >
      <IssueListHeader
        searchValue={searchValue}
        showClosed={showClosed}
        sortBy={sortBy}
        onSearchChange={onSearchChange}
        onShowClosedChange={onShowClosedChange}
        onSortByChange={onSortByChange}
        actions={actions}
        totalCount={filteredIssues.length}
        originalCount={issues.length}
      />

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState
            message={emptyMessage}
            hasSearch={searchValue.trim().length > 0}
            showClosed={showClosed}
            hasClosedIssues={issues.some((issue) => issue.status === "closed")}
          />
        ) : (
          <div className="py-1">
            {issueTree.roots
              .filter((node) => node.isEpic)
              .map((node) => (
                <IssueTreeNodeSection
                  key={node.issue.id}
                  node={node}
                  collapsedById={collapsedById}
                  selectedIssueId={selectedIssueId ?? null}
                  focusedIssueId={focusedIssueId}
                  onToggleBranch={toggleBranch}
                  onIssueSelect={onIssueSelect}
                  onIssueContextMenu={handleIssueContextMenu}
                  onLabelClick={onLabelClick}
                  progressNodesById={fullTreeNodesById}
                />
              ))}
            {issueTree.roots.some((n) => n.isEpic) && issueTree.roots.some((n) => !n.isEpic) && (
              <SectionDivider label="Issues" />
            )}
            {issueTree.roots
              .filter((node) => !node.isEpic)
              .map((node) => (
                <IssueTreeNodeSection
                  key={node.issue.id}
                  node={node}
                  collapsedById={collapsedById}
                  selectedIssueId={selectedIssueId ?? null}
                  focusedIssueId={focusedIssueId}
                  onToggleBranch={toggleBranch}
                  onIssueSelect={onIssueSelect}
                  onIssueContextMenu={handleIssueContextMenu}
                  onLabelClick={onLabelClick}
                  progressNodesById={fullTreeNodesById}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header (search + filter + count)
// ---------------------------------------------------------------------------

function IssueListHeader({
  searchValue,
  showClosed,
  sortBy,
  onSearchChange,
  onShowClosedChange,
  onSortByChange,
  actions,
  totalCount,
  originalCount,
  loading = false,
}: {
  searchValue?: string | undefined;
  showClosed?: boolean | undefined;
  sortBy?: BeadsIssueSortBy | undefined;
  onSearchChange?: ((search: string) => void) | undefined;
  onShowClosedChange?: ((showClosed: boolean) => void) | undefined;
  onSortByChange?: ((sortBy: BeadsIssueSortBy) => void) | undefined;
  actions?: ReactNode | undefined;
  totalCount: number;
  originalCount?: number | undefined;
  loading?: boolean | undefined;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const countLabel = loading
    ? "Loading..."
    : originalCount !== undefined && originalCount !== totalCount
      ? `${totalCount} of ${originalCount}`
      : `${totalCount}`;

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-sm px-4 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchInputRef}
          placeholder="Search issues..."
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          className="h-7 text-xs"
          disabled={loading}
        />
        <label className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
          <Checkbox
            checked={showClosed}
            onCheckedChange={(checked) => onShowClosedChange?.(Boolean(checked))}
            disabled={loading}
          />
          <span>Show closed</span>
        </label>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange?.(value as BeadsIssueSortBy)}
          disabled={loading}
        >
          <SelectTrigger className="h-7 w-[9.5rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="created">Recently created</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectPopup>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{countLabel} issues</span>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue tree rendering
// ---------------------------------------------------------------------------

function IssueTreeNodeSection({
  node,
  collapsedById,
  selectedIssueId,
  focusedIssueId,
  onToggleBranch,
  onIssueSelect,
  onIssueContextMenu,
  onLabelClick,
  progressNodesById,
}: {
  node: IssueTreeNode;
  collapsedById: Readonly<Record<string, boolean>>;
  selectedIssueId: string | null;
  focusedIssueId: string | null;
  onToggleBranch: (issueId: string) => void;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextMenu?: ((issue: BeadsIssueSummary, event: React.MouseEvent) => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
  progressNodesById: ReadonlyMap<string, IssueTreeNode>;
}) {
  const collapsed = node.hasVisibleChildren ? (collapsedById[node.issue.id] ?? true) : false;
  const indentStyle =
    node.depth === 0 ? undefined : ({ paddingLeft: `${String(node.depth * 16)}px` } as const);
  const progressNode = progressNodesById.get(node.issue.id) ?? node;

  return (
    <div style={indentStyle}>
      {node.isEpic ? (
        <EpicTreeSection
          node={node}
          collapsed={collapsed}
          selected={selectedIssueId === node.issue.id}
          focused={focusedIssueId === node.issue.id}
          onToggle={() => onToggleBranch(node.issue.id)}
          onIssueSelect={onIssueSelect}
          onIssueContextMenu={onIssueContextMenu}
          progressNode={progressNode}
        >
          {!collapsed &&
            node.children.map((child) => (
              <IssueTreeNodeSection
                key={child.issue.id}
                node={child}
                collapsedById={collapsedById}
                selectedIssueId={selectedIssueId}
                focusedIssueId={focusedIssueId}
                onToggleBranch={onToggleBranch}
                onIssueSelect={onIssueSelect}
                onIssueContextMenu={onIssueContextMenu}
                onLabelClick={onLabelClick}
                progressNodesById={progressNodesById}
              />
            ))}
        </EpicTreeSection>
      ) : node.hasVisibleChildren ? (
        <>
          <BranchIssueRow
            node={node}
            collapsed={collapsed}
            selected={selectedIssueId === node.issue.id}
            focused={focusedIssueId === node.issue.id}
            onToggle={() => onToggleBranch(node.issue.id)}
            onIssueSelect={onIssueSelect}
            onIssueContextMenu={onIssueContextMenu}
            onLabelClick={onLabelClick}
          />
          {!collapsed &&
            node.children.map((child) => (
              <IssueTreeNodeSection
                key={child.issue.id}
                node={child}
                collapsedById={collapsedById}
                selectedIssueId={selectedIssueId}
                focusedIssueId={focusedIssueId}
                onToggleBranch={onToggleBranch}
                onIssueSelect={onIssueSelect}
                onIssueContextMenu={onIssueContextMenu}
                onLabelClick={onLabelClick}
                progressNodesById={progressNodesById}
              />
            ))}
        </>
      ) : (
        <IssueCard
          issue={node.issue}
          selected={selectedIssueId === node.issue.id}
          focused={focusedIssueId === node.issue.id}
          onClick={() => onIssueSelect?.(node.issue.id)}
          onContextMenu={(event) => onIssueContextMenu?.(node.issue, event)}
          onLabelClick={onLabelClick}
        />
      )}
    </div>
  );
}

function EpicTreeSection({
  node,
  collapsed,
  selected,
  focused,
  onToggle,
  onIssueSelect,
  onIssueContextMenu,
  progressNode,
  children,
}: {
  node: IssueTreeNode;
  collapsed: boolean;
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextMenu?: ((issue: BeadsIssueSummary, event: React.MouseEvent) => void) | undefined;
  progressNode: IssueTreeNode;
  children: ReactNode;
}) {
  const descendantStatusCounts = useMemo(
    () => countIssueTreeDescendantStatuses(progressNode),
    [progressNode],
  );
  const hasChildren = node.hasVisibleChildren;

  return (
    <div className="overflow-hidden rounded-md border border-border/40">
      <div
        className={cn(
          hasChildren && "border-b border-border/50",
          selected ? "bg-muted/50" : "bg-muted/10",
          focused && "ring-1 ring-ring ring-inset bg-muted/40",
        )}
      >
        <div className="flex items-stretch">
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              tabIndex={-1}
              aria-label={
                collapsed ? `Expand epic ${node.issue.id}` : `Collapse epic ${node.issue.id}`
              }
              className="flex shrink-0 items-center justify-center px-2.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRightIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
            </button>
          ) : (
            <div className="w-[34px] shrink-0" aria-hidden />
          )}
          <button
            type="button"
            onClick={() => onIssueSelect?.(node.issue.id)}
            onContextMenu={(event) => onIssueContextMenu?.(node.issue, event)}
            tabIndex={focused ? 0 : -1}
            aria-label={`Select epic ${node.issue.id}: ${node.issue.title}`}
            className="min-w-0 flex-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
          >
            <div className="flex items-center gap-2">
              <IssueTypeIcon issueType={node.issue.issueType} />
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-sm font-medium text-foreground",
                  isIssueDoneStatus(node.issue.status) && "line-through",
                )}
              >
                {node.issue.title}
              </p>
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-6">
              <EpicChildProgress counts={descendantStatusCounts} />
              <span className="text-[10px] text-muted-foreground">
                {descendantStatusCounts.closed}/{descendantStatusCounts.total} done
              </span>
              {descendantStatusCounts.inProgress > 0 && (
                <span className="text-[10px] text-warning-foreground">
                  {descendantStatusCounts.inProgress} active
                </span>
              )}
              {descendantStatusCounts.blocked > 0 && (
                <span className="text-[10px] text-destructive-foreground">
                  {descendantStatusCounts.blocked} blocked
                </span>
              )}
            </div>
          </button>
        </div>
      </div>
      {!collapsed && children}
    </div>
  );
}

function BranchIssueRow({
  node,
  collapsed,
  selected,
  focused,
  onToggle,
  onIssueSelect,
  onIssueContextMenu,
  onLabelClick,
}: {
  node: IssueTreeNode;
  collapsed: boolean;
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onIssueContextMenu?: ((issue: BeadsIssueSummary, event: React.MouseEvent) => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
}) {
  return (
    <div className="flex items-stretch border-border/50 border-b">
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        aria-label={collapsed ? `Expand issue ${node.issue.id}` : `Collapse issue ${node.issue.id}`}
        className={cn(
          "flex shrink-0 items-center justify-center px-2.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground",
          selected && "bg-muted/50",
          focused && "ring-1 ring-ring ring-inset bg-muted/40",
        )}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5" />
        ) : (
          <ChevronDownIcon className="size-3.5" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <IssueCard
          issue={node.issue}
          selected={selected}
          focused={focused}
          className="border-b-0"
          onClick={() => onIssueSelect?.(node.issue.id)}
          onContextMenu={(event) => onIssueContextMenu?.(node.issue, event)}
          onLabelClick={onLabelClick}
        />
      </div>
    </div>
  );
}

function EpicChildProgress({ counts }: { counts: IssueTreeDescendantStatusCounts }) {
  if (counts.total === 0) return null;
  const closedPct = (counts.closed / counts.total) * 100;
  const inProgressPct = (counts.inProgress / counts.total) * 100;
  const blockedPct = (counts.blocked / counts.total) * 100;

  return (
    <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
      {closedPct > 0 && <div className="bg-success" style={{ width: `${String(closedPct)}%` }} />}
      {inProgressPct > 0 && (
        <div className="bg-warning" style={{ width: `${String(inProgressPct)}%` }} />
      )}
      {blockedPct > 0 && (
        <div className="bg-destructive" style={{ width: `${String(blockedPct)}%` }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="h-px flex-1 bg-border/50" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  message,
  hasSearch,
  showClosed,
  hasClosedIssues,
}: {
  message: string;
  hasSearch: boolean;
  showClosed: boolean;
  hasClosedIssues: boolean;
}) {
  const detail = hasSearch
    ? !showClosed && hasClosedIssues
      ? "Try different search terms or enable Show closed."
      : "Try different search terms."
    : !showClosed && hasClosedIssues
      ? "Try enabling Show closed."
      : message;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 size-10 rounded-full border-2 border-dashed border-muted-foreground/20" />
      <p className="text-sm font-medium text-foreground/80">
        {hasSearch || (!showClosed && hasClosedIssues) ? "No matching issues" : "No issues found"}
      </p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
