/**
 * Shared constants and utilities for issue display across the UI.
 *
 * Consolidates status/type definitions, variant resolution, and display formatting
 * that were previously duplicated across IssuesTab, IssueCard, and IssueList.
 */

import type { StatusIndicatorProps } from "~/components/shared/StatusIndicator";

// ---------------------------------------------------------------------------
// Status variant type (matches StatusIndicator's variant prop)
// ---------------------------------------------------------------------------

export type IssueStatusVariant = NonNullable<StatusIndicatorProps["variant"]>;

// ---------------------------------------------------------------------------
// Issue statuses — sourced from `bd statuses`
// ---------------------------------------------------------------------------

export interface IssueStatusDef {
  readonly value: string;
  readonly label: string;
  readonly variant: IssueStatusVariant;
  readonly category: "active" | "wip" | "done" | "frozen";
}

export const ISSUE_STATUSES: readonly IssueStatusDef[] = [
  { value: "open", label: "Open", variant: "info", category: "active" },
  { value: "in_progress", label: "In Progress", variant: "warning", category: "wip" },
  { value: "blocked", label: "Blocked", variant: "error", category: "wip" },
  { value: "deferred", label: "Deferred", variant: "secondary", category: "frozen" },
  { value: "pinned", label: "Pinned", variant: "primary", category: "frozen" },
  { value: "hooked", label: "Hooked", variant: "warning", category: "wip" },
  { value: "closed", label: "Closed", variant: "success", category: "done" },
] as const;

/** The subset of statuses that appear most commonly and are shown in the status selector. */
export const CORE_ISSUE_STATUSES = ISSUE_STATUSES.filter(
  (s) => s.value !== "pinned" && s.value !== "hooked",
);

const STATUS_VARIANT_MAP = new Map<string, IssueStatusVariant>(
  ISSUE_STATUSES.map((s) => [s.value, s.variant]),
);

const STATUS_LABEL_MAP = new Map<string, string>(ISSUE_STATUSES.map((s) => [s.value, s.label]));

// ---------------------------------------------------------------------------
// Issue types — sourced from `bd types`
// ---------------------------------------------------------------------------

export interface IssueTypeDef {
  readonly value: string;
  readonly label: string;
}

export const ISSUE_TYPES: readonly IssueTypeDef[] = [
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "chore", label: "Chore" },
  { value: "epic", label: "Epic" },
  { value: "decision", label: "Decision" },
  { value: "spike", label: "Spike" },
  { value: "story", label: "Story" },
  { value: "milestone", label: "Milestone" },
] as const;

/** Issue types suitable for creation (excludes milestone which is structural). */
export const CREATABLE_ISSUE_TYPES = ISSUE_TYPES.filter((t) => t.value !== "milestone");

// ---------------------------------------------------------------------------
// Priority definitions
// ---------------------------------------------------------------------------

export interface IssuePriorityDef {
  readonly value: number;
  readonly label: string;
  readonly variant: IssueStatusVariant;
}

export const ISSUE_PRIORITIES: readonly IssuePriorityDef[] = [
  { value: 0, label: "P0 — Critical", variant: "error" },
  { value: 1, label: "P1 — High", variant: "error" },
  { value: 2, label: "P2 — Medium", variant: "warning" },
  { value: 3, label: "P3 — Low", variant: "secondary" },
  { value: 4, label: "P4 — Minimal", variant: "secondary" },
] as const;

// ---------------------------------------------------------------------------
// Variant resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the StatusIndicator variant for a given issue status string.
 * Falls back to "secondary" for unknown statuses.
 */
export function getStatusVariant(status: string): IssueStatusVariant {
  return STATUS_VARIANT_MAP.get(status) ?? "secondary";
}

/**
 * Resolve the StatusIndicator variant for a given priority number.
 */
export function getPriorityVariant(priority: number | null): IssueStatusVariant {
  if (priority === null) return "secondary";
  if (priority <= 1) return "error";
  if (priority === 2) return "warning";
  return "secondary";
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a status string for display (e.g. "in_progress" → "In Progress").
 * Uses the canonical label if known, otherwise replaces underscores with spaces
 * and capitalizes.
 */
export function formatStatusDisplay(status: string): string {
  const known = STATUS_LABEL_MAP.get(status);
  if (known) return known;
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a priority number for display (e.g. 1 → "P1").
 */
export function formatPriorityDisplay(priority: number | null): string | null {
  if (priority === null) return null;
  return `P${priority}`;
}
