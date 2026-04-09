export interface IssuesRouteSearch {
  tab?: "coordinator" | "issues" | "board";
  epicId?: string;
  issueId?: string;
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

export function parseIssuesRouteSearch(search: Record<string, unknown>): IssuesRouteSearch {
  const tab = parseTab(search.tab);
  const epicId = normalizeSearchString(search.epicId);
  const issueId = normalizeSearchString(search.issueId);
  return {
    ...(tab ? { tab } : {}),
    ...(epicId ? { epicId } : {}),
    ...(issueId ? { issueId } : {}),
  };
}
