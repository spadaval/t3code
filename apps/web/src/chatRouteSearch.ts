import { TurnId } from "@t3tools/contracts";

export type ChatRightPane = "diff" | "issues";

export interface ChatRouteSearch {
  rightPane?: ChatRightPane | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  issueId?: string | undefined;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseRightPane(value: unknown): ChatRightPane | undefined {
  if (value === "diff" || value === "issues") {
    return value;
  }
  return undefined;
}

function isLegacyDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

export function stripRightPaneSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "rightPane" | "diff" | "diffTurnId" | "diffFilePath" | "issueId"> & {
  rightPane: undefined;
  diff: undefined;
  diffTurnId: undefined;
  diffFilePath: undefined;
  issueId: undefined;
} {
  const {
    rightPane: _rightPane,
    diff: _diff,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    issueId: _issueId,
    ...rest
  } = params;
  return {
    ...rest,
    rightPane: undefined,
    diff: undefined,
    diffTurnId: undefined,
    diffFilePath: undefined,
    issueId: undefined,
  };
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const rightPane =
    parseRightPane(search.rightPane) ?? (isLegacyDiffOpenValue(search.diff) ? "diff" : undefined);

  const diffTurnIdRaw = rightPane === "diff" ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.makeUnsafe(diffTurnIdRaw) : undefined;
  const diffFilePath =
    rightPane === "diff" && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;
  const issueId = rightPane === "issues" ? normalizeSearchString(search.issueId) : undefined;

  return {
    ...(rightPane ? { rightPane } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
    ...(issueId ? { issueId } : {}),
  };
}
