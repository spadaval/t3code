import type { BeadsIssueSummary } from "@t3tools/contracts";
import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { IssueCard, EpicIssueCard } from "./IssueCard";
import { StatusIndicator } from "../shared/StatusIndicator";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

// Hook for debounced search
function useDebounced<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

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

interface CollapsibleEpicSectionProps {
  epic: EpicGroup;
  selectedIssueId?: string | null | undefined;
  focusedIssueId?: string | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  onLabelClick?: ((label: string) => void) | undefined;
}

/**
 * IssueList - Enhanced issue list with keyboard navigation and performance optimizations
 *
 * Features:
 * - Debounced search input (300ms default)
 * - Keyboard navigation (up/down arrows, enter to select)
 * - Loading skeleton states
 * - Empty state messaging
 * - Focus management for accessibility
 * - Performance optimized with proper memoization
 *
 * @example
 * <IssueList
 *   issues={issues}
 *   selectedIssueId={selectedId}
 *   onIssueSelect={setSelectedId}
 *   onLabelClick={handleLabelFilter}
 *   searchValue={search}
 *   onSearchChange={setSearch}
 *   enableKeyboardNavigation
 *   searchDebounceMs={300}
 * />
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
  searchDebounceMs = 300,
}: IssueListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIssueIndex, setFocusedIssueIndex] = useState(-1);
  const [internalSearchValue, setInternalSearchValue] = useState(searchValue);

  // Debounced search to avoid excessive filtering
  const debouncedSearchValue = useDebounced(internalSearchValue, searchDebounceMs);

  // Sync debounced value with external search changes
  useEffect(() => {
    if (searchValue !== internalSearchValue) {
      setInternalSearchValue(searchValue);
    }
  }, [searchValue, internalSearchValue]);

  // Notify parent of search changes after debounce
  useEffect(() => {
    if (debouncedSearchValue !== searchValue) {
      onSearchChange?.(debouncedSearchValue);
    }
  }, [debouncedSearchValue, searchValue, onSearchChange]);

  const filteredIssues = useMemo(() => {
    let filtered = issues;

    // Apply scope filter
    if (scopeFilter === "active") {
      filtered = filtered.filter((issue) =>
        ["open", "in_progress", "blocked"].includes(issue.status),
      );
    } else if (scopeFilter === "closed") {
      filtered = filtered.filter((issue) => issue.status === "closed");
    }

    // Apply search filter with debounced value
    if (debouncedSearchValue.trim()) {
      const searchLower = debouncedSearchValue.toLowerCase().trim();
      filtered = filtered.filter(
        (issue) =>
          issue.title.toLowerCase().includes(searchLower) ||
          issue.description?.toLowerCase().includes(searchLower) ||
          issue.labels.some((label) => label.toLowerCase().includes(searchLower)),
      );
    }

    return filtered;
  }, [issues, debouncedSearchValue, scopeFilter]);

  const epicGroups = useMemo(() => {
    return groupIssuesByEpic(filteredIssues);
  }, [filteredIssues]);

  // Flatten epic groups for keyboard navigation
  const flatIssues = useMemo(() => {
    return epicGroups.flatMap((epic) =>
      epic.epicId && epic.epicIssue ? [epic.epicIssue, ...epic.issues] : epic.issues,
    );
  }, [epicGroups]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enableKeyboardNavigation || flatIssues.length === 0) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setFocusedIssueIndex((prev) => {
            const newIndex = prev <= 0 ? flatIssues.length - 1 : prev - 1;
            return newIndex;
          });
          break;
        case "ArrowDown":
          event.preventDefault();
          setFocusedIssueIndex((prev) => {
            const newIndex = prev >= flatIssues.length - 1 ? 0 : prev + 1;
            return newIndex;
          });
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

  // Handle search input changes
  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInternalSearchValue(e.target.value);
  }, []);

  // Reset focus when filtering changes
  useEffect(() => {
    setFocusedIssueIndex(-1);
  }, [debouncedSearchValue, scopeFilter]);

  if (loading) {
    return (
      <div className={cn("space-y-2", className)}>
        <IssueListHeader
          searchValue={internalSearchValue}
          scopeFilter={scopeFilter}
          onSearchChange={handleSearchInputChange}
          onScopeChange={onScopeChange}
          actions={actions}
          totalCount={issues.length}
          loading={loading}
        />
        <div className="space-y-2 p-4">
          {/* Skeleton loading states */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-16 bg-muted/50 rounded border border-border/30">
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-3 bg-muted rounded" />
                    <div className="w-8 h-3 bg-muted rounded" />
                    <div className="w-16 h-3 bg-muted rounded" />
                  </div>
                  <div className="w-3/4 h-4 bg-muted rounded" />
                  <div className="flex gap-2">
                    <div className="w-12 h-2 bg-muted rounded" />
                    <div className="w-16 h-2 bg-muted rounded" />
                    <div className="w-20 h-2 bg-muted rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
        searchValue={internalSearchValue}
        scopeFilter={scopeFilter}
        onSearchChange={handleSearchInputChange}
        onScopeChange={onScopeChange}
        actions={actions}
        totalCount={filteredIssues.length}
        originalCount={issues.length}
        loading={loading}
        isSearching={internalSearchValue !== debouncedSearchValue}
      />

      <div className="flex-1 overflow-y-auto">
        {epicGroups.length === 0 ? (
          <EmptyState
            message={emptyMessage}
            hasSearch={debouncedSearchValue.trim().length > 0}
            hasFilter={scopeFilter !== "all"}
          />
        ) : (
          <div className="space-y-1">
            {epicGroups.map((epic) => (
              <CollapsibleEpicSection
                key={epic.key}
                epic={epic}
                selectedIssueId={selectedIssueId}
                focusedIssueId={
                  enableKeyboardNavigation && focusedIssueIndex >= 0
                    ? flatIssues[focusedIssueIndex]?.id
                    : undefined
                }
                onIssueSelect={onIssueSelect}
                onLabelClick={onLabelClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IssueListHeader({
  searchValue,
  scopeFilter,
  onSearchChange,
  onScopeChange,
  actions,
  totalCount,
  originalCount,
  loading = false,
  isSearching = false,
}: {
  searchValue?: string | undefined;
  scopeFilter?: "active" | "all" | "closed" | undefined;
  onSearchChange?: ((e: React.ChangeEvent<HTMLInputElement>) => void) | undefined;
  onScopeChange?: ((scope: "active" | "all" | "closed") => void) | undefined;
  actions?: ReactNode | undefined;
  totalCount: number;
  originalCount?: number | undefined;
  loading?: boolean | undefined;
  isSearching?: boolean | undefined;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input with keyboard shortcut
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

  const countDisplay = useMemo(() => {
    if (loading) return "Loading...";
    if (isSearching) return "Searching...";
    if (originalCount !== undefined && originalCount !== totalCount) {
      return `${totalCount} of ${originalCount} issues`;
    }
    return `${totalCount} issue${totalCount !== 1 ? "s" : ""}`;
  }, [loading, isSearching, totalCount, originalCount]);

  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-sm p-3 space-y-3">
      {/* Search and Filter Row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            ref={searchInputRef}
            placeholder="Search issues... (Ctrl+F)"
            value={searchValue}
            onChange={onSearchChange}
            className={cn("pr-8", isSearching && "border-primary/50 ring-1 ring-primary/20")}
            disabled={loading}
          />
          {isSearching && (
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
              <span className="size-3 border border-current border-t-transparent rounded-full animate-spin opacity-50" />
            </div>
          )}
        </div>

        <Select
          value={scopeFilter}
          onValueChange={(value) => onScopeChange?.(value as "active" | "all" | "closed")}
          disabled={loading}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectPopup>
        </Select>
      </div>

      {/* Actions and Count Row */}
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "text-sm transition-colors",
            loading || isSearching ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {countDisplay}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function CollapsibleEpicSection({
  epic,
  selectedIssueId,
  focusedIssueId,
  onIssueSelect,
  onLabelClick,
}: CollapsibleEpicSectionProps & { focusedIssueId?: string | undefined }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleToggleCollapsed = useCallback(() => {
    setIsCollapsed(!isCollapsed);
  }, [isCollapsed]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleToggleCollapsed();
      }
    },
    [handleToggleCollapsed],
  );

  // If this is just a standalone issue (not an epic)
  if (!epic.epicId) {
    const issue = epic.issues[0]!;
    return (
      <IssueCard
        issue={issue}
        selected={selectedIssueId === issue.id}
        focused={focusedIssueId === issue.id}
        onClick={() => onIssueSelect?.(issue.id)}
        onLabelClick={onLabelClick}
      />
    );
  }

  const childIssues = epic.issues;
  const hasEpicIssue = epic.epicIssue !== null;

  return (
    <div>
      {/* Epic Header */}
      {hasEpicIssue && (
        <div className="bg-muted/30 border-l-2 border-l-primary/60 transition-colors hover:bg-muted/40">
          <div className="flex items-center gap-2 p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapsed}
              onKeyDown={handleKeyDown}
              className="h-auto p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={isCollapsed ? "Expand epic" : "Collapse epic"}
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-4" />
              ) : (
                <ChevronDownIcon className="size-4" />
              )}
            </Button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusIndicator variant={getStatusVariant(epic.epicIssue.status)} size="sm">
                  Epic
                </StatusIndicator>
                <span className="text-xs text-muted-foreground">#{epic.epicIssue.id}</span>
                <span className="text-xs text-muted-foreground">
                  {childIssues.length} issue{childIssues.length !== 1 ? "s" : ""}
                </span>
              </div>
              <h3 className="font-medium text-foreground truncate">{epic.epicTitle}</h3>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onIssueSelect?.(epic.epicId!)}
              className="text-xs hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View epic details"
            >
              View Epic
            </Button>
          </div>
        </div>
      )}

      {/* Child Issues */}
      {!isCollapsed && (
        <div>
          {childIssues.map((issue) => (
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

// Helper functions
function groupIssuesByEpic(issues: readonly BeadsIssueSummary[]): EpicGroup[] {
  const epicMap = new Map<string, EpicGroup>();
  const result: EpicGroup[] = [];

  for (const issue of issues) {
    // Check if this is an epic issue
    const isEpic = issue.issueType?.toLowerCase() === "epic";

    if (isEpic) {
      const existingGroup = epicMap.get(issue.id);
      if (existingGroup) {
        // Update existing group with epic issue details
        const updated = {
          ...existingGroup,
          epicTitle: issue.title,
          epicIssue: issue,
        };
        epicMap.set(issue.id, updated);
        const index = result.findIndex((g) => g.key === existingGroup.key);
        if (index >= 0) result[index] = updated;
      } else {
        // Create new epic group
        const epicGroup: EpicGroup = {
          key: `epic:${issue.id}`,
          epicId: issue.id,
          epicTitle: issue.title,
          epicIssue: issue,
          issues: [],
        };
        epicMap.set(issue.id, epicGroup);
        result.push(epicGroup);
      }
      continue;
    }

    // Handle child issues and standalone issues
    const parentEpicId = issue.parent?.id;

    if (parentEpicId) {
      // This is a child issue
      const existingGroup = epicMap.get(parentEpicId);
      if (existingGroup) {
        const updated = {
          ...existingGroup,
          issues: [...existingGroup.issues, issue],
        };
        epicMap.set(parentEpicId, updated);
        const index = result.findIndex((g) => g.key === existingGroup.key);
        if (index >= 0) result[index] = updated;
      } else {
        // Create placeholder epic group
        const epicGroup: EpicGroup = {
          key: `epic:${parentEpicId}`,
          epicId: parentEpicId,
          epicTitle: issue.parent?.title ?? `Epic ${parentEpicId}`,
          epicIssue: null,
          issues: [issue],
        };
        epicMap.set(parentEpicId, epicGroup);
        result.push(epicGroup);
      }
    } else {
      // Standalone issue
      result.push({
        key: `issue:${issue.id}`,
        epicId: null,
        epicTitle: null,
        epicIssue: null,
        issues: [issue],
      });
    }
  }

  return result;
}

// Enhanced empty state component
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
    <div className="p-12 text-center">
      <div className="mx-auto w-24 h-24 rounded-full bg-muted/20 flex items-center justify-center mb-4">
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-muted-foreground/30" />
      </div>

      <h3 className="text-lg font-medium text-foreground mb-2">
        {hasSearch || hasFilter ? "No matching issues" : "No issues found"}
      </h3>

      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        {hasSearch && hasFilter
          ? "Try adjusting your search terms or changing the filter."
          : hasSearch
            ? "Try adjusting your search terms."
            : hasFilter
              ? "Try changing the filter to view more issues."
              : message}
      </p>

      {(hasSearch || hasFilter) && (
        <div className="mt-4 text-xs text-muted-foreground space-y-1">
          <p>Tip: Use keywords from issue titles, descriptions, or labels</p>
          <p>Press Escape to clear focus and reset navigation</p>
        </div>
      )}
    </div>
  );
}

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
