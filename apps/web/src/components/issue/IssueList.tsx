import type { BeadsIssueSummary } from "@t3tools/contracts";
import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, ZapIcon } from "lucide-react";

import { filterIssuesForList } from "~/lib/issuePanelLogic";
import { cn } from "~/lib/utils";
import { IssueCard, EpicIssueCard, IssueTypeIcon } from "./IssueCard";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpicGroup {
  readonly key: string;
  readonly epicId: string | null;
  readonly epicTitle: string | null;
  readonly epicIssue: BeadsIssueSummary | null;
  readonly issues: readonly BeadsIssueSummary[];
}

export interface IssueListProps {
  issues: readonly BeadsIssueSummary[];
  className?: string | undefined;
  selectedIssueId?: string | null | undefined;
  searchValue?: string | undefined;
  scopeFilter?: "active" | "all" | "closed" | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onSearchChange?: ((search: string) => void) | undefined;
  onScopeChange?: ((scope: "active" | "all" | "closed") => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
  loading?: boolean | undefined;
  emptyMessage?: string | undefined;
  actions?: ReactNode | undefined;
  enableKeyboardNavigation?: boolean | undefined;
  searchDebounceMs?: number | undefined;
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
  scopeFilter = "active",
  onIssueSelect,
  onSearchChange,
  onScopeChange,
  onLabelClick,
  loading = false,
  emptyMessage = "No issues found",
  actions,
  enableKeyboardNavigation = true,
}: IssueListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIssueIndex, setFocusedIssueIndex] = useState(-1);

  const filteredIssues = useMemo(() => {
    return filterIssuesForList(issues, {
      searchQuery: searchValue,
      scopeFilter,
    });
  }, [issues, scopeFilter, searchValue]);

  const { epicGroups, freeIssues } = useMemo(() => {
    return partitionIssues(filteredIssues);
  }, [filteredIssues]);

  // Flatten for keyboard navigation
  const flatIssues = useMemo(() => {
    const fromEpics = epicGroups.flatMap((g) =>
      g.epicIssue ? [g.epicIssue, ...g.issues] : g.issues,
    );
    return [...fromEpics, ...freeIssues];
  }, [epicGroups, freeIssues]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation || flatIssues.length === 0) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setFocusedIssueIndex((prev) => (prev <= 0 ? flatIssues.length - 1 : prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setFocusedIssueIndex((prev) => (prev >= flatIssues.length - 1 ? 0 : prev + 1));
          break;
        case "Enter":
          event.preventDefault();
          if (focusedIssueIndex >= 0 && flatIssues[focusedIssueIndex]) {
            onIssueSelect?.(flatIssues[focusedIssueIndex].id);
          }
          break;
        case "Escape":
          event.preventDefault();
          setFocusedIssueIndex(-1);
          break;
      }
    },
    [enableKeyboardNavigation, flatIssues, focusedIssueIndex, onIssueSelect],
  );

  // Reset focus when filter changes — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeFilter and searchValue are intentional triggers
  useEffect(() => {
    setFocusedIssueIndex(-1);
  }, [scopeFilter, searchValue]);

  if (loading) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        <IssueListHeader
          searchValue={searchValue}
          scopeFilter={scopeFilter}
          onSearchChange={onSearchChange}
          onScopeChange={onScopeChange}
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

  const hasEpics = epicGroups.length > 0;
  const hasFree = freeIssues.length > 0;
  const isEmpty = !hasEpics && !hasFree;

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
        scopeFilter={scopeFilter}
        onSearchChange={onSearchChange}
        onScopeChange={onScopeChange}
        actions={actions}
        totalCount={filteredIssues.length}
        originalCount={issues.length}
      />

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <EmptyState
            message={emptyMessage}
            hasSearch={searchValue.trim().length > 0}
            hasFilter={scopeFilter !== "all"}
          />
        ) : (
          <>
            {/* ---- Epic-linked issues ---- */}
            {hasEpics && (
              <div>
                {epicGroups.map((group) => (
                  <EpicGroupSection
                    key={group.key}
                    group={group}
                    selectedIssueId={selectedIssueId ?? null}
                    focusedIssueId={
                      focusedIssueIndex >= 0 ? flatIssues[focusedIssueIndex]?.id : undefined
                    }
                    onIssueSelect={onIssueSelect}
                    onLabelClick={onLabelClick}
                  />
                ))}
              </div>
            )}

            {/* ---- Separator between grouped and free ---- */}
            {hasEpics && hasFree && (
              <div className="flex items-center gap-2 px-4 py-2">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                  Standalone
                </span>
                <div className="h-px flex-1 bg-border/60" />
              </div>
            )}

            {/* ---- Free-floating issues ---- */}
            {hasFree && (
              <div>
                {freeIssues.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    selected={selectedIssueId === issue.id}
                    focused={
                      focusedIssueIndex >= 0
                        ? flatIssues[focusedIssueIndex]?.id === issue.id
                        : false
                    }
                    onClick={() => onIssueSelect?.(issue.id)}
                    onLabelClick={onLabelClick}
                  />
                ))}
              </div>
            )}
          </>
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
  scopeFilter,
  onSearchChange,
  onScopeChange,
  actions,
  totalCount,
  originalCount,
  loading = false,
}: {
  searchValue?: string | undefined;
  scopeFilter?: "active" | "all" | "closed" | undefined;
  onSearchChange?: ((search: string) => void) | undefined;
  onScopeChange?: ((scope: "active" | "all" | "closed") => void) | undefined;
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
      <div className="flex items-center gap-2">
        <Input
          ref={searchInputRef}
          placeholder="Search issues..."
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          className="h-7 text-xs"
          disabled={loading}
        />
        <Select
          value={scopeFilter}
          onValueChange={(value) => onScopeChange?.(value as "active" | "all" | "closed")}
          disabled={loading}
        >
          <SelectTrigger className="w-24 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
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
// Epic group section (old-style collapsible group)
// ---------------------------------------------------------------------------

function EpicGroupSection({
  group,
  selectedIssueId,
  focusedIssueId,
  onIssueSelect,
  onLabelClick,
}: {
  group: EpicGroup;
  selectedIssueId: string | null;
  focusedIssueId?: string | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const epicIssue = group.epicIssue;
  const childCount = group.issues.length;

  return (
    <div className="overflow-hidden">
      {/* Epic header */}
      {epicIssue ? (
        <div
          className={cn(
            "flex items-stretch border-b border-border/50",
            selectedIssueId === epicIssue.id ? "bg-muted/50" : "bg-muted/10",
          )}
        >
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Expand epic" : "Collapse epic"}
            className="flex shrink-0 items-center justify-center px-2.5 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRightIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onIssueSelect?.(epicIssue.id)}
            aria-label={`Select epic ${epicIssue.id}: ${epicIssue.title}`}
            className="min-w-0 flex-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
          >
            <div className="flex items-center gap-2">
              <IssueTypeIcon issueType={epicIssue.issueType} />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {epicIssue.title}
              </p>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {childCount} issue{childCount !== 1 ? "s" : ""}
              </span>
            </div>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? "Expand epic group" : "Collapse epic group"}
          className="flex w-full items-center gap-1.5 bg-muted/20 px-4 py-1.5 text-left transition-colors hover:bg-muted/40"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <ZapIcon className="size-3.5 shrink-0 text-purple-500" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
            {group.epicTitle ?? group.epicId}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{childCount}</span>
        </button>
      )}

      {/* Child issues (indented) */}
      {!collapsed && childCount > 0 && (
        <div>
          {group.issues.map((issue) => (
            <EpicIssueCard
              key={issue.id}
              issue={issue}
              selected={selectedIssueId === issue.id}
              focused={focusedIssueId === issue.id}
              onClick={() => onIssueSelect?.(issue.id)}
              onLabelClick={onLabelClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partitioning logic: epic-linked vs free-floating
// ---------------------------------------------------------------------------

function partitionIssues(issues: readonly BeadsIssueSummary[]): {
  epicGroups: EpicGroup[];
  freeIssues: BeadsIssueSummary[];
} {
  const epicMap = new Map<string, EpicGroup>();
  const orderedEpics: EpicGroup[] = [];
  const freeIssues: BeadsIssueSummary[] = [];

  for (const issue of issues) {
    const isEpic = issue.issueType?.toLowerCase() === "epic";

    if (isEpic) {
      const existing = epicMap.get(issue.id);
      if (existing) {
        const updated: EpicGroup = {
          ...existing,
          epicTitle: issue.title,
          epicIssue: issue,
        };
        epicMap.set(issue.id, updated);
        const idx = orderedEpics.findIndex((g) => g.key === existing.key);
        if (idx >= 0) orderedEpics[idx] = updated;
      } else {
        const group: EpicGroup = {
          key: `epic:${issue.id}`,
          epicId: issue.id,
          epicTitle: issue.title,
          epicIssue: issue,
          issues: [],
        };
        epicMap.set(issue.id, group);
        orderedEpics.push(group);
      }
      continue;
    }

    const parentId = issue.parent?.id;
    if (parentId) {
      const existing = epicMap.get(parentId);
      if (existing) {
        const updated: EpicGroup = {
          ...existing,
          issues: [...existing.issues, issue],
        };
        epicMap.set(parentId, updated);
        const idx = orderedEpics.findIndex((g) => g.key === existing.key);
        if (idx >= 0) orderedEpics[idx] = updated;
      } else {
        const group: EpicGroup = {
          key: `epic:${parentId}`,
          epicId: parentId,
          epicTitle: issue.parent?.title ?? `Epic ${parentId}`,
          epicIssue: null,
          issues: [issue],
        };
        epicMap.set(parentId, group);
        orderedEpics.push(group);
      }
    } else {
      freeIssues.push(issue);
    }
  }

  return { epicGroups: orderedEpics, freeIssues };
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  message,
  hasSearch,
  hasFilter,
}: {
  message: string;
  hasSearch: boolean;
  hasFilter: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 size-10 rounded-full border-2 border-dashed border-muted-foreground/20" />
      <p className="text-sm font-medium text-foreground/80">
        {hasSearch || hasFilter ? "No matching issues" : "No issues found"}
      </p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        {hasSearch && hasFilter
          ? "Try adjusting your search or filter."
          : hasSearch
            ? "Try different search terms."
            : hasFilter
              ? "Try changing the scope filter."
              : message}
      </p>
    </div>
  );
}
