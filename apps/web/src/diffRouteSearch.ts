import { TurnId } from "@t3tools/contracts";

export interface DiffRouteSearch {
  rightPane?: "diff" | "issues" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function isRightPaneValue(value: unknown): value is DiffRouteSearch["rightPane"] {
  return value === "diff" || value === "issues";
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "rightPane" | "diff" | "diffTurnId" | "diffFilePath"> {
  const {
    rightPane: _rightPane,
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    ...rest
  } = params;
  return rest as Omit<T, "rightPane" | "diff" | "diffTurnId" | "diffFilePath">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const rightPane = isRightPaneValue(search.rightPane)
    ? search.rightPane
    : isDiffOpenValue(search.diff)
      ? "diff"
      : undefined;
  const diffTurnIdRaw = rightPane === "diff" ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath =
    rightPane === "diff" && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(rightPane ? { rightPane } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
  };
}
