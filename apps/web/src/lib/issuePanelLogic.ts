import type {
  BeadsIssueSummary,
  BeadsSwarmSummary,
  OrchestrationSwarmRun,
  BeadsCoordinatorEpicSnapshot,
} from "@t3tools/contracts";
import type { IssuePaneScope } from "~/issuePaneStore";
import {
  groupIssuesByEpic,
  partitionCoordinatorSwarms,
  type EpicGroup,
  type CoordinatorSwarmSections,
} from "~/issuePanel";

// ── Issue Filtering and Sorting ─────────────────────────────────────────

export interface IssueFilterOptions {
  searchQuery?: string;
  scopeFilter?: IssuePaneScope;
  selectedLabels?: readonly string[];
  sortBy?: "updated" | "created" | "title" | "status";
  sortDirection?: "asc" | "desc";
  groupBy?: "none" | "status" | "labels" | "epic" | "assignee";
}

export interface FilteredIssuesResult {
  issues: readonly BeadsIssueSummary[];
  totalCount: number;
  filteredCount: number;
  epicGroups: readonly EpicGroup[];
  groupedIssues: Map<string, readonly BeadsIssueSummary[]>;
}

/**
 * Pure function to filter and sort issues based on provided criteria.
 * Fully testable business logic extracted from components.
 */
export function filterAndSortIssues(
  issues: readonly BeadsIssueSummary[],
  options: IssueFilterOptions = {},
): FilteredIssuesResult {
  const {
    searchQuery = "",
    scopeFilter = "active",
    selectedLabels = [],
    sortBy = "updated",
    sortDirection = "desc",
    groupBy = "none",
  } = options;

  let filtered = [...issues];
  const originalCount = issues.length;

  // Step 1: Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((issue) => {
      const titleMatch = issue.title.toLowerCase().includes(query);
      const descriptionMatch = issue.description?.toLowerCase().includes(query);
      const labelMatch = issue.labels?.some((label) => label.toLowerCase().includes(query));
      const idMatch = issue.id.toLowerCase().includes(query);

      return titleMatch || descriptionMatch || labelMatch || idMatch;
    });
  }

  // Step 2: Apply scope filter
  if (scopeFilter !== "all") {
    filtered = filtered.filter((issue) => {
      switch (scopeFilter) {
        case "active":
          return issue.status === "open";
        case "closed":
          return issue.status === "closed";
        default:
          return true;
      }
    });
  }

  // Step 3: Apply label filter
  if (selectedLabels.length > 0) {
    filtered = filtered.filter((issue) => {
      if (!issue.labels || issue.labels.length === 0) {
        return false;
      }

      return selectedLabels.every((selectedLabel) =>
        issue.labels!.some((label) => label === selectedLabel),
      );
    });
  }

  // Step 4: Apply sorting
  const sorted = [...filtered].toSorted((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "created":
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case "updated":
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case "status":
        comparison = a.status.localeCompare(b.status);
        break;
      default:
        comparison = 0;
    }

    return sortDirection === "desc" ? -comparison : comparison;
  });

  // Step 5: Generate groupings
  const epicGroups = groupIssuesByEpic(sorted);
  const groupedIssues = createIssueGroups(sorted, groupBy);

  return {
    issues: sorted,
    totalCount: originalCount,
    filteredCount: sorted.length,
    epicGroups,
    groupedIssues,
  };
}

/**
 * Creates issue groups based on the specified grouping strategy.
 */
