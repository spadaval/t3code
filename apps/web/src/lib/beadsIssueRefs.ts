export const MAX_BEADS_ISSUE_REF_CANDIDATES = 50;

const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*]\([^)\n]*\)/g;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;
const FENCED_CODE_PATTERN = /```[\s\S]*?```/g;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)]+/gi;
const CANDIDATE_PATTERN = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+(?:\.[A-Za-z0-9]+)*/g;

function maskRanges(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match) => " ".repeat(match.length));
}

function maskIgnoredMarkdownRanges(text: string): string {
  return [FENCED_CODE_PATTERN, INLINE_CODE_PATTERN, MARKDOWN_LINK_PATTERN, URL_PATTERN].reduce(
    (masked, pattern) => maskRanges(masked, pattern),
    text,
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const normalized = projectId?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function hasLeadingBoundary(value: string | undefined): boolean {
  return value === undefined || !/[A-Za-z0-9._/-]/.test(value);
}

function hasTrailingBoundary(value: string | undefined, nextValue: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === "." && (nextValue === undefined || !/[A-Za-z0-9]/.test(nextValue))) {
    return true;
  }
  return !/[A-Za-z0-9._/-]/.test(value);
}

function isConventionalUppercaseIssueId(value: string): boolean {
  return /^[A-Z][A-Z0-9]+-[A-Z0-9]+(?:\.[A-Z0-9]+)*$/.test(value);
}

function isLegacyBdIssueId(value: string): boolean {
  return /^bd-\d+$/i.test(value);
}

function isProjectIssueId(value: string, projectId: string | null): boolean {
  if (projectId === null || !value.toLowerCase().startsWith(`${projectId}-`)) {
    return false;
  }

  const hierarchySegments = value.slice(projectId.length + 1).split(".");
  return (
    hierarchySegments.length === 1 ||
    hierarchySegments.slice(1).every((segment) => /\d/.test(segment))
  );
}

function isLowercaseProjectLikeIssueId(value: string): boolean {
  const [projectPrefix, ...rest] = value.split("-");
  if (!projectPrefix || rest.length === 0 || !/\d/.test(projectPrefix)) {
    return false;
  }
  if (!/^[a-z0-9]+$/.test(projectPrefix) || !/^[a-z0-9.-]+$/.test(rest.join("-"))) {
    return false;
  }
  const hierarchySegments = rest.join("-").split(".");
  return (
    hierarchySegments.length === 1 ||
    hierarchySegments.slice(1).every((segment) => /\d/.test(segment))
  );
}

export function isBeadsIssueRefCandidate(value: string, projectId?: string | null): boolean {
  const normalizedProjectId = normalizeProjectId(projectId);
  return (
    isProjectIssueId(value, normalizedProjectId) ||
    isLowercaseProjectLikeIssueId(value) ||
    isLegacyBdIssueId(value) ||
    isConventionalUppercaseIssueId(value)
  );
}

export function extractBeadsIssueRefCandidates(
  markdownText: string,
  options: { readonly projectId?: string | null; readonly limit?: number } = {},
): string[] {
  const limit = Math.max(0, options.limit ?? MAX_BEADS_ISSUE_REF_CANDIDATES);
  if (limit === 0 || markdownText.length === 0) {
    return [];
  }

  const maskedText = maskIgnoredMarkdownRanges(markdownText);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const match of maskedText.matchAll(CANDIDATE_PATTERN)) {
    const value = match[0];
    const index = match.index ?? 0;
    const previous = maskedText[index - 1];
    const next = maskedText[index + value.length];
    const nextNext = maskedText[index + value.length + 1];
    if (!hasLeadingBoundary(previous) || !hasTrailingBoundary(next, nextNext)) {
      continue;
    }
    if (!isBeadsIssueRefCandidate(value, options.projectId)) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    candidates.push(value);
    if (candidates.length >= limit) {
      break;
    }
  }

  return candidates;
}

export function linkifyBeadsIssueRefsInMarkdown(
  markdownText: string,
  issueIds: readonly string[],
): string {
  const uniqueIssueIds = [...new Set(issueIds)];
  if (markdownText.length === 0 || uniqueIssueIds.length === 0) {
    return markdownText;
  }

  const maskedText = maskIgnoredMarkdownRanges(markdownText);
  const issueIdPattern = new RegExp(
    `(^|[^A-Za-z0-9._/-])(${uniqueIssueIds.map(escapeRegex).join("|")})(?=$|[^A-Za-z0-9._/-])`,
    "g",
  );
  let output = "";
  let cursor = 0;

  for (const match of maskedText.matchAll(issueIdPattern)) {
    const wholeMatch = match[0] ?? "";
    const boundary = match[1] ?? "";
    const issueId = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const issueStart = matchIndex + boundary.length;
    const issueEnd = matchIndex + wholeMatch.length;

    output += markdownText.slice(cursor, issueStart);
    output += `[${issueId}](beads://issue/${encodeURIComponent(issueId)})`;
    cursor = issueEnd;
  }

  return cursor === 0 ? markdownText : `${output}${markdownText.slice(cursor)}`;
}
