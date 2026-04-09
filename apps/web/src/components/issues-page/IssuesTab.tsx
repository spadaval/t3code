import type {
  BeadsIssueDetail as BeadsIssueDetailType,
  BeadsIssueSummary,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  CircleDotIcon,
  GitBranchIcon,
  LinkIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  OctagonAlertIcon,
  SendIcon,
  XIcon,
  Clock3Icon,
} from "lucide-react";

import {
  beadsCommentIssueMutationOptions,
  beadsIssueDetailOptions,
  beadsUpdateIssueMutationOptions,
} from "~/lib/beadsReactQuery";
import { cn } from "~/lib/utils";
import {
  CORE_ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  getStatusVariant,
  getPriorityVariant,
  formatPriorityDisplay,
  getDependencyTypeDef,
  groupDependenciesByCategory,
} from "~/lib/issueConstants";
import { resolveDefaultModelSelection } from "~/lib/modelSelection";
import { listIssueLinkedThreads } from "~/issueThreads";
import { useStore } from "~/store";
import { useProjectById } from "~/storeSelectors";
import { formatShortTimestamp } from "~/timestampFormat";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { useSettings } from "~/hooks/useSettings";
import { IssueList, type IssueContextAction } from "../issue/IssueList";
import { CreateIssueDialog } from "../issue/CreateIssueDialog";
import { EditableTitle, EditableTextArea } from "../issue/EditableField";
import { IssueWorkflowActions, useIssueWorkflowLaunchers } from "../issue/IssueWorkflowActions";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { StatusIndicator } from "../shared/StatusIndicator";
import { toastManager } from "../ui/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssuesTabProps = {
  cwd: string;
  projectId: ProjectId;
  issues: readonly BeadsIssueSummary[];
  issuesPending: boolean;
  issuesError: Error | null;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string | null) => void;
  onOpenThread: (threadId: ThreadId) => void;
};