function createIssueGroups(
  issues: readonly BeadsIssueSummary[],
  groupBy: NonNullable<IssueFilterOptions["groupBy"]>,
): Map<string, readonly BeadsIssueSummary[]> {
  const groups = new Map<string, BeadsIssueSummary[]>();

  switch (groupBy) {
    case "status":
      for (const issue of issues) {
        const key = issue.status || "unknown";
        const existing = groups.get(key) || [];
        groups.set(key, [...existing, issue]);
      }
      break;

    case "labels":
      for (const issue of issues) {
        const labels = issue.labels || [];
        if (labels.length === 0) {
          const key = "no-labels";
          const existing = groups.get(key) || [];
          groups.set(key, [...existing, issue]);
        } else {
          for (const label of labels) {
            const key = label; // labels are strings in BeadsIssueSummary
            const existing = groups.get(key) || [];
            groups.set(key, [...existing, issue]);
          }
        }
      }
      break;

    case "epic":
      for (const issue of issues) {
        const key = issue.parent?.id || "no-epic";
        const existing = groups.get(key) || [];
        groups.set(key, [...existing, issue]);
      }
      break;

    case "assignee":
      for (const issue of issues) {
        const key = issue.assignee || "unassigned"; // assignee is string | null in BeadsIssueSummary
        const existing = groups.get(key) || [];
        groups.set(key, [...existing, issue]);
      }
      break;

    case "none":
    default:
      groups.set("all", [...issues]);
      break;
  }

  // Convert to readonly
  const readonlyGroups = new Map<string, readonly BeadsIssueSummary[]>();
  for (const [key, value] of groups) {
    readonlyGroups.set(key, value);
  }

  return readonlyGroups;
}

// ── Coordinator State Analysis ──────────────────────────────────────────

export interface CoordinatorAnalysisOptions {
  showOnlyActive?: boolean;
  selectedEpicId?: string | null;
}

export interface CoordinatorAnalysisResult {
  sections: CoordinatorSwarmSections;
  metrics: {
    totalSwarms: number;
    activeSwarms: number;
    readySwarms: number;
    totalActiveWorkers: number;
    totalReadyIssues: number;
    totalCompletedIssues: number;
    totalIssues: number;
  };
  filteredSwarms: readonly BeadsSwarmSummary[];
  selectedEpicSwarm: BeadsSwarmSummary | null;
  hasActivity: boolean;
  needsAttention: readonly BeadsSwarmSummary[];
}

/**
 * Analyzes coordinator state and provides structured insights.
 * Pure function for testable coordinator logic.
 */
export function analyzeCoordinatorState(
  swarms: readonly BeadsSwarmSummary[],
  options: CoordinatorAnalysisOptions = {},
): CoordinatorAnalysisResult {
  const { showOnlyActive = false, selectedEpicId = null } = options;

  // Filter swarms based on options
  let filteredSwarms = [...swarms];
  if (showOnlyActive) {
    filteredSwarms = filteredSwarms.filter((swarm) => swarm.activeWorkerCount > 0);
  }

  // Find selected epic swarm
  const selectedEpicSwarm = selectedEpicId
    ? swarms.find((swarm) => swarm.epicId === selectedEpicId) || null
    : null;

  // Partition into sections
  const sections = partitionCoordinatorSwarms(filteredSwarms);

  // Calculate metrics
  const metrics = {
    totalSwarms: swarms.length,
    activeSwarms: swarms.filter((s) => s.activeWorkerCount > 0).length,
    readySwarms: swarms.filter((s) => s.activeWorkerCount === 0 && s.readyIssueCount > 0).length,
    totalActiveWorkers: swarms.reduce((sum, s) => sum + s.activeWorkerCount, 0),
    totalReadyIssues: swarms.reduce((sum, s) => sum + s.readyIssueCount, 0),
    totalCompletedIssues: swarms.reduce((sum, s) => sum + s.completedIssueCount, 0),
    totalIssues: swarms.reduce((sum, s) => sum + s.totalIssueCount, 0),
  };

  // Identify swarms needing attention (errors, blocked, etc.)
  const needsAttention = swarms.filter((swarm) => {
    // Add logic for identifying problematic swarms
    const hasStallWarnings =
      swarm.totalIssueCount > 0 && swarm.readyIssueCount === 0 && swarm.activeWorkerCount === 0;
    const hasHighFailureRate =
      swarm.completedIssueCount > 0 && swarm.completedIssueCount / swarm.totalIssueCount < 0.5;

    return hasStallWarnings || hasHighFailureRate;
  });

  const hasActivity = metrics.totalActiveWorkers > 0 || metrics.totalReadyIssues > 0;

  return {
    sections,
    metrics,
    filteredSwarms,
    selectedEpicSwarm,
    hasActivity,
    needsAttention,
  };
}

// ── Epic Coordination Logic ─────────────────────────────────────────────

