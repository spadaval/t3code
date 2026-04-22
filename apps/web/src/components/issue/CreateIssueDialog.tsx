import type { BeadsCreateIssueInput } from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { beadsCreateIssueMutationOptions } from "~/lib/beadsReactQuery";
import { CREATABLE_ISSUE_TYPES, ISSUE_PRIORITIES, ISSUE_STATUSES } from "~/lib/issueConstants";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateIssueDialogProps {
  /** Working directory for beads commands. */
  readonly cwd: string;
  /** Optional pre-set status for the new issue (e.g. from a kanban column). */
  readonly defaultStatus?: string;
  /** Optional pre-set parent epic id. */
  readonly defaultParent?: string;
  /** Called after a successful creation with the new issue id. */
  readonly onCreated?: (issueId: string) => void;
  /** Render prop for the trigger element. If omitted, a default button is rendered. */
  readonly trigger?: React.ReactElement;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateIssueDialog({
  cwd,
  defaultStatus,
  defaultParent,
  onCreated,
  trigger,
}: CreateIssueDialogProps) {
  const queryClient = useQueryClient();
  const createMutation = useMutation(beadsCreateIssueMutationOptions({ queryClient }));

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<string>("task");
  const [priority, setPriority] = useState<string>("");
  const [status, setStatus] = useState<string>(defaultStatus ?? "");
  const [parent, setParent] = useState<string>(defaultParent ?? "");
  const [labelsText, setLabelsText] = useState("");

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setIssueType("task");
    setPriority("");
    setStatus(defaultStatus ?? "");
    setParent(defaultParent ?? "");
    setLabelsText("");
    createMutation.reset();
  }, [defaultStatus, defaultParent, createMutation]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        resetForm();
      }
    },
    [resetForm],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedTitle = title.trim();
      if (!trimmedTitle || !cwd) return;

      const labels = labelsText
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      const payload: BeadsCreateIssueInput = {
        cwd,
        title: trimmedTitle,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(issueType ? { issueType } : {}),
        ...(priority !== "" ? { priority: Number(priority) } : {}),
        ...(status ? { status } : {}),
        ...(parent.trim() ? { parent: parent.trim() } : {}),
        ...(labels.length > 0 ? { labels } : {}),
      };

      const result = await createMutation.mutateAsync(payload);
      onCreated?.(result.id);
      setOpen(false);
      resetForm();
    },
    [
      cwd,
      title,
      description,
      issueType,
      priority,
      status,
      parent,
      labelsText,
      createMutation,
      onCreated,
      resetForm,
    ],
  );

  const canSubmit = title.trim().length > 0 && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="xs" variant="ghost">
              <PlusIcon className="size-3.5" />
              New Issue
            </Button>
          )
        }
      />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Issue</DialogTitle>
          <DialogDescription>Create a new issue in the beads issue tracker.</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <form id="create-issue-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Title (required) */}
            <Field>
              <FieldLabel>Title</FieldLabel>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title"
                autoFocus
                required
              />
            </Field>

            {/* Description */}
            <Field>
              <FieldLabel>Description</FieldLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
              />
            </Field>

            {/* Type + Priority row */}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select value={issueType} onValueChange={(v) => setIssueType(v ?? "task")}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {CREATABLE_ISSUE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={priority} onValueChange={(v) => setPriority(v ?? "")}>
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="">None</SelectItem>
                    {ISSUE_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            </div>

            {/* Status + Parent row */}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onValueChange={(v) => setStatus(v ?? "")}>
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="">Default</SelectItem>
                    {ISSUE_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Parent ID</FieldLabel>
                <Input
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  placeholder="e.g. EPIC-1"
                  size="sm"
                />
              </Field>
            </div>

            {/* Labels */}
            <Field>
              <FieldLabel>Labels</FieldLabel>
              <Input
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder="Comma-separated labels"
                size="sm"
              />
            </Field>

            {/* Error display */}
            {createMutation.isError && (
              <p className="text-xs text-destructive-foreground">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "Failed to create issue."}
              </p>
            )}
          </form>
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button type="submit" form="create-issue-form" disabled={!canSubmit}>
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
