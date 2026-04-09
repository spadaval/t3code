import type {
  BeadsIssueDetail as BeadsIssueDetailType,
  BeadsIssueSummary,
  BeadsIssueWorkflowKind,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleDotIcon,
  Clock3Icon,
  Loader2Icon,
  MessageSquareTextIcon,
  PencilIcon,
  PlayIcon,
  SendIcon,
  XIcon,
} from "lucide-react";

import {
  beadsCommentIssueMutationOptions,
  beadsIssueDetailOptions,
  beadsStartWorkflowMutationOptions,
  beadsUpdateIssueMutationOptions,
} from "~/lib/beadsReactQuery";
import { resolveDefaultModelSelection } from "~/lib/modelSelection";
import { isEpicIssueType } from "~/issuePanel";
import { listIssueLinkedThreads } from "~/issueThreads";
import { useStore } from "~/store";
import { useProjectById } from "~/storeSelectors";
import { formatShortTimestamp } from "~/timestampFormat";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { useSettings } from "~/hooks/useSettings";
import { IssueList } from "../issue/IssueList";
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

const ISSUE_STATUSES = [
  { value: "open", label: "Open", variant: "info" as const },
  { value: "in_progress", label: "In Progress", variant: "warning" as const },
  { value: "blocked", label: "Blocked", variant: "error" as const },
  { value: "deferred", label: "Deferred", variant: "secondary" as const },
  { value: "closed", label: "Closed", variant: "success" as const },
] as const;