export interface EpicCoordinationResult {
  epics: readonly BeadsCoordinatorEpicSnapshot[];
  prioritizedEpics: readonly BeadsCoordinatorEpicSnapshot[];
  epicById: Map<string, BeadsCoordinatorEpicSnapshot>;
  epicSwarmMap: Map<string, BeadsSwarmSummary>;
  runsByEpic: Map<string, readonly OrchestrationSwarmRun[]>;
}

/**
 * Analyzes epic coordination state and provides structured data.
 * Combines epics, swarms, and runs for comprehensive coordination view.
 */
export function analyzeEpicCoordination(
  epics: readonly BeadsCoordinatorEpicSnapshot[],
  swarms: readonly BeadsSwarmSummary[],
  swarmRuns: readonly OrchestrationSwarmRun[],
): EpicCoordinationResult {
  // Create lookup maps
  const epicById = new Map<string, BeadsCoordinatorEpicSnapshot>();
  for (const epic of epics) {
    epicById.set(epic.epicId, epic);
  }

  const epicSwarmMap = new Map<string, BeadsSwarmSummary>();
  for (const swarm of swarms) {
    epicSwarmMap.set(swarm.epicId, swarm);
  }

  // Group runs by epic
  const runsByEpic = new Map<string, OrchestrationSwarmRun[]>();
  for (const run of swarmRuns) {
    const epicId = run.epicIssueId;
    const existing = runsByEpic.get(epicId) || [];
    runsByEpic.set(epicId, [...existing, run]);
  }

  // Convert to readonly maps
  const readonlyRunsByEpic = new Map<string, readonly OrchestrationSwarmRun[]>();
  for (const [key, value] of runsByEpic) {
    readonlyRunsByEpic.set(key, value);
  }

  // Prioritize epics based on activity and state
  const prioritizedEpics = [...epics].toSorted((a, b) => {
    // Running epics first
    if (a.stateKind === "running" && b.stateKind !== "running") return -1;
    if (b.stateKind === "running" && a.stateKind !== "running") return 1;

    // Then ready epics
    if (a.stateKind === "ready" && b.stateKind !== "ready") return -1;
    if (b.stateKind === "ready" && a.stateKind !== "ready") return 1;

    // Then by title alphabetically
    return a.epicTitle.localeCompare(b.epicTitle);
  });

  return {
    epics,
    prioritizedEpics,
    epicById,
    epicSwarmMap,
    runsByEpic: readonlyRunsByEpic,
  };
}

// ── Search and Filter Utilities ─────────────────────────────────────────

const ACTIVE_ISSUE_LIST_STATUSES = new Set(["open", "in_progress", "blocked", "deferred"]);

const ISSUE_SEARCH_FIELD_WEIGHTS = {
  id: 1000,
  title: 700,
  labels: 450,
  parentTitle: 450,
  description: 220,
  notes: 200,
} as const;

type IssueSearchField = keyof typeof ISSUE_SEARCH_FIELD_WEIGHTS;

interface SearchableIssueField {
  readonly key: IssueSearchField;
  readonly value: string;
  readonly normalized: string;
  readonly words: readonly string[];
}

export interface IssueListSearchOptions {
  searchQuery?: string;
  scopeFilter?: IssuePaneScope;
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}

function tokenizeSearchValue(value: string): readonly string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function splitSearchWords(value: string): readonly string[] {
  return value.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function isSubsequenceMatch(query: string, candidate: string): boolean {
  if (query.length === 0) {
    return true;
  }

  let queryIndex = 0;
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] === query[queryIndex]) {
      queryIndex += 1;
    }
  }

  return queryIndex === query.length;
}

function computeBoundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) {
    return 0;
  }

  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0]!;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[right.length]!;
}

