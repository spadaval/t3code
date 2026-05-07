import type { BeadsIssueSortBy } from "@t3tools/contracts";

export interface IssuesRouteSearch {
  tab?: "issues";
  epicId?: string;
  issueId?: string;
  showClosed?: boolean;
  sort?: BeadsIssueSortBy;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseTab(value: unknown): IssuesRouteSearch["tab"] {
  if (value === "issues") {
    return "issues";
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  return undefined;
}

function parseSort(value: unknown): IssuesRouteSearch["sort"] {
  if (value === "updated" || value === "created" || value === "priority" || value === "title") {
    return value;
  }
  return undefined;
}

export function parseIssuesRouteSearch(search: Record<string, unknown>): IssuesRouteSearch {
  const tab = parseTab(search.tab);
  const epicId = normalizeSearchString(search.epicId);
  const issueId = normalizeSearchString(search.issueId);
  const showClosed = parseBoolean(search.showClosed);
  const sort = parseSort(search.sort);
  return {
    ...(tab ? { tab } : {}),
    ...(epicId ? { epicId } : {}),
    ...(issueId ? { issueId } : {}),
    ...(showClosed !== undefined ? { showClosed } : {}),
    ...(sort ? { sort } : {}),
  };
}

export function resolveCanonicalIssuesRouteSearch(
  search: Record<string, unknown>,
): IssuesRouteSearch {
  const parsed = parseIssuesRouteSearch(search);

  return {
    tab: "issues",
    ...(parsed.epicId ? { epicId: parsed.epicId } : {}),
    ...(parsed.issueId ? { issueId: parsed.issueId } : {}),
    ...(parsed.showClosed !== undefined ? { showClosed: parsed.showClosed } : {}),
    ...(parsed.sort ? { sort: parsed.sort } : {}),
  };
}

export function issuesRouteSearchNeedsRedirect(search: Record<string, unknown>): boolean {
  const canonical = resolveCanonicalIssuesRouteSearch(search);
  return (
    canonical.tab !== search.tab ||
    canonical.epicId !== normalizeSearchString(search.epicId) ||
    canonical.issueId !== normalizeSearchString(search.issueId) ||
    canonical.showClosed !== parseBoolean(search.showClosed) ||
    canonical.sort !== parseSort(search.sort) ||
    normalizeSearchString(search.runId) !== undefined
  );
}
