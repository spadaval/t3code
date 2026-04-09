/**
 * Reusable inline-editable field components extracted from IssuesTab.
 *
 * Two variants:
 * - `EditableTitle`: single-line text (Input), save on Enter/blur, cancel on Escape
 * - `EditableTextArea`: multi-line text (Textarea), explicit Save/Cancel buttons
 *
 * Both follow the same state-machine pattern: display → editing → saving.
 */
import { useCallback, useState } from "react";
import { CheckIcon, Loader2Icon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

// ---------------------------------------------------------------------------
// EditableTitle — single-line click-to-edit
// ---------------------------------------------------------------------------

export interface EditableTitleProps {
  value: string;
  onSave: (value: string) => void;
  saving?: boolean;
  placeholder?: string;
  className?: string;
}

export function EditableTitle({
  value,
  onSave,
  saving = false,
  placeholder = "Untitled",
  className,
}: EditableTitleProps) {
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
          className={className ?? "text-xl font-semibold"}
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
        className={
          className ??
          "flex-1 cursor-pointer text-left text-xl font-semibold text-foreground leading-tight hover:text-foreground/80"
        }
        onClick={handleStartEdit}
      >
        {value || placeholder}
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
// EditableTextArea — multi-line click-to-edit with Save/Cancel buttons
// ---------------------------------------------------------------------------

export interface EditableTextAreaProps {
  value: string;
  onSave: (value: string) => void;
  saving?: boolean;
  label: string;
  placeholder?: string;
  minHeight?: string;
}

export function EditableTextArea({
  value,
  onSave,
  saving = false,
  label,
  placeholder,
  minHeight = "min-h-[6rem]",
}: EditableTextAreaProps) {
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
          {label}
        </h3>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          autoFocus
          className={`${minHeight} text-sm`}
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
          {label}
        </h3>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleStartEdit}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`Edit ${label.toLowerCase()}`}
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
          {placeholder ?? `Add ${label.toLowerCase()}...`}
        </button>
      )}
    </div>
  );
}