function rankSearchTokenAgainstField(token: string, field: SearchableIssueField): number {
  if (field.normalized.length === 0) {
    return 0;
  }

  const fieldWeight = ISSUE_SEARCH_FIELD_WEIGHTS[field.key];

  if (field.normalized === token) {
    return fieldWeight + 800;
  }

  if (field.words.some((word) => word === token)) {
    return fieldWeight + 700;
  }

  if (field.normalized.startsWith(token)) {
    return fieldWeight + 520;
  }

  if (field.words.some((word) => word.startsWith(token))) {
    return fieldWeight + 460;
  }

  if (field.normalized.includes(token)) {
    return fieldWeight + 380;
  }

  if (field.words.some((word) => word.includes(token))) {
    return fieldWeight + 320;
  }

  for (const word of field.words) {
    const maxDistance = token.length >= 6 ? 2 : 1;
    const editDistance = computeBoundedEditDistance(token, word, maxDistance);
    if (editDistance <= maxDistance) {
      return fieldWeight + 220 - editDistance * 40;
    }
  }

  if (isSubsequenceMatch(token, field.normalized)) {
    return fieldWeight + 120;
  }

  return 0;
}

function buildSearchableIssueFields(issue: BeadsIssueSummary): readonly SearchableIssueField[] {
  const fields: Array<SearchableIssueField | null> = [
    {
      key: "id",
      value: issue.id,
      normalized: normalizeSearchValue(issue.id),
      words: splitSearchWords(normalizeSearchValue(issue.id)),
    },
    {
      key: "title",
      value: issue.title,
      normalized: normalizeSearchValue(issue.title),
      words: splitSearchWords(normalizeSearchValue(issue.title)),
    },
    {
      key: "labels",
      value: issue.labels.join(" "),
      normalized: normalizeSearchValue(issue.labels.join(" ")),
      words: splitSearchWords(normalizeSearchValue(issue.labels.join(" "))),
    },
    {
      key: "parentTitle",
      value: issue.parent?.title ?? "",
      normalized: normalizeSearchValue(issue.parent?.title),
      words: splitSearchWords(normalizeSearchValue(issue.parent?.title)),
    },
    {
      key: "description",
      value: issue.description ?? "",
      normalized: normalizeSearchValue(issue.description),
      words: splitSearchWords(normalizeSearchValue(issue.description)),
    },
    {
      key: "notes",
      value: issue.notes ?? "",
      normalized: normalizeSearchValue(issue.notes),
      words: splitSearchWords(normalizeSearchValue(issue.notes)),
    },
  ];

  return fields.filter((field): field is SearchableIssueField => field !== null);
}

function matchesIssueListScope(issue: BeadsIssueSummary, scopeFilter: IssuePaneScope): boolean {
  if (scopeFilter === "all") {
    return true;
  }

  if (scopeFilter === "closed") {
    return issue.status === "closed";
  }

  return ACTIVE_ISSUE_LIST_STATUSES.has(issue.status);
}

function rankIssueAgainstQuery(issue: BeadsIssueSummary, normalizedQuery: string): number | null {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  const tokens = tokenizeSearchValue(normalizedQuery);
  if (tokens.length === 0) {
    return 0;
  }

  const fields = buildSearchableIssueFields(issue);
  let score = 0;

  if (normalizeSearchValue(issue.id) === normalizedQuery) {
    score += 20_000;
  }

  for (const token of tokens) {
    let bestTokenScore = 0;
    for (const field of fields) {
      bestTokenScore = Math.max(bestTokenScore, rankSearchTokenAgainstField(token, field));
    }

    if (bestTokenScore <= 0) {
      return null;
    }

    score += bestTokenScore;
  }

  return score;
}

export function filterIssuesForList(
  issues: readonly BeadsIssueSummary[],
  options: IssueListSearchOptions = {},
): readonly BeadsIssueSummary[] {
  const scopeFilter = options.scopeFilter ?? "active";
  const normalizedQuery = normalizeSearchValue(options.searchQuery);
  const scopedIssues = issues.filter((issue) => matchesIssueListScope(issue, scopeFilter));

  if (normalizedQuery.length === 0) {
    return scopedIssues;
  }

  return scopedIssues
    .map((issue, index) => ({
      issue,
      index,
      score: rankIssueAgainstQuery(issue, normalizedQuery),
    }))
    .filter(
      (entry): entry is { issue: BeadsIssueSummary; index: number; score: number } =>
        entry.score !== null,
    )
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.issue);
}

export interface SearchResult<T> {
  items: readonly T[];
  query: string;
  highlightRanges: Map<string, Array<{ start: number; end: number }>>;
}

