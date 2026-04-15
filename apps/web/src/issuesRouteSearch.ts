import type { BeadsIssueSortBy } from "@t3tools/contracts";

export interface IssuesRouteSearch {
  tab?: "coordinator" | "issues" | "board";
  epicId?: string;
  runId?: string;
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
  if (value === "coordinator" || value === "issues" || value === "board") {
    return value;
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
  const runId = normalizeSearchString(search.runId);
  const issueId = normalizeSearchString(search.issueId);
  const showClosed = parseBoolean(search.showClosed);
  const sort = parseSort(search.sort);
  return {
    ...(tab ? { tab } : {}),
    ...(epicId ? { epicId } : {}),
    ...(runId ? { runId } : {}),
    ...(issueId ? { issueId } : {}),
    ...(showClosed !== undefined ? { showClosed } : {}),
    ...(sort ? { sort } : {}),
  };
}