const WORKFLOW_OPTIONS: { value: BeadsIssueWorkflowKind; label: string; description: string }[] = [
  { value: "solve", label: "Solve", description: "Implement the issue" },
  { value: "refine", label: "Refine", description: "Break down and clarify" },
  { value: "continue", label: "Continue", description: "Resume prior work" },
  { value: "plan-implementation", label: "Plan", description: "Create implementation plan" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IssuesTab(props: IssuesTabProps) {
  const [searchValue, setSearchValue] = useState("");
  const [scopeFilter, setScopeFilter] = useState<IssuePaneScope>("active");

  if (props.issuesPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
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
          className="flex-1"
        />
      </div>

      {/* Right panel: Issue detail */}
      <div className="flex min-w-0 flex-1 flex-col">
        {props.selectedIssueId ? (
          <IssueDetailPanel
            cwd={props.cwd}
            projectId={props.projectId}
            issueId={props.selectedIssueId}
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
  onSelectIssue,
  onOpenThread,
  onClose,
}: {
  cwd: string;
  projectId: ProjectId;
  issueId: string;
  onSelectIssue: (issueId: string | null) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const project = useProjectById(projectId);
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
  const startWorkflowMutation = useMutation(beadsStartWorkflowMutationOptions({ queryClient }));

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
      priority?: number;
      assignee?: string | null;
      labels?: string[];
    }) => {
      try {
        await updateIssueMutation.mutateAsync({ cwd, issueId, ...fields });
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

  const handleStartWorkflow = useCallback(
    async (workflow: BeadsIssueWorkflowKind) => {
      if (!project) return;
      try {
        const result = await startWorkflowMutation.mutateAsync({
          cwd,
          projectId,
          issueId,
          workflow,
          modelSelection: resolveDefaultModelSelection(project.defaultModelSelection),
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        if (!result.created) {
          toastManager.add({
            type: "info",
            title: "Reused linked thread",
            description: "An existing linked thread was reused for this issue.",
          });
        }

        void navigate({
          to: "/$threadId",
          params: { threadId: result.threadId },
          search: () => ({}),
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to start work",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [cwd, issueId, navigate, project, projectId, startWorkflowMutation],
  );

  const openLinkedThread = useCallback(() => {
    const targetThreadId = linkedThreads[0]?.id;
    if (!targetThreadId) return;
    onOpenThread(targetThreadId);
  }, [linkedThreads, onOpenThread]);

  if (issueDetailQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
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

  const isEpic = isEpicIssueType(issue.issueType);

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
              {ISSUE_STATUSES.map((s) => (
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

          {/* Workflow dropdown */}
          {!isEpic && (
            <Select
              value=""
              onValueChange={(value) => {
                if (value) void handleStartWorkflow(value as BeadsIssueWorkflowKind);
              }}
              disabled={startWorkflowMutation.isPending}
            >
              <SelectTrigger size="xs" className="w-auto min-w-[6rem]">
                <span className="flex items-center gap-1.5">
                  {startWorkflowMutation.isPending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <PlayIcon className="size-3" />
                  )}
                  Start work
                </span>
              </SelectTrigger>
              <SelectPopup>
                {WORKFLOW_OPTIONS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    <span>
                      <span className="font-medium">{w.label}</span>
                      <span className="ml-2 text-muted-foreground">{w.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}

          {/* Open linked thread */}
          <Button
            size="xs"
            variant="outline"
            disabled={linkedThreads.length === 0}
            onClick={openLinkedThread}
            className="gap-1.5"
          >
            <ArrowUpRightIcon className="size-3" />
            {linkedThreads.length > 1 ? `Thread (${linkedThreads.length})` : "Open thread"}
          </Button>
        </div>

        {/* Close detail */}
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close detail">
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {/* Detail content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-5">
          {/* Editable title */}
          <EditableTitle
            value={issue.title}
            onSave={(title) => void handleFieldUpdate({ title })}
            saving={updateIssueMutation.isPending}
          />

          {/* Metadata row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="font-mono">#{issue.id}</span>
            <span className="capitalize">{issue.issueType}</span>
            {issue.priority !== null && <span>P{issue.priority}</span>}
            {issue.owner && <span>Owner: {issue.owner}</span>}
            {issue.assignee && <span>Assigned: {issue.assignee}</span>}
          </div>

          {/* Editable description */}
          <div className="mt-5">
            <EditableDescription
              value={issue.description ?? ""}
              onSave={(description) => void handleFieldUpdate({ description })}
              saving={updateIssueMutation.isPending}
            />
          </div>

          {/* Notes (read-only) */}
          {issue.notes?.trim() && (
            <div className="mt-5 space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </h3>
              <p className="whitespace-pre-wrap text-sm text-foreground">{issue.notes}</p>
            </div>
          )}

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable title
// ---------------------------------------------------------------------------

function EditableTitle({
  value,
  onSave,
  saving,
}: {
  value: string;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleStartEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }, [draft, onSave, value]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
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
      <div className="flex items-start gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          autoFocus
          className="text-xl font-semibold"
          disabled={saving}
        />
        <Button size="icon-sm" variant="ghost" onClick={handleSave} disabled={saving}>
          <CheckIcon className="size-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={handleCancel}>
          <XIcon className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <button
        type="button"
        className="flex-1 cursor-pointer text-left text-xl font-semibold text-foreground leading-tight hover:text-foreground/80"
        onClick={handleStartEdit}
      >
        {value}
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={handleStartEdit}
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Edit title"
      >
        <PencilIcon className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable description
// ---------------------------------------------------------------------------

function EditableDescription({
  value,
  onSave,
  saving,
}: {
  value: string;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleStartEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const handleSave = useCallback(() => {
    if (draft !== value) {
      onSave(draft);
    }
    setEditing(false);
  }, [draft, onSave, value]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
  }, [value]);

  if (editing) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Description
        </h3>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          autoFocus
          className="min-h-[6rem] text-sm"
          disabled={saving}
        />
        <div className="flex gap-2">
          <Button size="xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2Icon className="mr-1 size-3 animate-spin" /> : null}
            Save
          </Button>
          <Button size="xs" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Description
        </h3>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleStartEdit}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Edit description"
        >
          <PencilIcon className="size-3" />
        </Button>
      </div>
      {value.trim() ? (
        <button
          type="button"
          className="w-full cursor-pointer whitespace-pre-wrap text-left text-sm text-foreground hover:bg-muted/30 rounded-md p-1 -m-1 transition-colors"
          onClick={handleStartEdit}
        >
          {value}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStartEdit}
          className="text-sm text-muted-foreground italic hover:text-foreground transition-colors"
        >
          Add a description...
        </button>
      )}
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
// Helpers
// ---------------------------------------------------------------------------

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
      <div className="space-y-2">
        {visible.map((dep) => (
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
            {dep.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{dep.description}</p>
            )}
          </button>
        ))}
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
        {visible.map((entry) => (
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
              <p className="text-sm text-foreground">{entry.title}</p>
              {entry.status && (
                <StatusIndicator variant={getStatusVariant(entry.status)} size="sm">
                  {entry.status.replace(/_/g, " ")}
                </StatusIndicator>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
