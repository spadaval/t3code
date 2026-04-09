import type { BeadsIssueSummary, ProjectId, ThreadId } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PlusIcon } from "lucide-react";

import { beadsUpdateIssueMutationOptions } from "~/lib/beadsReactQuery";
import {
  ISSUE_STATUSES,
  formatStatusDisplay,
  type IssueStatusDef,
  type IssueStatusVariant,
} from "~/lib/issueConstants";
import { cn } from "~/lib/utils";
import { IssueTypeIcon } from "../issue/IssueCard";
import { CreateIssueDialog } from "../issue/CreateIssueDialog";
import { Button } from "../ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KanbanBoardProps {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly issues: readonly BeadsIssueSummary[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly selectedIssueId: string | null;
  readonly onSelectIssue: (issueId: string | null) => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}

// ---------------------------------------------------------------------------
// Board columns — we show only the "useful" statuses, not all 7
// ---------------------------------------------------------------------------

const BOARD_COLUMNS: readonly IssueStatusDef[] = ISSUE_STATUSES;

const STATUS_DOT_COLOR: Record<IssueStatusVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  error: "bg-destructive",
  secondary: "bg-muted-foreground",
  primary: "bg-foreground",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupIssuesByStatus(
  issues: readonly BeadsIssueSummary[],
): Map<string, BeadsIssueSummary[]> {
  const groups = new Map<string, BeadsIssueSummary[]>();
  for (const status of BOARD_COLUMNS) {
    groups.set(status.value, []);
  }
  for (const issue of issues) {
    const bucket = groups.get(issue.status);
    if (bucket) {
      bucket.push(issue);
    } else {
      // Unknown status — put into a catch-all or first bucket
      const openBucket = groups.get("open");
      if (openBucket) {
        openBucket.push(issue);
      }
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// KanbanBoard
// ---------------------------------------------------------------------------

export function KanbanBoard({
  cwd,
  projectId: _projectId,
  issues,
  loading,
  error,
  selectedIssueId,
  onSelectIssue,
  onOpenThread: _onOpenThread,
}: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const updateMutation = useMutation(beadsUpdateIssueMutationOptions({ queryClient }));

  const [activeId, setActiveId] = useState<string | null>(null);
  // Track which column an issue has been dragged over (for optimistic column placement)
  const [overColumn, setOverColumn] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columnData = useMemo(() => groupIssuesByStatus(issues), [issues]);

  const activeIssue = useMemo(
    () => (activeId ? (issues.find((i) => i.id === activeId) ?? null) : null),
    [activeId, issues],
  );

  // --- Drag handlers ---

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over) {
        setOverColumn(null);
        return;
      }
      // `over` can be either a column droppable or a card sortable.
      // Column droppable ids are status values; card ids are issue ids.
      const overId = String(over.id);
      // Check if it's a column id
      if (BOARD_COLUMNS.some((col) => col.value === overId)) {
        setOverColumn(overId);
      } else {
        // It's a card — find which column it belongs to
        for (const [status, columnIssues] of columnData) {
          if (columnIssues.some((i) => i.id === overId)) {
            setOverColumn(status);
            break;
          }
        }
      }
    },
    [columnData],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverColumn(null);

      if (!over) return;

      const issueId = String(active.id);
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) return;

      // Determine target status
      let targetStatus: string | null = null;
      const overId = String(over.id);

      if (BOARD_COLUMNS.some((col) => col.value === overId)) {
        targetStatus = overId;
      } else {
        // Over a card — find its column
        for (const [status, columnIssues] of columnData) {
          if (columnIssues.some((i) => i.id === overId)) {
            targetStatus = status;
            break;
          }
        }
      }

      if (!targetStatus || targetStatus === issue.status) return;

      // Fire the update mutation
      updateMutation.mutate({
        cwd,
        issueId: issue.id,
        status: targetStatus,
      });
    },
    [issues, columnData, cwd, updateMutation],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverColumn(null);
  }, []);

  // --- Loading / error states ---

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-destructive">{error.message || "Failed to load issues."}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {BOARD_COLUMNS.map((col) => (
          <div
            key={col.value}
            className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/20"
          >
            <div className="border-b border-border/50 px-3 py-2">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="flex-1 space-y-2 p-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={`skel-${col.value}-${String(i)}`}
                  className="h-16 animate-pulse rounded-md bg-muted/50"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {BOARD_COLUMNS.map((col) => {
          const columnIssues = columnData.get(col.value) ?? [];
          return (
            <KanbanColumn
              key={col.value}
              statusDef={col}
              issues={columnIssues}
              cwd={cwd}
              selectedIssueId={selectedIssueId}
              onSelectIssue={onSelectIssue}
              isDropTarget={overColumn === col.value && activeId !== null}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeIssue ? <KanbanCardOverlay issue={activeIssue} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  statusDef,
  issues,
  cwd,
  selectedIssueId,
  onSelectIssue,
  isDropTarget,
}: {
  statusDef: IssueStatusDef;
  issues: readonly BeadsIssueSummary[];
  cwd: string;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string | null) => void;
  isDropTarget: boolean;
}) {
  // The column itself is a droppable (using SortableContext's container)
  const { setNodeRef } = useSortable({
    id: statusDef.value,
    data: { type: "column", status: statusDef.value },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/20 transition-colors",
        isDropTarget && "border-ring/50 bg-ring/5",
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            className={cn("size-1.5 rounded-full shrink-0", STATUS_DOT_COLOR[statusDef.variant])}
          />
          <span className="text-xs font-medium text-foreground">
            {formatStatusDisplay(statusDef.value)}
          </span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
            {issues.length}
          </span>
        </div>
        <CreateIssueDialog
          cwd={cwd}
          defaultStatus={statusDef.value}
          onCreated={(issueId) => onSelectIssue(issueId)}
          trigger={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Create issue in ${statusDef.label}`}
            >
              <PlusIcon className="size-3" />
            </Button>
          }
        />
      </div>

      {/* Column body */}
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {issues.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground/60">
              No issues
            </div>
          ) : (
            issues.map((issue) => (
              <SortableKanbanCard
                key={issue.id}
                issue={issue}
                selected={selectedIssueId === issue.id}
                onClick={() => onSelectIssue(issue.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable Card (draggable)
// ---------------------------------------------------------------------------

function SortableKanbanCard({
  issue,
  selected,
  onClick,
}: {
  issue: BeadsIssueSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { type: "card", issue },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full cursor-grab rounded-md border border-border/50 bg-background px-3 py-2 text-left shadow-xs/5 transition-colors",
        "hover:border-border hover:bg-muted/20",
        selected && "border-ring/50 bg-muted/30",
        isDragging && "opacity-30",
      )}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        <IssueTypeIcon issueType={issue.issueType} className="mt-0.5 size-3.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{issue.title}</p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>{issue.id}</span>
            {issue.priority !== null && (
              <>
                <span className="opacity-40">&middot;</span>
                <span>P{issue.priority}</span>
              </>
            )}
            {issue.assignee && (
              <>
                <span className="opacity-40">&middot;</span>
                <span className="truncate">{issue.assignee}</span>
              </>
            )}
          </div>
          {issue.labels.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {issue.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="rounded bg-muted px-1 py-0.5 text-[9px] leading-none text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {issue.labels.length > 3 && (
                <span className="text-[9px] text-muted-foreground/60">
                  +{issue.labels.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Drag Overlay card (follows cursor)
// ---------------------------------------------------------------------------

function KanbanCardOverlay({ issue }: { issue: BeadsIssueSummary }) {
  return (
    <div className="w-60 cursor-grabbing rounded-md border border-ring/50 bg-background px-3 py-2 shadow-lg">
      <div className="flex items-start gap-1.5">
        <IssueTypeIcon issueType={issue.issueType} className="mt-0.5 size-3.5" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{issue.title}</p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>{issue.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