type IssuePaneScope = "active" | "all" | "closed";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IssuesTab(props: IssuesTabProps) {
  const [searchValue, setSearchValue] = useState("");
  const [scopeFilter, setScopeFilter] = useState<IssuePaneScope>("active");
  const queryClient = useQueryClient();
  const project = useProjectById(props.projectId);
  const closeIssueMutation = useMutation(beadsUpdateIssueMutationOptions({ queryClient }));
  const resolvedModelSelection = useMemo(
    () => resolveDefaultModelSelection(project?.defaultModelSelection ?? null),
    [project?.defaultModelSelection],
  );
  const workflowLaunchers = useIssueWorkflowLaunchers({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: resolvedModelSelection,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    onOpenThread: props.onOpenThread,
  });
  const handleIssueContextAction = useCallback(
    async (issueId: string, action: IssueContextAction) => {
      switch (action) {
        case "implement":
          await workflowLaunchers.startIssueWorkflow(issueId, "solve");
          return;
        case "refine":
          await workflowLaunchers.startIssueWorkflow(issueId, "refine");
          return;
        case "quick_refine":
          await workflowLaunchers.startEpicQuickRefine(issueId);
          return;
        case "planned_refine":
          await workflowLaunchers.startEpicPlannedRefine(issueId);
          return;
        case "open_in_tracker":
          props.onSelectIssue(issueId);
          return;
        case "mark_closed":
          try {
            await closeIssueMutation.mutateAsync({
              cwd: props.cwd,
              issueId,
              status: "closed",
            });
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Failed to close issue",
              description: error instanceof Error ? error.message : "An unknown error occurred.",
            });
          }
          return;
        case "copy_id":
        case "copy_title":
          return;
      }
    },
    [closeIssueMutation, props, workflowLaunchers],
  );

  if (props.issuesPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" variant="muted" label="Loading issues" />
          Loading issues...
        </div>
      </div>
    );
  }

  if (props.issuesError) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-destructive">{props.issuesError.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel: Issue list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-border">
        <IssueList
          issues={props.issues}
          selectedIssueId={props.selectedIssueId}
          searchValue={searchValue}
          scopeFilter={scopeFilter}
          onIssueSelect={(issueId) => props.onSelectIssue(issueId)}
          onSearchChange={setSearchValue}
          onScopeChange={setScopeFilter}
          onIssueContextAction={(issueId, action) => void handleIssueContextAction(issueId, action)}
          className="flex-1"
          actions={
            <CreateIssueDialog
              cwd={props.cwd}
              onCreated={(issueId) => props.onSelectIssue(issueId)}
            />
          }
        />
      </div>

      {/* Right panel: Issue detail */}
      <div className="flex min-w-0 flex-1 flex-col">
        {props.selectedIssueId ? (
          <IssueDetailPanel
            cwd={props.cwd}
            projectId={props.projectId}
            issueId={props.selectedIssueId}
            modelSelection={resolvedModelSelection}
            workflowLaunchers={workflowLaunchers}
            onSelectIssue={props.onSelectIssue}
            onOpenThread={props.onOpenThread}
            onClose={() => props.onSelectIssue(null)}
          />
        ) : (
          <EmptyDetailState issueCount={props.issues.length} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel (loads its own data)
// ---------------------------------------------------------------------------

function IssueDetailPanel({
  cwd,
  projectId,
  issueId,
  modelSelection,
  workflowLaunchers,
  onSelectIssue,
  onOpenThread,
  onClose,
}: {
  cwd: string;
  projectId: ProjectId;
  issueId: string;
  modelSelection: ReturnType<typeof resolveDefaultModelSelection>;
  workflowLaunchers: ReturnType<typeof useIssueWorkflowLaunchers>;
  onSelectIssue: (issueId: string | null) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const threads = useStore((store) => store.threads);

  const issueDetailQuery = useQuery(beadsIssueDetailOptions({ cwd, issueId }));
  const issue = issueDetailQuery.data ?? null;

  const linkedThreads = useMemo(
    () =>
      listIssueLinkedThreads({
        threads,
        projectId,
        issueId,
      }),
    [projectId, issueId, threads],
  );

  // Mutations
  const updateIssueMutation = useMutation(beadsUpdateIssueMutationOptions({ queryClient }));
  const commentIssueMutation = useMutation(beadsCommentIssueMutationOptions({ queryClient }));

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      try {
        await updateIssueMutation.mutateAsync({ cwd, issueId, status: newStatus });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to update status",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [cwd, issueId, updateIssueMutation],
  );

  const handleFieldUpdate = useCallback(
    async (fields: {
      title?: string;
      description?: string;
      notes?: string;
      priority?: number | null;
      assignee?: string | null;
      labels?: string[];
      claim?: boolean;
    }) => {
      try {
        // Map null priority to undefined for the API (omit rather than send null)
        const payload: Record<string, unknown> = { cwd, issueId };
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined) payload[key] = value;
        }
        await updateIssueMutation.mutateAsync(payload as any);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to update issue",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [cwd, issueId, updateIssueMutation],
  );

  const handleComment = useCallback(
    async (text: string) => {
      try {
        await commentIssueMutation.mutateAsync({ cwd, issueId, text });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to add comment",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [cwd, issueId, commentIssueMutation],
  );

  const openLinkedThread = useCallback(() => {
    const targetThreadId = linkedThreads[0]?.id;
    if (!targetThreadId) return;
    onOpenThread(targetThreadId);
  }, [linkedThreads, onOpenThread]);
  const openCoordinator = useCallback(
    (epicId: string) => {
      void navigate({
        to: "/projects/$projectId/issues",
        params: { projectId },
        search: (previous) => ({
          tab: "coordinator",
          epicId,
          ...(previous.issueId ? { issueId: previous.issueId } : {}),
        }),
      });
    },
    [navigate, projectId],
  );

  if (issueDetailQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoadingSpinner size="sm" variant="muted" label="Loading issue" />
          Loading issue...
        </div>
      </div>
    );
  }

  if (issueDetailQuery.error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-destructive">{issueDetailQuery.error.message}</p>
      </div>
    );
  }

  if (!issue) {
    return <EmptyDetailState issueCount={0} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Action toolbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
        <div className="flex items-center gap-2">
          {/* Status selector */}
          <Select
            value={issue.status}
            onValueChange={(value) => {
              if (value) void handleStatusChange(value);
            }}
            disabled={updateIssueMutation.isPending}
          >
            <SelectTrigger size="xs" className="w-auto min-w-[7rem] gap-2">
              <StatusIndicator variant={getStatusVariant(issue.status)} size="sm">
                <SelectValue />
              </StatusIndicator>
            </SelectTrigger>
            <SelectPopup>
              {CORE_ISSUE_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <span className="flex items-center gap-2">
                    <StatusIndicator variant={s.variant} size="sm">
                      {s.label}
                    </StatusIndicator>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>

          <IssueWorkflowActions
            issue={issue}
            cwd={cwd}
            projectId={projectId}
            modelSelection={modelSelection}
            runtimeMode={DEFAULT_RUNTIME_MODE}
            linkedThreadCount={linkedThreads.length}
            linkedThreadLabel="Open thread"
            launchers={workflowLaunchers}
            onOpenLinkedThread={openLinkedThread}
            onOpenInTracker={() => onSelectIssue(issue.id)}
            onOpenThread={onOpenThread}
            onOpenCoordinator={openCoordinator}
          />
        </div>

        {/* Close detail */}
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close detail">
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Detail content — 1.5 column layout (main + metadata sidebar) */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 px-6 py-5">
          {/* Main content column */}
          <div className="min-w-0 flex-1">
            {/* Editable title */}
            <EditableTitle
              value={issue.title}
              onSave={(title) => void handleFieldUpdate({ title })}
              saving={updateIssueMutation.isPending}
            />

            {/* Editable description */}
            <div className="mt-5">
              <EditableTextArea
                value={issue.description ?? ""}
                onSave={(description) => void handleFieldUpdate({ description })}
                saving={updateIssueMutation.isPending}
                label="Description"
              />
            </div>

            {/* Editable notes */}
            <div className="mt-5">
              <EditableTextArea
                value={issue.notes ?? ""}
                onSave={(notes) => void handleFieldUpdate({ notes })}
                saving={updateIssueMutation.isPending}
                label="Notes"
                minHeight="min-h-[4rem]"
              />
            </div>

            {/* Dependencies */}
            {issue.dependencies.length > 0 && (
              <DependenciesSection
                dependencies={issue.dependencies}
                onDependencyClick={(depId) => onSelectIssue(depId)}
              />
            )}

            {/* Comments */}
            {issue.comments.length > 0 && <CommentsSection comments={issue.comments} />}

            {/* History */}
            {issue.history.length > 0 && <HistorySection history={issue.history} />}

            {/* Comment input */}
            <div className="mt-6 border-t border-border pt-5">
              <CommentInput onSubmit={handleComment} isPending={commentIssueMutation.isPending} />
            </div>
          </div>

          {/* Metadata sidebar */}
          <aside className="w-56 shrink-0 space-y-5">
            {/* ID & Type */}
            <MetadataField label="ID">
              <span className="font-mono text-sm text-foreground">#{issue.id}</span>
            </MetadataField>

            <MetadataField label="Type">
              <span className="text-sm capitalize text-foreground">{issue.issueType}</span>
            </MetadataField>

            {/* Priority */}
            <MetadataField label="Priority">
              <Select
                value={issue.priority !== null ? String(issue.priority) : "none"}
                onValueChange={(value) => {
                  if (!value || value === "none") return;
                  void handleFieldUpdate({ priority: Number.parseInt(value, 10) });
                }}
                disabled={updateIssueMutation.isPending}
              >
                <SelectTrigger
                  size="xs"
                  variant="ghost"
                  className="h-auto w-auto min-w-0 gap-1 px-1 py-0 text-sm -ml-1"
                >
                  <StatusIndicator
                    variant={getPriorityVariant(issue.priority)}
                    size="sm"
                    showDot={false}
                  >
                    <SelectValue>{formatPriorityDisplay(issue.priority) ?? "None"}</SelectValue>
                  </StatusIndicator>
                </SelectTrigger>
                <SelectPopup>
                  {ISSUE_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={String(p.value)}>
                      <StatusIndicator variant={p.variant} size="sm" showDot={false}>
                        {p.label}
                      </StatusIndicator>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </MetadataField>

            {/* Owner */}
            {issue.owner && (
              <MetadataField label="Owner">
                <span className="text-sm text-foreground">{issue.owner}</span>
              </MetadataField>
            )}

            {/* Assignee */}
            <MetadataField label="Assignee">
              <AssigneeEditor
                value={issue.assignee}
                onSave={(assignee) => void handleFieldUpdate({ assignee })}
                onClaim={() => void handleFieldUpdate({ claim: true })}
                saving={updateIssueMutation.isPending}
              />
            </MetadataField>

            {/* Labels */}
            <div className="border-t border-border/50 pt-4">
              <LabelEditor
                labels={[...issue.labels]}
                onSave={(labels) => void handleFieldUpdate({ labels })}
                saving={updateIssueMutation.isPending}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment input
// ---------------------------------------------------------------------------

function CommentInput({
  onSubmit,
  isPending,
}: {
  onSubmit: (text: string) => Promise<void>;
  isPending: boolean;
}) {
  const [text, setText] = useState("");

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    await onSubmit(trimmed);
    setText("");
  }, [text, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add comment
      </h3>
      <Textarea
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a comment... (Cmd+Enter to send)"
        className="min-h-[4rem] text-sm"
        disabled={isPending}
      />
      <div className="flex justify-end">
        <Button
          size="xs"
          onClick={() => void handleSubmit()}
          disabled={text.trim().length === 0 || isPending}
          className="gap-1.5"
        >
          {isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <SendIcon className="size-3" />
          )}
          Comment
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignee editor — inline text field with claim button
// ---------------------------------------------------------------------------

function AssigneeEditor({
  value,
  onSave,
  onClaim,
  saving,
}: {
  value: string | null;
  onSave: (assignee: string | null) => void;
  onClaim: () => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const handleStartEdit = useCallback(() => {
    setDraft(value ?? "");
    setEditing(true);
  }, [value]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    const newValue = trimmed.length > 0 ? trimmed : null;
    if (newValue !== value) {
      onSave(newValue);
    }
    setEditing(false);
  }, [draft, onSave, value]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(value ?? "");
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          autoFocus
          placeholder="Assignee..."
          className="h-5 w-24 px-1 text-xs"
          disabled={saving}
        />
      </span>
    );
  }

  if (value) {
    return (
      <button
        type="button"
        onClick={handleStartEdit}
        className="cursor-pointer hover:text-foreground transition-colors"
        disabled={saving}
      >
        Assigned: {value}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleStartEdit}
        className="cursor-pointer text-muted-foreground/60 hover:text-foreground transition-colors"
        disabled={saving}
      >
        Assign
      </button>
      <span className="opacity-30">·</span>
      <button
        type="button"
        onClick={onClaim}
        className="cursor-pointer text-muted-foreground/60 hover:text-foreground transition-colors"
        disabled={saving}
      >
        Claim
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Label editor — removable chips + inline add input
// ---------------------------------------------------------------------------

function LabelEditor({
  labels,
  onSave,
  saving,
}: {
  labels: string[];
  onSave: (labels: string[]) => void;
  saving: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleRemoveLabel = useCallback(
    (labelToRemove: string) => {
      onSave(labels.filter((l) => l !== labelToRemove));
    },
    [labels, onSave],
  );

  const handleAddLabel = useCallback(() => {
    const trimmed = newLabel.trim();
    if (trimmed.length === 0 || labels.includes(trimmed)) {
      setNewLabel("");
      return;
    }
    onSave([...labels, trimmed]);
    setNewLabel("");
  }, [newLabel, labels, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddLabel();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsAdding(false);
        setNewLabel("");
      }
    },
    [handleAddLabel],
  );

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Labels</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <span
            key={label}
            className="group/label inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {label}
            <button
              type="button"
              onClick={() => handleRemoveLabel(label)}
              disabled={saving}
              className="opacity-0 group-hover/label:opacity-100 transition-opacity hover:text-destructive-foreground"
              aria-label={`Remove label ${label}`}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}

        {isAdding ? (
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (newLabel.trim()) handleAddLabel();
              setIsAdding(false);
            }}
            autoFocus
            placeholder="Label..."
            className="h-5 w-20 px-1 text-xs"
            disabled={saving}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground/60 hover:text-foreground hover:border-border transition-colors"
            disabled={saving}
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata field for sidebar layout
// ---------------------------------------------------------------------------

function MetadataField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyDetailState({ issueCount }: { issueCount: number }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted/50">
          <CircleDotIcon className="size-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium text-foreground/80">
          {issueCount > 0 ? "Select an issue" : "No issues"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {issueCount > 0
            ? "Choose an issue from the list to view details and take action."
            : "No issues found in this project."}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependencies section
// ---------------------------------------------------------------------------

function DependenciesSection({
  dependencies,
  onDependencyClick,
}: {
  dependencies: BeadsIssueDetailType["dependencies"];
  onDependencyClick: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 3;
  const visible = expanded ? dependencies : dependencies.slice(0, PREVIEW_LIMIT);
  const hasHidden = dependencies.length > PREVIEW_LIMIT;
  const grouped = groupDependenciesByCategory(visible);
  const hasMultipleCategories =
    [grouped.parents.length > 0, grouped.blockers.length > 0, grouped.other.length > 0].filter(
      Boolean,
    ).length > 1;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Dependencies ({dependencies.length})
        </h3>
        {hasHidden && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
          >
            {expanded ? "Show less" : `Show ${dependencies.length - PREVIEW_LIMIT} more`}
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {grouped.parents.length > 0 && (
          <DepCategoryGroup
            label="Parent links"
            iconHint="hierarchy"
            colorClass="text-purple-500"
            showLabel={hasMultipleCategories}
            deps={grouped.parents}
            onDependencyClick={onDependencyClick}
          />
        )}
        {grouped.blockers.length > 0 && (
          <DepCategoryGroup
            label="Blocking / ordering"
            iconHint="block"
            colorClass="text-red-500"
            showLabel={hasMultipleCategories}
            deps={grouped.blockers}
            onDependencyClick={onDependencyClick}
          />
        )}
        {grouped.other.length > 0 && (
          <DepCategoryGroup
            label="Related"
            iconHint="link"
            colorClass="text-muted-foreground"
            showLabel={hasMultipleCategories}
            deps={grouped.other}
            onDependencyClick={onDependencyClick}
          />
        )}
      </div>
    </div>
  );
}

function DepTypeIcon({
  iconHint,
  className,
}: {
  iconHint: "hierarchy" | "block" | "link";
  className?: string;
}) {
  switch (iconHint) {
    case "hierarchy":
      return <GitBranchIcon className={cn("size-3", className)} />;
    case "block":
      return <OctagonAlertIcon className={cn("size-3", className)} />;
    default:
      return <LinkIcon className={cn("size-3", className)} />;
  }
}

function DepCategoryGroup({
  label,
  iconHint,
  colorClass,
  showLabel,
  deps,
  onDependencyClick,
}: {
  label: string;
  iconHint: "hierarchy" | "block" | "link";
  colorClass: string;
  showLabel: boolean;
  deps: BeadsIssueDetailType["dependencies"];
  onDependencyClick: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          <DepTypeIcon iconHint={iconHint} className={colorClass} />
          {label}
        </div>
      )}
      <div className="space-y-2">
        {deps.map((dep) => {
          const depTypeDef = getDependencyTypeDef(dep.dependencyType);
          return (
            <button
              key={`${dep.id}:${dep.dependencyType}`}
              type="button"
              onClick={() => onDependencyClick(dep.id)}
              className="w-full rounded-lg border border-border/50 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center gap-2 text-sm">
                <StatusIndicator variant={getStatusVariant(dep.status)} size="sm">
                  {dep.status.replace(/_/g, " ")}
                </StatusIndicator>
                <span className="font-medium text-foreground truncate">{dep.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">#{dep.id}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className={cn("flex items-center gap-1", depTypeDef.colorClass)}>
                  <DepTypeIcon iconHint={depTypeDef.iconHint} className={depTypeDef.colorClass} />
                  {depTypeDef.directionLabel}
                </span>
                {dep.description && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-muted-foreground line-clamp-1">{dep.description}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments section
// ---------------------------------------------------------------------------

function CommentsSection({ comments }: { comments: BeadsIssueDetailType["comments"] }) {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 3;
  const visible = expanded ? comments : comments.slice(0, PREVIEW_LIMIT);
  const hasHidden = comments.length > PREVIEW_LIMIT;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Comments ({comments.length})
        </h3>
        {hasHidden && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
          >
            {expanded ? "Show less" : `Show ${comments.length - PREVIEW_LIMIT} more`}
          </Button>
        )}
      </div>
      <div className="divide-y divide-border/30">
        {visible.map((comment) => (
          <div key={comment.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 mb-1.5">
              <MessageSquareTextIcon className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {comment.author || "Unknown"}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatShortTimestamp(comment.createdAt, settings.timestampFormat)}
              </span>
            </div>
            <div className="whitespace-pre-wrap pl-5 text-sm text-foreground">{comment.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------

function HistorySection({ history }: { history: BeadsIssueDetailType["history"] }) {
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LIMIT = 3;
  const visible = expanded ? history : history.slice(0, PREVIEW_LIMIT);
  const hasHidden = history.length > PREVIEW_LIMIT;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          History ({history.length})
        </h3>
        {hasHidden && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent"
          >
            {expanded ? "Show less" : `Show ${history.length - PREVIEW_LIMIT} more`}
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((entry, index) => {
          // Compare with the next (older) entry to derive what changed
          const olderEntry = index < history.length - 1 ? (history[index + 1] ?? null) : null;
          const changeDescription = deriveHistoryChangeDescription(entry, olderEntry);

          return (
            <div
              key={entry.commitHash}
              className="flex items-start gap-3 rounded border border-border/30 bg-muted/10 p-2"
            >
              <Clock3Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <code className="rounded bg-muted/50 px-1 font-mono text-[10px]">
                    {entry.commitHash.slice(0, 8)}
                  </code>
                  <span>{entry.committer || "Unknown"}</span>
                  <span className="opacity-60">·</span>
                  <span>{formatShortTimestamp(entry.commitDate, settings.timestampFormat)}</span>
                </div>
                <p className="text-sm text-foreground">{changeDescription}</p>
                {entry.status && (
                  <StatusIndicator variant={getStatusVariant(entry.status)} size="sm">
                    {entry.status.replace(/_/g, " ")}
                  </StatusIndicator>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Derive a human-readable description of what changed between two history entries.
 * Compares the current entry with the older entry to identify status, title changes.
 */
function deriveHistoryChangeDescription(
  entry: BeadsIssueDetailType["history"][0],
  olderEntry: BeadsIssueDetailType["history"][0] | null,
): string {
  const changes: string[] = [];

  if (olderEntry === null) {
    // This is the oldest entry — it's the creation event
    return `Created with status "${entry.status.replace(/_/g, " ")}"`;
  }

  if (entry.status !== olderEntry.status) {
    changes.push(
      `Status changed from "${olderEntry.status.replace(/_/g, " ")}" to "${entry.status.replace(/_/g, " ")}"`,
    );
  }

  if (entry.title !== olderEntry.title) {
    changes.push(`Title updated`);
  }

  if (changes.length === 0) {
    // Fields we can't see changed (description, priority, labels, etc.)
    return "Issue updated";
  }

  return changes.join(". ");
}