/**
 * Performs search across multiple fields with highlighting support.
 */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  searchFields: Array<keyof T & string>,
): SearchResult<T> {
  if (!query.trim()) {
    return {
      items,
      query: "",
      highlightRanges: new Map(),
    };
  }

  const normalizedQuery = query.toLowerCase().trim();
  const highlightRanges = new Map<string, Array<{ start: number; end: number }>>();

  const filteredItems = items.filter((item, index) => {
    let hasMatch = false;
    const itemId = String(index);

    for (const field of searchFields) {
      const value = String(item[field] || "").toLowerCase();
      if (value.includes(normalizedQuery)) {
        hasMatch = true;

        // Find all match positions for highlighting
        const matches: Array<{ start: number; end: number }> = [];
        let searchStart = 0;
        let matchIndex = value.indexOf(normalizedQuery, searchStart);

        while (matchIndex !== -1) {
          matches.push({
            start: matchIndex,
            end: matchIndex + normalizedQuery.length,
          });
          searchStart = matchIndex + 1;
          matchIndex = value.indexOf(normalizedQuery, searchStart);
        }

        if (matches.length > 0) {
          highlightRanges.set(`${itemId}-${field}`, matches);
        }
      }
    }

    return hasMatch;
  });

  return {
    items: filteredItems,
    query,
    highlightRanges,
  };
}

// ── Performance Optimization Utilities ──────────────────────────────────

/**
 * Debounces function calls to improve performance during rapid updates.
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Throttles function calls to limit execution frequency.
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Move defaultKeyGenerator to outer scope to avoid recreation on every call
const _defaultKeyGenerator = <T extends any[]>(...args: T) => JSON.stringify(args);

/**
 * Creates a memoized version of a function for expensive computations.
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  keyGenerator?: (...args: Parameters<T>) => string,
): T {
  const cache = new Map<string, ReturnType<T>>();

  const getKey = keyGenerator || (_defaultKeyGenerator as (...args: Parameters<T>) => string);

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = getKey(...args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = func(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

// ── Validation and Error Handling ───────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
}

/**
 * Validates issue panel state for consistency and completeness.
 */
export function validateIssueState(
  issues: readonly BeadsIssueSummary[],
  options: IssueFilterOptions,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate search query
  if (options.searchQuery && options.searchQuery.length > 1000) {
    errors.push("Search query is too long");
  }

  // Validate selected labels
  if (options.selectedLabels && options.selectedLabels.length > 50) {
    warnings.push("Too many labels selected may impact performance");
  }

  // Validate issue data consistency
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const issue of issues) {
    if (seenIds.has(issue.id)) {
      duplicateIds.add(issue.id);
    } else {
      seenIds.add(issue.id);
    }
  }

  if (duplicateIds.size > 0) {
    errors.push(`Duplicate issue IDs found: ${Array.from(duplicateIds).join(", ")}`);
  }

  // Validate parent-child relationships
  for (const issue of issues) {
    if (issue.parent && !seenIds.has(issue.parent.id)) {
      warnings.push(`Issue ${issue.id} references missing parent ${issue.parent.id}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates coordinator state for operational readiness.
 */
export function validateCoordinatorState(
  swarms: readonly BeadsSwarmSummary[],
  epics: readonly BeadsCoordinatorEpicSnapshot[],
  runs: readonly OrchestrationSwarmRun[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for orphaned swarms
  const epicIds = new Set(epics.map((e) => e.epicId));
  for (const swarm of swarms) {
    if (!epicIds.has(swarm.epicId)) {
      warnings.push(`Swarm ${swarm.swarmId} references missing epic ${swarm.epicId}`);
    }
  }

  // Check for inconsistent run data - OrchestrationSwarmRun uses epicIssueId instead of swarmId
  const swarmEpicIds = new Set(swarms.map((s) => s.epicId));
  for (const run of runs) {
    if (!swarmEpicIds.has(run.epicIssueId)) {
      warnings.push(`Run ${run.runId} references missing epic ${run.epicIssueId}`);
    }
  }

  // Check for resource conflicts
  const activeWorkerCount = swarms.reduce((sum, s) => sum + s.activeWorkerCount, 0);
  if (activeWorkerCount > 100) {
    warnings.push("High number of active workers may impact system performance");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
