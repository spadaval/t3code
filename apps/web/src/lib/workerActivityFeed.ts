import type { OrchestrationThreadActivity } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkerFeedEntryTone = "info" | "tool" | "error" | "approval";

export interface WorkerFeedEntry {
  /** Unique key for React rendering. */
  readonly id: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** Human-readable summary line. */
  readonly label: string;
  /** Optional extra detail (command output, error message, etc.). */
  readonly detail?: string | undefined;
  /** Visual tone for icon / color. */
  readonly tone: WorkerFeedEntryTone;
  /** Activity kind from the source activity. */
  readonly kind: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Activity kinds that are noise at the coordinator level. */
const SKIP_KINDS = new Set(["context-window.updated"]);

/** Kinds we collapse: an "updated" followed by a "completed" with the same collapse key. */
function isToolLifecycle(kind: string): boolean {
  return kind === "tool.started" || kind === "tool.updated" || kind === "tool.completed";
}

function collapseKey(activity: OrchestrationThreadActivity): string | undefined {
  if (!isToolLifecycle(activity.kind)) return undefined;
  const payload = asRecord(activity.payload);
  const itemType = asTrimmedString(payload?.itemType) ?? "";
  const detail = asTrimmedString(payload?.detail) ?? "";
  if (itemType.length === 0 && detail.length === 0) return undefined;
  return `${itemType}\x1f${detail}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Derive a compact activity feed from a worker thread's activities.
 * Pure function — filters noise, collapses tool lifecycle pairs.
 */
export function deriveWorkerFeedEntries(
  activities: readonly OrchestrationThreadActivity[],
): WorkerFeedEntry[] {
  // Sort by the same ordering the store uses (sequence -> createdAt -> id).
  const sorted = [...activities].toSorted((a, b) => {
    const seqA = a.sequence ?? -1;
    const seqB = b.sequence ?? -1;
    if (seqA !== seqB) return seqA - seqB;
    const tsDelta = a.createdAt.localeCompare(b.createdAt);
    if (tsDelta !== 0) return tsDelta;
    return a.id.localeCompare(b.id);
  });

  // First pass: convert to entries, filtering noise.
  const raw: Array<WorkerFeedEntry & { _collapseKey?: string | undefined }> = [];
  for (const activity of sorted) {
    if (SKIP_KINDS.has(activity.kind)) continue;
    // Skip "Checkpoint captured" entries.
    if (activity.summary === "Checkpoint captured") continue;

    const payload = asRecord(activity.payload);
    const detail = asTrimmedString(payload?.detail);
    const ck = collapseKey(activity);

    const entry: WorkerFeedEntry & { _collapseKey?: string | undefined } = {
      id: activity.id,
      createdAt: activity.createdAt,
      label: activity.summary,
      tone: activity.tone === "approval" ? "approval" : activity.tone,
      kind: activity.kind,
      ...(detail !== undefined ? { detail } : {}),
      ...(ck !== undefined ? { _collapseKey: ck } : {}),
    };
    raw.push(entry);
  }

  // Second pass: collapse tool.started -> tool.updated -> tool.completed sequences.
  // We keep _collapseKey on internal entries to enable matching, then strip in a final pass.
  type InternalEntry = WorkerFeedEntry & { _collapseKey?: string | undefined };
  const collapsed: InternalEntry[] = [];
  for (const entry of raw) {
    const previous = collapsed.at(-1);
    if (
      previous?._collapseKey !== undefined &&
      entry._collapseKey !== undefined &&
      previous._collapseKey === entry._collapseKey &&
      isToolLifecycle(previous.kind) &&
      isToolLifecycle(entry.kind) &&
      previous.kind !== "tool.completed"
    ) {
      // Replace previous with the newer entry (keeps latest detail/label).
      collapsed[collapsed.length - 1] = {
        id: entry.id,
        createdAt: entry.createdAt,
        label: entry.label,
        tone: entry.tone,
        kind: entry.kind,
        ...(entry.detail
          ? { detail: entry.detail }
          : previous.detail
            ? { detail: previous.detail }
            : {}),
        ...(entry._collapseKey !== undefined ? { _collapseKey: entry._collapseKey } : {}),
      };
      continue;
    }
    collapsed.push(entry);
  }

  // Strip internal collapse key from the output.
  return collapsed.map(({ _collapseKey: _, ...clean }) => clean);
}
