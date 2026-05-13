// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalDateInEffect:off
import path from "node:path";

import {
  BeadsContext,
  BeadsError,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  OrchestrationEpicWorkflowDetail,
  BeadsEpicIssueSummaries,
  BeadsGetSessionActivityResult,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueReferenceSummary,
  BeadsIssueRelationSummary,
  BeadsIssueSummary,
  CommandId,
  MessageId,
  ThreadId,
  type BeadsContext as BeadsContextType,
  type BeadsEpicCoordinationStatus as BeadsEpicCoordinationStatusType,
  type BeadsEpicCoordinationValidation as BeadsEpicCoordinationValidationType,
  type BeadsGetIssueInput,
  type BeadsIssueComment,
  type BeadsIssueDependency,
  type BeadsIssueDetail as BeadsIssueDetailType,
  type BeadsIssueReferenceSummary as BeadsIssueReferenceSummaryType,
  type BeadsIssueRelationSummary as BeadsIssueRelationSummaryType,
  type BeadsIssueSummary as BeadsIssueSummaryType,
  type BeadsQueryIssuesInput,
  type BeadsQueryIssuesResult,
  type BeadsSessionActivityEntry,
  type BeadsStartBacklogGroomingInput,
  type BeadsStartWorkflowInput,
  type BeadsStartWorkflowResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { topologicallySortByDependencies } from "@t3tools/shared/dependencyOrder";
import {
  buildEpicCoordinationGraph,
  deriveEpicCoordinationStatus,
  validateEpicCoordinationGraph,
} from "@t3tools/shared/epicCoordination";

import { runProcess } from "../../processRunner.ts";
import {
  beadsCommandDuration,
  beadsCommandsTotal,
  metricAttributes,
} from "../../observability/Metrics.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionLinkedIssueThread,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { buildEpicWorkflowSnapshot, buildEpicIssueSummaries } from "../coordinatorSnapshots.ts";
import { BeadsService, type BeadsServiceShape } from "../Services/BeadsService.ts";
import {
  BeadsTrackerService,
  type BeadsTrackerServiceShape,
} from "../Services/BeadsTrackerService.ts";

const MAX_BD_OUTPUT_BYTES = 512 * 1024;
const MAX_BD_JSON_OUTPUT_BYTES = 8 * 1024 * 1024;
const SLOW_BD_COMMAND_WARN_MS = 3_000;
const BD_COMMAND_PREVIEW_LIMIT = 240;
const BD_LOG_SCOPE = "beads.bd";
const MAX_BEADS_ISSUE_REFS_PER_REQUEST = 50;
const decodeIssueSummary = Schema.decodeUnknownSync(BeadsIssueSummary);
const decodeIssueReferenceSummary = Schema.decodeUnknownSync(BeadsIssueReferenceSummary);
const decodeIssueDetail = Schema.decodeUnknownSync(BeadsIssueDetail);
const decodeBeadsContext = Schema.decodeUnknownSync(BeadsContext);
const decodeIssueRelationSummary = Schema.decodeUnknownSync(BeadsIssueRelationSummary);
const decodeIssueGraph = Schema.decodeUnknownSync(BeadsIssueGraph);
const decodeSessionActivity = Schema.decodeUnknownSync(BeadsGetSessionActivityResult);
const decodeEpicCoordinationValidation = Schema.decodeUnknownSync(BeadsEpicCoordinationValidation);
const decodeEpicCoordinationStatus = Schema.decodeUnknownSync(BeadsEpicCoordinationStatus);
const decodeEpicIssueSummaries = Schema.decodeUnknownSync(BeadsEpicIssueSummaries);
const decodeEpicWorkflowDetail = Schema.decodeUnknownSync(OrchestrationEpicWorkflowDetail);

interface SessionActivityRecord {
  readonly cwd: string;
  readonly entry: BeadsSessionActivityEntry;
}

interface EpicWorkflowTrackerState {
  readonly issueSummary: BeadsIssueSummaryType | null;
  readonly validation: BeadsEpicCoordinationValidation | null;
  readonly status: BeadsEpicCoordinationStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
}

interface EpicCoordinationGraphState {
  readonly epic: BeadsIssueSummaryType;
  readonly graph: ReturnType<typeof buildEpicCoordinationGraph>;
  readonly loadErrors: ReadonlyArray<string>;
}

const beadsReadCacheRefs = new Set<
  SynchronizedRef.SynchronizedRef<Map<string, Deferred.Deferred<unknown, BeadsError>>>
>();

export function clearBeadsReadCachesForTesting(): Effect.Effect<void, never, never> {
  return Effect.forEach(
    [...beadsReadCacheRefs],
    (cacheRef) => SynchronizedRef.set(cacheRef, new Map()),
    { discard: true },
  );
}

type BdExecutionStrategy = "parallel" | "serial";

interface BdExecutionStrategyReservation {
  readonly deferred: Deferred.Deferred<BdExecutionStrategy, BeadsError>;
  readonly created: boolean;
}

interface BdTraceContext {
  readonly readOnly: boolean;
  readonly routing: string;
  readonly strategySource: string;
  readonly executionStrategy?: BdExecutionStrategy | "unknown";
}

interface BdCommandDetails {
  readonly action: string;
  readonly subcommand: string | null;
  readonly commandFamily: string;
  readonly subject: string | null;
  readonly preview: string;
  readonly argCount: number;
}

type BdProcessOutcome = "success" | "nonzero_exit" | "timeout" | "spawn_error";

function nowIso(): string {
  return new Date().toISOString();
}

function commandId(tag: string): CommandId {
  return CommandId.makeUnsafe(`beads:${tag}:${crypto.randomUUID()}`);
}

function messageId(tag: string): MessageId {
  return MessageId.makeUnsafe(`beads:${tag}:${crypto.randomUUID()}`);
}

function threadId(): ThreadId {
  return ThreadId.makeUnsafe(crypto.randomUUID());
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function errorMessageFromCause(cause: unknown): string {
  if (Cause.isCause(cause)) {
    const squashed = Cause.squash(cause);
    return squashed instanceof Error ? squashed.message : String(squashed);
  }
  return errorDetailFromUnknown(cause) ?? String(cause);
}

function errorDetailFromUnknown(cause: unknown): string | null {
  if (cause instanceof Error) {
    return trimToNull(cause.message);
  }
  if (typeof cause === "string") {
    return trimToNull(cause);
  }
  if (cause === null || cause === undefined) {
    return null;
  }
  try {
    return trimToNull(String(cause));
  } catch {
    return null;
  }
}

function truncateForTrace(value: string, limit = BD_COMMAND_PREVIEW_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function summarizeBdValue(flag: string | null, value: string): string {
  if (flag === "--title" || flag === "--description" || flag === "--notes") {
    return `<${flag.slice(2)}:${value.length}>`;
  }
  if (value.length <= 80) {
    return value;
  }
  return `${value.slice(0, 77)}...`;
}

function summarizeBdArgs(args: ReadonlyArray<string>): string {
  const summary: string[] = [];
  const action = args[0] ?? "unknown";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const previous = index > 0 ? (args[index - 1] ?? null) : null;

    if (action === "comment" && index === 2) {
      summary.push(`<text:${arg.length}>`);
      continue;
    }

    if (action === "create" && index === 1) {
      summary.push(`<title:${arg.length}>`);
      continue;
    }

    if (previous && previous.startsWith("--")) {
      summary.push(summarizeBdValue(previous, arg));
      continue;
    }

    summary.push(arg.length <= 80 ? arg : `${arg.slice(0, 77)}...`);
  }

  return truncateForTrace(summary.join(" "));
}

function getBdSubject(args: ReadonlyArray<string>): string | null {
  const action = args[0] ?? "unknown";
  const startIndex = 1;

  for (let index = startIndex; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--")) {
      continue;
    }
    const previous = index > 0 ? args[index - 1] : null;
    if (previous?.startsWith("--")) {
      continue;
    }
    if ((action === "comment" && index === 2) || (action === "create" && index === 1)) {
      continue;
    }
    return trimToNull(arg);
  }

  return null;
}

function getBdCommandDetails(args: ReadonlyArray<string>): BdCommandDetails {
  const action = trimToNull(args[0]) ?? "unknown";
  const subcommand = null;
  return {
    action,
    subcommand,
    commandFamily: subcommand ? `${action}.${subcommand}` : action,
    subject: getBdSubject(args),
    preview: summarizeBdArgs(args),
    argCount: args.length,
  };
}

function stableCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableCacheValue);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableCacheValue(entryValue)]),
  );
}

function stableCacheJson(value: unknown): string {
  return JSON.stringify(stableCacheValue(value));
}

function makeBdShowIssueArgs(issueIds: ReadonlyArray<string>): ReadonlyArray<string> {
  return issueIds.map((issueId) => (issueId.startsWith("-") ? `--id=${issueId}` : issueId));
}

function recordBdCommandMetrics(input: {
  readonly action: string;
  readonly commandFamily: string;
  readonly routing: string;
  readonly strategySource: string;
  readonly readOnly: boolean;
  readonly executionStrategy?: BdExecutionStrategy | "unknown";
  readonly outcome: BdProcessOutcome;
  readonly durationMs: number;
}): Effect.Effect<void, never, never> {
  const attributes = {
    action: input.action,
    commandFamily: input.commandFamily,
    routing: input.routing,
    strategySource: input.strategySource,
    readOnly: input.readOnly,
    executionStrategy: input.executionStrategy,
    outcome: input.outcome,
  };

  return Effect.gen(function* () {
    yield* Metric.update(
      Metric.withAttributes(beadsCommandDuration, metricAttributes(attributes)),
      Duration.millis(Math.max(0, input.durationMs)),
    );
    yield* Metric.update(
      Metric.withAttributes(beadsCommandsTotal, metricAttributes(attributes)),
      1,
    );
  });
}

function logBdCommandResult(input: {
  readonly cwd: string;
  readonly details: BdCommandDetails;
  readonly trace: BdTraceContext;
  readonly outcome: BdProcessOutcome;
  readonly durationMs: number;
  readonly result?: Awaited<ReturnType<typeof runProcess>>;
  readonly error?: string;
}): Effect.Effect<void, never, never> {
  const context = {
    cwd: input.cwd,
    command: input.details.preview,
    action: input.details.action,
    commandFamily: input.details.commandFamily,
    subject: input.details.subject,
    argCount: input.details.argCount,
    routing: input.trace.routing,
    strategySource: input.trace.strategySource,
    executionStrategy: input.trace.executionStrategy,
    readOnly: input.trace.readOnly,
    durationMs: input.durationMs,
    outcome: input.outcome,
    code: input.result?.code,
    signal: input.result?.signal,
    timedOut: input.result?.timedOut,
    stdoutBytes: input.result ? Buffer.byteLength(input.result.stdout) : undefined,
    stderrBytes: input.result ? Buffer.byteLength(input.result.stderr) : undefined,
    stdoutTruncated: input.result?.stdoutTruncated ?? false,
    stderrTruncated: input.result?.stderrTruncated ?? false,
    error: input.error,
  };

  const effect =
    input.outcome === "success" && input.durationMs < SLOW_BD_COMMAND_WARN_MS
      ? Effect.logDebug("bd command completed", context)
      : Effect.logWarning(
          input.outcome === "success" ? "slow bd command completed" : "bd command failed",
          context,
        );

  return effect.pipe(Effect.annotateLogs({ scope: BD_LOG_SCOPE }));
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = asRecord(entry);
        return record ? [record] : [];
      })
    : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function toBeadsError(message: string, cause?: unknown): BeadsError {
  return new BeadsError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function summarizeBdStdout(stdout: string): string {
  const singleLine = stdout.trim().replace(/\s+/g, " ");
  if (singleLine.length <= 160) {
    return singleLine;
  }
  return `${singleLine.slice(0, 157)}...`;
}

function tryParseJsonText(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(text),
    };
  } catch {
    return { ok: false };
  }
}

function extractBalancedJsonPayload(stdout: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < stdout.length; index += 1) {
    const char = stdout[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) {
        return null;
      }
      if (depth === 0) {
        return stdout.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseBdJsonStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("bd produced empty stdout.");
  }

  const direct = tryParseJsonText(trimmed);
  if (direct.ok) {
    return direct.value;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (char !== "{" && char !== "[") {
      continue;
    }

    const candidate = extractBalancedJsonPayload(trimmed, index);
    if (!candidate) {
      continue;
    }

    const parsed = tryParseJsonText(candidate);
    if (parsed.ok) {
      return parsed.value;
    }
  }

  throw new Error(`bd produced non-JSON stdout: ${summarizeBdStdout(trimmed)}`);
}

function toBdJsonParseError(cause: unknown): BeadsError {
  const detail = errorDetailFromUnknown(cause);
  return toBeadsError(
    detail ? `Failed to parse beads JSON output: ${detail}` : "Failed to parse beads JSON output.",
    cause,
  );
}

function parseBdErrorMessage(stdout: string): string | null {
  try {
    const parsed = asRecord(parseBdJsonStdout(stdout));
    return parsed ? trimToNull(parsed.error) : null;
  } catch {
    return null;
  }
}

function compareIssueSummaries(
  left: BeadsIssueSummaryType,
  right: BeadsIssueSummaryType,
  sortBy: BeadsQueryIssuesInput["sortBy"],
): number {
  if (sortBy === "priority") {
    const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return left.id.localeCompare(right.id);
  }

  if (sortBy === "created") {
    const createdAtDelta = right.createdAt.localeCompare(left.createdAt);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }

    const titleDelta = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (titleDelta !== 0) {
      return titleDelta;
    }

    return left.id.localeCompare(right.id);
  }

  if (sortBy === "title") {
    const titleDelta = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (titleDelta !== 0) {
      return titleDelta;
    }

    const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return left.id.localeCompare(right.id);
  }

  const updatedDelta = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const titleDelta = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  if (titleDelta !== 0) {
    return titleDelta;
  }

  return left.id.localeCompare(right.id);
}

function mapParentRef(
  raw: Record<string, unknown>,
  issueTitleById?: ReadonlyMap<string, string>,
): {
  id: string;
  title: string;
} | null {
  const parentId = trimToNull(raw.parent_id) ?? trimToNull(raw.parent);
  if (!parentId) return null;
  const parentTitle =
    typeof raw.parent_title === "string" && raw.parent_title.trim().length > 0
      ? raw.parent_title.trim()
      : (issueTitleById?.get(parentId) ?? parentId);
  return { id: parentId, title: parentTitle };
}

function mapIssueRelationSummary(
  raw: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): BeadsIssueRelationSummaryType {
  const merged = fallback ? { ...fallback, ...raw } : raw;
  return decodeIssueRelationSummary({
    id: merged.id,
    title: merged.title,
    status: merged.status,
    priority: asNumber(merged.priority),
    issueType: merged.issue_type,
    assignee: trimToNull(merged.assignee),
    owner: trimToNull(merged.owner),
    parent: mapParentRef(merged),
  });
}

function mapIssueRelationArray(
  value: unknown,
  fallbackById?: ReadonlyMap<string, Record<string, unknown>>,
): BeadsIssueRelationSummaryType[] {
  return asRecordArray(value).map((entry) => {
    const issueId = trimToNull(entry.id);
    return mapIssueRelationSummary(entry, issueId ? fallbackById?.get(issueId) : undefined);
  });
}

function sortChildIssueRelationsByDependencies(input: {
  readonly children: readonly BeadsIssueRelationSummaryType[];
  readonly childDetailsById: ReadonlyMap<
    string,
    Pick<BeadsIssueDetailType, "createdAt" | "dependencies">
  >;
}): BeadsIssueRelationSummaryType[] {
  return topologicallySortByDependencies({
    items: input.children,
    getId: (issue) => issue.id,
    getCreatedAt: (issue) => input.childDetailsById.get(issue.id)?.createdAt ?? null,
    getTitle: (issue) => issue.title,
    getPredecessorIds: (issue, siblingIds) => {
      const detail = input.childDetailsById.get(issue.id);
      if (!detail) {
        return [];
      }

      return detail.dependencies.flatMap((dependency) => {
        if (!siblingIds.has(dependency.id)) {
          return [];
        }

        switch (dependency.dependencyType) {
          case "blocked_by":
          case "depends_on":
          case "blocks":
            // `bd show <issue> --long` returns dependencies from the current issue's
            // point of view: each listed sibling is a prerequisite for this issue,
            // even when the edge label itself is `blocks`.
            return [dependency.id];
          default:
            return [];
        }
      });
    },
  });
}

function mapBeadsContext(raw: Record<string, unknown>): BeadsContextType {
  return decodeBeadsContext({
    beadsDir: raw.beads_dir,
    repoRoot: raw.repo_root,
    cwdRepoRoot: trimToNull(raw.cwd_repo_root),
    isRedirected: asBoolean(raw.is_redirected) ?? false,
    isWorktree: asBoolean(raw.is_worktree) ?? false,
    backend: {
      kind: raw.backend,
      doltMode: trimToNull(raw.dolt_mode),
      database: trimToNull(raw.database),
      projectId: trimToNull(raw.project_id),
      role: trimToNull(raw.role),
      bdVersion: trimToNull(raw.bd_version),
    },
  });
}

function isHiddenSwarmMolecule(
  issue: Pick<BeadsIssueSummaryType, "issueType" | "molType">,
): boolean {
  return issue.issueType === "molecule" && issue.molType === "swarm";
}

function isReadOnlyBdCommand(args: ReadonlyArray<string>): boolean {
  const action = args[0];
  if (
    action === "show" ||
    action === "comments" ||
    action === "history" ||
    action === "list" ||
    action === "context"
  ) {
    return true;
  }

  return false;
}

function isBdContextCommand(args: ReadonlyArray<string>): boolean {
  return args[0] === "context";
}

function parseBdExecutionStrategyFromContextStdout(stdout: string): BdExecutionStrategy | null {
  try {
    const record = asRecord(parseBdJsonStdout(stdout));
    if (!record) {
      return null;
    }

    const context = mapBeadsContext(record);
    return context.backend.kind === "dolt" && context.backend.doltMode === "server"
      ? "parallel"
      : "serial";
  } catch {
    return null;
  }
}

function mapIssueSummary(
  raw: Record<string, unknown>,
  issueTitleById?: ReadonlyMap<string, string>,
): BeadsIssueSummaryType {
  return decodeIssueSummary({
    id: raw.id,
    title: raw.title,
    description: asOptionalString(raw.description) ?? null,
    notes: asOptionalString(raw.notes) ?? null,
    status: raw.status,
    priority: typeof raw.priority === "number" ? raw.priority : null,
    issueType: raw.issue_type,
    assignee: trimToNull(raw.assignee),
    owner: trimToNull(raw.owner),
    createdAt: raw.created_at,
    createdBy: trimToNull(raw.created_by),
    updatedAt: raw.updated_at,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    molType: trimToNull(raw.mol_type),
    parent: mapParentRef(raw, issueTitleById),
    dependencyRefs: asRecordArray(raw.dependencies).flatMap((entry) => {
      const issueId = trimToNull(entry.issue_id);
      const dependsOnId = trimToNull(entry.depends_on_id);
      const dependencyType = trimToNull(entry.type) ?? trimToNull(entry.dependency_type);
      if (!issueId || !dependsOnId || !dependencyType) {
        return [];
      }

      return [{ issueId, dependsOnId, dependencyType }] as const;
    }),
    dependencyCount: typeof raw.dependency_count === "number" ? raw.dependency_count : undefined,
    dependentCount: typeof raw.dependent_count === "number" ? raw.dependent_count : undefined,
    commentCount: typeof raw.comment_count === "number" ? raw.comment_count : undefined,
  });
}

function mapIssueReferenceSummary(issue: BeadsIssueSummaryType): BeadsIssueReferenceSummaryType {
  return decodeIssueReferenceSummary({
    id: issue.id,
    title: issue.title,
    status: issue.status,
    issueType: issue.issueType,
  });
}

function buildIssueTitleMap(
  rawIssues: ReadonlyArray<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const entries = rawIssues.flatMap((rawIssue) => {
    const id = trimToNull(rawIssue.id);
    const title = trimToNull(rawIssue.title);
    return id && title ? ([[id, title]] as const) : [];
  });
  return new Map(entries);
}

function matchesIssueSummary(issue: BeadsIssueSummaryType, input: BeadsQueryIssuesInput): boolean {
  if (input.statuses && input.statuses.length > 0 && !input.statuses.includes(issue.status)) {
    return false;
  }

  if (
    input.issueTypes &&
    input.issueTypes.length > 0 &&
    !input.issueTypes.some((issueType) => issueType === issue.issueType)
  ) {
    return false;
  }

  if (
    input.priorities &&
    input.priorities.length > 0 &&
    (issue.priority === null || !input.priorities.includes(issue.priority))
  ) {
    return false;
  }

  if (!input.search) {
    return true;
  }

  const search = input.search.trim().toLowerCase();
  if (search.length === 0) {
    return true;
  }

  return [issue.title, issue.description, issue.notes].some(
    (value) => typeof value === "string" && value.toLowerCase().includes(search),
  );
}

function getBdDependencyType(raw: Record<string, unknown>): string | null {
  return trimToNull(raw.dependency_type) ?? trimToNull(raw.type);
}

function mapIssueDependency(raw: Record<string, unknown>): BeadsIssueDependency {
  return {
    id: String(raw.id),
    title: String(raw.title),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    status: String(raw.status),
    priority: typeof raw.priority === "number" ? raw.priority : null,
    issueType: String(raw.issue_type),
    owner: trimToNull(raw.owner),
    createdAt: String(raw.created_at),
    createdBy: trimToNull(raw.created_by),
    updatedAt: String(raw.updated_at),
    dependencyType: getBdDependencyType(raw) ?? "unknown",
  };
}

function mapIssueComment(raw: Record<string, unknown>): BeadsIssueComment {
  return {
    id: String(raw.id),
    issueId: String(raw.issue_id),
    author: trimToNull(raw.author),
    text: typeof raw.text === "string" ? raw.text : "",
    createdAt: String(raw.created_at),
  };
}

function mapIssueDetail(
  rawIssue: Record<string, unknown>,
  comments: ReadonlyArray<Record<string, unknown>>,
): BeadsIssueDetailType {
  return decodeIssueDetail({
    ...mapIssueSummary(rawIssue),
    dependencies: Array.isArray(rawIssue.dependencies)
      ? rawIssue.dependencies.map((entry) => mapIssueDependency(entry as Record<string, unknown>))
      : [],
    comments: comments.map(mapIssueComment),
  });
}

function buildIssueLink(issue: BeadsIssueSummaryType, cwd: string) {
  return {
    issueId: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    repoRoot: path.resolve(cwd),
    linkedAt: nowIso(),
  };
}

function buildWorkflowThreadTitle(
  issue: BeadsIssueSummaryType,
  workflow: BeadsStartWorkflowInput["workflow"],
): string {
  if (workflow === "plan-implementation") {
    return `${issue.id}: ${issue.title} (Planned implementation)`;
  }

  return `${issue.id}: ${issue.title}`;
}

function buildWorkflowPrompt(
  issue: Pick<BeadsIssueDetailType, "id" | "title">,
  workflow: BeadsStartWorkflowInput["workflow"],
): string {
  if (workflow === "refine") {
    return [
      "## Assignment",
      "",
      `Refine issue ${issue.id}: ${issue.title}`,
      "",
      "## Getting started",
      "",
      `Run \`bd show ${issue.id}\` to read the full issue details, including description, notes, dependencies, and comments.`,
      "",
      "## Instructions",
      "",
      "- Analyze the issue and refine it into an implementation-ready plan.",
      "- Clarify scope, risks, assumptions, and acceptance criteria.",
      "- Propose a concrete implementation approach with clear sequencing.",
      "- Do NOT implement code. Your output is the plan itself.",
      "- Update the issue in beads with your refined plan using `bd update`.",
    ].join("\n");
  }

  if (workflow === "plan-implementation") {
    return [
      "## Assignment",
      "",
      `Produce a concrete implementation plan for issue ${issue.id}: ${issue.title}`,
      "",
      "## Getting started",
      "",
      `Run \`bd show ${issue.id}\` to read the full issue details, including description, notes, dependencies, and comments.`,
      "",
      "## Instructions",
      "",
      "- Create an implementation-ready plan with scope, sequencing, risks, assumptions, and acceptance criteria.",
      "- Do NOT implement code yet. Your output is the plan itself.",
      "- Identify any tracker follow-up that should be recorded before coding starts.",
      "- Update beads with your plan and any new issues using `bd`.",
    ].join("\n");
  }

  if (workflow === "solve") {
    return [
      "## Assignment",
      "",
      `Implement issue ${issue.id}: ${issue.title}`,
      "",
      "## Getting started",
      "",
      `Run \`bd show ${issue.id}\` to read the full issue details, including description, notes, dependencies, and comments.`,
      "Understand the requirements thoroughly before writing any code.",
      "",
      "## Rules",
      "",
      "- Stay focused on this issue. Do not work on unrelated changes.",
      "- Follow the project's existing patterns, conventions, and quality standards.",
      "- Commit your work with clear, descriptive commit messages.",
      "- When done, push your commits: `git pull --rebase && git push`.",
      "",
      "## Completion",
      "",
      `- When finished, close the issue with \`bd close ${issue.id}\`.`,
      "- If you discover follow-up work that is out of scope, file new issues with `bd` rather than expanding scope.",
    ].join("\n");
  }

  // "continue" workflow
  return [
    "## Assignment",
    "",
    `Continue working on issue ${issue.id}: ${issue.title}`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${issue.id}\` to read the current issue state and any recent comments or updates.`,
    "Review the existing thread context to understand what has already been done.",
    "",
    "## Rules",
    "",
    "- Make forward progress on the issue.",
    "- Stay focused. Do not expand scope beyond what the issue requires.",
    "- Commit and push your work when done.",
    "- If you discover follow-up work, file new issues with `bd`.",
  ].join("\n");
}

function buildBacklogGroomingThreadTitle(): string {
  return "Backlog grooming";
}

function buildBacklogGroomingPrompt(): string {
  return [
    "## Assignment",
    "",
    "Review and improve the project backlog so it is clear, properly scoped, and sequenced for execution.",
    "",
    "## Getting started",
    "",
    "- Use `bd` directly to inspect and update the tracker.",
    "- Start with commands like `bd ready`, `bd blocked`, `bd list --status=open`, `bd lint`, and `bd show <issue-id>`.",
    "",
    "## Instructions",
    "",
    "- Clarify vague issues so they become executable work with concrete scope and acceptance criteria.",
    "- Split oversized work when needed and file follow-up issues instead of silently expanding scope.",
    "- Repair or add dependency edges when the intended sequencing is clear.",
    "- Identify decision-shaped issues and either rewrite them into actionable work or ask for operator input when intent is unclear.",
    "- Prefer making concrete tracker updates with `bd` over only describing what should change.",
    "- Keep this tracker-only: do NOT implement application code, do NOT edit repository files, and do NOT create branches or worktrees.",
    "- Use plan mode interactively: if a tracker change would be ambiguous or risky, pause and ask for clarification before making it.",
  ].join("\n");
}

function compareLinkedIssueThreads(
  left: ProjectionLinkedIssueThread,
  right: ProjectionLinkedIssueThread,
): number {
  const archivedDelta = Number(left.archivedAt !== null) - Number(right.archivedAt !== null);
  if (archivedDelta !== 0) {
    return archivedDelta;
  }

  const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function findReusableLinkedIssueThread(input: {
  readonly threads: ReadonlyArray<ProjectionLinkedIssueThread>;
  readonly projectId: BeadsStartWorkflowInput["projectId"];
  readonly issueId: string;
  readonly interactionMode?: "default" | "plan";
  readonly threadTitle?: string;
  readonly allowArchived: boolean;
}): ProjectionLinkedIssueThread | null {
  return (
    input.threads
      .filter(
        (thread) =>
          thread.projectId === input.projectId &&
          thread.deletedAt === null &&
          thread.issueLink?.issueId === input.issueId &&
          (input.allowArchived || thread.archivedAt === null) &&
          (input.interactionMode === undefined ||
            thread.interactionMode === input.interactionMode) &&
          (input.threadTitle === undefined || thread.title === input.threadTitle),
      )
      .toSorted(compareLinkedIssueThreads)[0] ?? null
  );
}

function buildEpicQuickRefineThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Quick refine)`;
}

function buildEpicPlannedRefineThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Planned refine)`;
}

function buildEpicCoordinationPrepThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Coordination prep)`;
}

function buildEpicRefinePrompt(
  issue: Pick<BeadsIssueDetailType, "id" | "title">,
  mode: "quick" | "planned",
): string {
  if (mode === "quick") {
    return [
      "## Assignment",
      "",
      `Refine epic ${issue.id}: ${issue.title}`,
      "",
      "## Getting started",
      "",
      `Run \`bd show ${issue.id}\` to read the full epic details, including description, child issues, dependencies, and comments.`,
      "",
      "## Instructions",
      "",
      "- Break the epic into concrete, well-scoped child issues using `bd`.",
      "- Capture sequencing and dependency relationships between child issues.",
      "- Identify blockers and risks.",
      "- Record all tracker updates directly in beads -- do not just describe them, execute them.",
      "- Do NOT implement code. This is tracker-only refinement work.",
    ].join("\n");
  }

  // "planned" mode
  return [
    "## Assignment",
    "",
    `Produce a tracker refinement plan for epic ${issue.id}: ${issue.title}`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${issue.id}\` to read the full epic details, including description, child issues, dependencies, and comments.`,
    "",
    "## Instructions",
    "",
    "- Generate a concrete refinement plan that can be applied back into beads later.",
    "- Propose child issues, dependencies, sequencing, and any tracker updates.",
    "- Do NOT implement code. Do NOT execute tracker changes yet -- produce the plan only.",
    "- The plan should be detailed enough to apply mechanically.",
  ].join("\n");
}

function formatIssueRelationList(issues: ReadonlyArray<BeadsIssueRelationSummaryType>): string {
  if (issues.length === 0) {
    return "None";
  }

  return issues.map((issue) => `- ${issue.id}: ${issue.title} [${issue.status}]`).join("\n");
}

function buildEpicCoordinationPrepPrompt(input: {
  issue: Pick<BeadsIssueDetailType, "id" | "title">;
  validation: BeadsEpicCoordinationValidationType;
  status: BeadsEpicCoordinationStatusType;
}): string {
  const validationErrors =
    input.validation.errors.length > 0
      ? input.validation.errors.map((error) => `- ${error}`).join("\n")
      : "None";

  const validationWarnings =
    input.validation.warnings.length > 0
      ? input.validation.warnings.map((warning) => `- ${warning}`).join("\n")
      : "None";

  const readyIssues = formatIssueRelationList(input.status.ready);
  const activeIssues = formatIssueRelationList(input.status.active);
  const blockedIssues = formatIssueRelationList(input.status.blocked);

  return [
    "## Assignment",
    "",
    `Prepare epic ${input.issue.id}: ${input.issue.title} for coordinated execution`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${input.issue.id}\` to read the full epic details, including description, child issues, and dependencies.`,
    "",
    "## Current coordination graph",
    "",
    `Validation errors: ${validationErrors}`,
    `Validation warnings: ${validationWarnings}`,
    `Ready issues: ${readyIssues}`,
    `Active issues: ${activeIssues}`,
    `Blocked issues: ${blockedIssues}`,
    "",
    "## Instructions",
    "",
    "- This is tracker-only coordination work. Fix the epic structure so it is ready for coordinated execution.",
    "- Use `bd` to refine child issues, dependencies, and sequencing so the direct-child graph is launchable.",
    "- Do NOT implement application code. Do NOT create a worktree.",
    "- When finished, summarize the resulting coordination graph and any blockers that still prevent launching worker threads.",
  ].join("\n");
}

const makeBeadsTrackerService = Effect.gen(function* () {
  const bdLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const bdExecutionStrategiesRef = yield* Ref.make(new Map<string, BdExecutionStrategy>());
  const bdExecutionStrategyDeferredsRef = yield* SynchronizedRef.make(
    new Map<string, Deferred.Deferred<BdExecutionStrategy, BeadsError>>(),
  );
  const readCacheRef = yield* SynchronizedRef.make(
    new Map<string, Deferred.Deferred<unknown, BeadsError>>(),
  );
  yield* Effect.sync(() => {
    beadsReadCacheRefs.add(readCacheRef);
  });

  const getBdKey = (cwd: string) => path.resolve(cwd);
  const getReadCacheKey = (input: {
    readonly cwd: string;
    readonly name: string;
    readonly params?: unknown;
  }): string => `${getBdKey(input.cwd)}:${input.name}:${stableCacheJson(input.params ?? {})}`;

  const getOrLoadCoalescedRead = <A>(
    input: {
      readonly cwd: string;
      readonly name: string;
      readonly params?: unknown;
    },
    load: Effect.Effect<A, BeadsError>,
  ): Effect.Effect<A, BeadsError> =>
    Effect.gen(function* () {
      const key = getReadCacheKey(input);
      const newDeferred = yield* Deferred.make<unknown, BeadsError>();
      const cwd = getBdKey(input.cwd);
      const reservation = yield* SynchronizedRef.modify(
        readCacheRef,
        (
          current,
        ): readonly [
          {
            readonly deferred: Deferred.Deferred<unknown, BeadsError>;
            readonly created: boolean;
          },
          Map<string, Deferred.Deferred<unknown, BeadsError>>,
        ] => {
          const existing = current.get(key);
          if (existing) {
            return [{ deferred: existing, created: false }, current] as const;
          }
          return [
            { deferred: newDeferred, created: true },
            new Map(current).set(key, newDeferred),
          ] as const;
        },
      );

      if (!reservation.created) {
        yield* Effect.logDebug("beads read coalesced", {
          name: input.name,
          cwd,
        }).pipe(Effect.annotateLogs({ scope: BD_LOG_SCOPE }));
        return (yield* Deferred.await(reservation.deferred)) as A;
      }

      yield* Effect.logDebug("beads read started", {
        name: input.name,
        cwd,
      }).pipe(Effect.annotateLogs({ scope: BD_LOG_SCOPE }));

      const exit = yield* Effect.exit(load);
      if (exit._tag === "Success") {
        yield* SynchronizedRef.update(readCacheRef, (current) => {
          const next = new Map(current);
          next.delete(key);
          return next;
        });
        yield* Deferred.succeed(reservation.deferred, exit.value).pipe(Effect.orDie);
        return exit.value;
      }

      yield* SynchronizedRef.update(readCacheRef, (current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
      yield* Deferred.failCause(reservation.deferred, exit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(exit.cause);
    });

  const getBdSemaphore = (cwd: string): Effect.Effect<Semaphore.Semaphore> =>
    SynchronizedRef.modifyEffect(bdLocksRef, (current) => {
      const key = getBdKey(cwd);
      const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(current.get(key));
      return Option.match(existing, {
        onNone: () =>
          Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(key, semaphore);
              return [semaphore, next] as const;
            }),
          ),
        onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
      });
    });

  const withSerializedBdAccess = <A, E>(cwd: string, effect: Effect.Effect<A, E>) =>
    Effect.flatMap(getBdSemaphore(cwd), (semaphore) => semaphore.withPermit(effect));

  const getCachedBdExecutionStrategy = (cwd: string) =>
    Ref.get(bdExecutionStrategiesRef).pipe(
      Effect.map((current) => current.get(getBdKey(cwd)) ?? null),
    );

  const setBdExecutionStrategy = (cwd: string, strategy: BdExecutionStrategy) =>
    Ref.update(bdExecutionStrategiesRef, (current) => {
      const next = new Map(current);
      next.set(getBdKey(cwd), strategy);
      return next;
    });

  const getOrCreateBdExecutionStrategyDeferred = (
    cwd: string,
  ): Effect.Effect<BdExecutionStrategyReservation> =>
    SynchronizedRef.modifyEffect(
      bdExecutionStrategyDeferredsRef,
      (
        current,
      ): Effect.Effect<
        readonly [
          BdExecutionStrategyReservation,
          Map<string, Deferred.Deferred<BdExecutionStrategy, BeadsError>>,
        ]
      > => {
        const key = getBdKey(cwd);
        const existing = current.get(key);
        if (existing) {
          return Effect.succeed([{ deferred: existing, created: false }, current] as const);
        }

        return Deferred.make<BdExecutionStrategy, BeadsError>().pipe(
          Effect.map((deferred) => {
            const next = new Map(current);
            next.set(key, deferred);
            return [{ deferred, created: true }, next] as const;
          }),
        );
      },
    );

  const clearBdExecutionStrategyDeferred = (cwd: string) =>
    SynchronizedRef.modify(bdExecutionStrategyDeferredsRef, (current) => {
      const next = new Map(current);
      next.delete(getBdKey(cwd));
      return [undefined, next] as const;
    });

  const runBdProcess = (
    cwd: string,
    args: ReadonlyArray<string>,
    trace: BdTraceContext,
  ): Effect.Effect<Awaited<ReturnType<typeof runProcess>>, BeadsError> => {
    const details = getBdCommandDetails(args);
    const expectsJsonOutput = args.includes("--json");
    return Effect.gen(function* () {
      const startedAt = Date.now();
      yield* Effect.annotateCurrentSpan({
        "beads.bd.action": details.action,
        "beads.bd.subcommand": details.subcommand,
        "beads.bd.command_family": details.commandFamily,
        "beads.bd.command_preview": details.preview,
        "beads.bd.subject": details.subject,
        "beads.bd.cwd": cwd,
        "beads.bd.arg_count": details.argCount,
        "beads.bd.read_only": trace.readOnly,
        "beads.bd.routing": trace.routing,
        "beads.bd.strategy_source": trace.strategySource,
        "beads.bd.execution_strategy": trace.executionStrategy,
      });

      const exit = yield* Effect.exit(
        Effect.tryPromise({
          try: () =>
            runProcess("bd", args, {
              cwd,
              allowNonZeroExit: true,
              outputMode: expectsJsonOutput ? "error" : "truncate",
              maxBufferBytes: expectsJsonOutput ? MAX_BD_JSON_OUTPUT_BYTES : MAX_BD_OUTPUT_BYTES,
            }),
          catch: (cause) => {
            const detail = errorDetailFromUnknown(cause);
            return toBeadsError(
              detail ? `Failed to run bd: ${detail}` : "Failed to run bd.",
              cause,
            );
          },
        }),
      );

      const durationMs = Math.max(0, Date.now() - startedAt);
      const outcome: BdProcessOutcome =
        exit._tag === "Failure"
          ? "spawn_error"
          : exit.value.timedOut
            ? "timeout"
            : exit.value.code === 0
              ? "success"
              : "nonzero_exit";

      const result = exit._tag === "Success" ? exit.value : undefined;
      yield* Effect.annotateCurrentSpan({
        "beads.bd.duration_ms": durationMs,
        "beads.bd.outcome": outcome,
        "beads.bd.code": result?.code,
        "beads.bd.signal": result?.signal,
        "beads.bd.timed_out": result?.timedOut,
        "beads.bd.stdout_bytes": result ? Buffer.byteLength(result.stdout) : undefined,
        "beads.bd.stderr_bytes": result ? Buffer.byteLength(result.stderr) : undefined,
        "beads.bd.stdout_truncated": result?.stdoutTruncated ?? false,
        "beads.bd.stderr_truncated": result?.stderrTruncated ?? false,
        "beads.bd.error": exit._tag === "Failure" ? errorMessageFromCause(exit.cause) : undefined,
      });

      yield* recordBdCommandMetrics({
        action: details.action,
        commandFamily: details.commandFamily,
        routing: trace.routing,
        strategySource: trace.strategySource,
        readOnly: trace.readOnly,
        outcome,
        durationMs,
        ...(trace.executionStrategy !== undefined
          ? { executionStrategy: trace.executionStrategy }
          : {}),
      });
      yield* logBdCommandResult({
        cwd,
        details,
        trace,
        outcome,
        durationMs,
        ...(result ? { result } : {}),
        ...(exit._tag === "Failure" ? { error: errorMessageFromCause(exit.cause) } : {}),
      });

      if (exit._tag === "Success") {
        return exit.value;
      }

      return yield* Effect.failCause(exit.cause);
    }).pipe(
      Effect.withSpan("beads.bd.command", {
        kind: "client",
        attributes: {
          "beads.bd.command_family": details.commandFamily,
          "beads.bd.action": details.action,
          "beads.bd.read_only": trace.readOnly,
          "beads.bd.routing": trace.routing,
        },
      }),
    );
  };

  const decodeBdProcessResult = (
    result: Awaited<ReturnType<typeof runProcess>>,
  ): Effect.Effect<string, BeadsError> => {
    if (result.timedOut) {
      return Effect.fail(toBeadsError("Beads command timed out."));
    }

    if (result.code !== 0) {
      const stdout = result.stdout.trim();
      const parsedMessage = parseBdErrorMessage(stdout);
      if (parsedMessage) {
        return Effect.fail(toBeadsError(parsedMessage));
      }

      const detail =
        trimToNull(result.stderr) ?? trimToNull(result.stdout) ?? "Beads command failed.";
      return Effect.fail(toBeadsError(detail));
    }

    return Effect.succeed(result.stdout);
  };

  const runBdRawProcess = (
    cwd: string,
    args: ReadonlyArray<string>,
    trace: BdTraceContext,
  ): Effect.Effect<string, BeadsError> =>
    runBdProcess(cwd, args, trace).pipe(Effect.flatMap((result) => decodeBdProcessResult(result)));

  const resolveBdExecutionStrategy: (
    cwd: string,
  ) => Effect.Effect<BdExecutionStrategy, BeadsError> = Effect.fn(
    "BeadsService.resolveBdExecutionStrategy",
  )(function* (cwd: string) {
    const cached = yield* getCachedBdExecutionStrategy(cwd);
    if (cached) {
      return cached;
    }

    const { deferred, created } = yield* getOrCreateBdExecutionStrategyDeferred(cwd);
    if (!created) {
      return yield* Deferred.await(deferred);
    }

    const exit = yield* Effect.exit(
      withSerializedBdAccess(
        cwd,
        runBdRawProcess(cwd, ["context", "--json"], {
          readOnly: true,
          routing: "serialized.resolve_strategy",
          strategySource: "resolve",
          executionStrategy: "unknown",
        }),
      ).pipe(
        Effect.flatMap((stdout) => {
          const strategy = parseBdExecutionStrategyFromContextStdout(stdout) ?? "serial";
          return setBdExecutionStrategy(cwd, strategy).pipe(Effect.as(strategy));
        }),
      ),
    );

    yield* clearBdExecutionStrategyDeferred(cwd);

    if (exit._tag === "Success") {
      yield* Deferred.succeed(deferred, exit.value).pipe(Effect.orDie);
      return exit.value;
    }

    yield* Deferred.failCause(deferred, exit.cause).pipe(Effect.orDie);
    return yield* Effect.failCause(exit.cause);
  });

  const runBdRaw: (cwd: string, args: ReadonlyArray<string>) => Effect.Effect<string, BeadsError> =
    Effect.fn("BeadsService.runBdRaw")(function* (cwd: string, args: ReadonlyArray<string>) {
      // Writes stay serialized, and reads only bypass the repo lock when beads explicitly reports
      // server mode. Embedded mode remains single-request because the backend is not concurrency-safe.
      if (!isReadOnlyBdCommand(args)) {
        return yield* withSerializedBdAccess(
          cwd,
          runBdRawProcess(cwd, args, {
            readOnly: false,
            routing: "serialized.write",
            strategySource: "write",
          }),
        );
      }

      if (isBdContextCommand(args)) {
        const cached = yield* getCachedBdExecutionStrategy(cwd);
        if (cached) {
          return yield* (
            cached === "parallel"
              ? runBdRawProcess(cwd, args, {
                  readOnly: true,
                  routing: "parallel.context",
                  strategySource: "cached",
                  executionStrategy: cached,
                })
              : withSerializedBdAccess(
                  cwd,
                  runBdRawProcess(cwd, args, {
                    readOnly: true,
                    routing: "serialized.context",
                    strategySource: "cached",
                    executionStrategy: cached,
                  }),
                )
          ).pipe(
            Effect.tap((stdout) => {
              const strategy = parseBdExecutionStrategyFromContextStdout(stdout);
              return strategy ? setBdExecutionStrategy(cwd, strategy) : Effect.void;
            }),
          );
        }

        const { deferred, created } = yield* getOrCreateBdExecutionStrategyDeferred(cwd);
        if (!created) {
          const strategy = yield* Deferred.await(deferred);
          return yield* strategy === "parallel"
            ? runBdRawProcess(cwd, args, {
                readOnly: true,
                routing: "parallel.context",
                strategySource: "deferred",
                executionStrategy: strategy,
              })
            : withSerializedBdAccess(
                cwd,
                runBdRawProcess(cwd, args, {
                  readOnly: true,
                  routing: "serialized.context",
                  strategySource: "deferred",
                  executionStrategy: strategy,
                }),
              );
        }

        const exit = yield* Effect.exit(
          withSerializedBdAccess(
            cwd,
            runBdRawProcess(cwd, args, {
              readOnly: true,
              routing: "serialized.context",
              strategySource: "context",
              executionStrategy: "unknown",
            }),
          ).pipe(
            Effect.flatMap((stdout) => {
              const strategy = parseBdExecutionStrategyFromContextStdout(stdout) ?? "serial";
              return setBdExecutionStrategy(cwd, strategy).pipe(
                Effect.as({ stdout, strategy } as const),
              );
            }),
          ),
        );

        yield* clearBdExecutionStrategyDeferred(cwd);

        if (exit._tag === "Success") {
          yield* Deferred.succeed(deferred, exit.value.strategy).pipe(Effect.orDie);
          return exit.value.stdout;
        }

        yield* Deferred.failCause(deferred, exit.cause).pipe(Effect.orDie);
        return yield* Effect.failCause(exit.cause);
      }

      const strategy = yield* resolveBdExecutionStrategy(cwd);
      return yield* strategy === "parallel"
        ? runBdRawProcess(cwd, args, {
            readOnly: true,
            routing: "parallel.read",
            strategySource: "resolved",
            executionStrategy: strategy,
          })
        : withSerializedBdAccess(
            cwd,
            runBdRawProcess(cwd, args, {
              readOnly: true,
              routing: "serialized.read",
              strategySource: "resolved",
              executionStrategy: strategy,
            }),
          );
    });

  const runBdJson = <T>(
    cwd: string,
    args: ReadonlyArray<string>,
    map: (json: unknown) => T,
  ): Effect.Effect<T, BeadsError> =>
    runBdRaw(cwd, [...args, "--json"]).pipe(
      Effect.flatMap((stdout) =>
        Effect.try({
          try: () => map(parseBdJsonStdout(stdout)),
          catch: toBdJsonParseError,
        }),
      ),
    );

  const loadRawIssue = (cwd: string, issueId: string) =>
    runBdJson(cwd, ["show", ...makeBdShowIssueArgs([issueId]), "--long"], (json) => {
      const items = Array.isArray(json) ? json : [];
      const issue = items[0] as Record<string, unknown> | undefined;
      if (!issue) {
        throw new Error(`Issue '${issueId}' was not found.`);
      }
      return issue;
    });

  const getRawIssue = (cwd: string, issueId: string) =>
    getOrLoadCoalescedRead(
      {
        cwd,
        name: "raw-issue",
        params: { issueId },
      },
      loadRawIssue(cwd, issueId),
    );

  const getRawIssues = (cwd: string, issueIds: ReadonlyArray<string>) => {
    const uniqueIssueIds = [...new Set(issueIds)];
    if (uniqueIssueIds.length === 0) {
      return Effect.succeed(new Map<string, Record<string, unknown>>());
    }

    return getOrLoadCoalescedRead(
      {
        cwd,
        name: "raw-issues",
        params: { issueIds: uniqueIssueIds.toSorted() },
      },
      runBdJson(cwd, ["show", ...makeBdShowIssueArgs(uniqueIssueIds)], (json) => {
        const issues = asRecordArray(json);
        return new Map(
          issues.flatMap((issue) => {
            const issueId = trimToNull(issue.id);
            return issueId ? ([[issueId, issue]] as const) : [];
          }),
        );
      }),
    );
  };

  const getIssueComments = (cwd: string, issueId: string) =>
    runBdJson(
      cwd,
      ["comments", issueId],
      (json) => (Array.isArray(json) ? json : []) as ReadonlyArray<Record<string, unknown>>,
    );

  const getIssueCommentsOptional = (cwd: string, issueId: string) =>
    getIssueComments(cwd, issueId).pipe(Effect.catch(() => Effect.succeed([])));

  const getIssueDetailWithoutComments = (cwd: string, issueId: string) =>
    getOrLoadCoalescedRead(
      {
        cwd,
        name: "issue-without-comments",
        params: { issueId },
      },
      getRawIssue(cwd, issueId).pipe(Effect.map((issue) => mapIssueDetail(issue, []))),
    );

  const getIssueDetail = (input: BeadsGetIssueInput) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "issue-detail",
        params: { issueId: input.issueId },
      },
      Effect.all(
        [getRawIssue(input.cwd, input.issueId), getIssueCommentsOptional(input.cwd, input.issueId)],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(([issue, comments]) => mapIssueDetail(issue, comments)),
        Effect.mapError((error) =>
          Schema.is(BeadsError)(error)
            ? error
            : toBeadsError("Failed to load issue detail.", error),
        ),
      ),
    );

  const queryIssues: BeadsTrackerServiceShape["queryIssues"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "query-issues",
        params: input,
      },
      runBdJson(
        input.cwd,
        input.mode === "ready" ? ["ready"] : ["list", "--all", "--limit", "0"],
        (json) => {
          const rawIssues = asRecordArray(json);
          const issueTitleById = buildIssueTitleMap(rawIssues);
          const issues = rawIssues
            .map((entry) => mapIssueSummary(entry, issueTitleById))
            .filter((issue) => !isHiddenSwarmMolecule(issue))
            .filter((issue) => matchesIssueSummary(issue, input))
            .toSorted((left, right) => compareIssueSummaries(left, right, input.sortBy))
            .slice(0, 200);
          return {
            issues,
          } satisfies BeadsQueryIssuesResult;
        },
      ),
    );

  const listEpicWorkflowIssues: BeadsTrackerServiceShape["listEpicWorkflowIssues"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "epic-workflow-issues",
      },
      runBdJson(input.cwd, ["list", "--all", "--type", "epic", "--limit", "0"], (json) => {
        const rawIssues = asRecordArray(json);
        const issueTitleById = buildIssueTitleMap(rawIssues);
        return rawIssues
          .map((entry) => mapIssueSummary(entry, issueTitleById))
          .filter((issue) => !isHiddenSwarmMolecule(issue))
          .filter((issue) => issue.status !== "closed")
          .toSorted((left, right) => compareIssueSummaries(left, right, "updated"))
          .slice(0, 200);
      }),
    );

  const getIssue: BeadsTrackerServiceShape["getIssue"] = (input) => getIssueDetail(input);

  const getIssueWithoutComments: BeadsTrackerServiceShape["getIssueWithoutComments"] = (input) =>
    getIssueDetailWithoutComments(input.cwd, input.issueId);

  const getIssueSummaries: BeadsTrackerServiceShape["getIssueSummaries"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "issue-summaries",
        params: { issueIds: [...new Set(input.issueIds)].toSorted() },
      },
      getRawIssues(input.cwd, input.issueIds).pipe(
        Effect.map((rawIssuesById) =>
          input.issueIds.flatMap((issueId) => {
            const rawIssue = rawIssuesById.get(issueId);
            return rawIssue ? [mapIssueSummary(rawIssue)] : [];
          }),
        ),
      ),
    );

  const getIssueSummary: BeadsTrackerServiceShape["getIssueSummary"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "issue-summary",
        params: { issueId: input.issueId },
      },
      getRawIssue(input.cwd, input.issueId).pipe(Effect.map((issue) => mapIssueSummary(issue))),
    );

  const resolveIssueRefs: BeadsTrackerServiceShape["resolveIssueRefs"] = (input) => {
    const uniqueIssueIds = [...new Set(input.issueIds)];
    if (uniqueIssueIds.length > MAX_BEADS_ISSUE_REFS_PER_REQUEST) {
      return Effect.fail(
        toBeadsError(
          `Cannot resolve more than ${MAX_BEADS_ISSUE_REFS_PER_REQUEST} beads issue references per request.`,
        ),
      );
    }

    const resolveOneIssueRef = (issueId: string) =>
      loadRawIssue(input.cwd, issueId).pipe(
        Effect.map((rawIssue) => ({
          kind: "found" as const,
          issue: mapIssueReferenceSummary(mapIssueSummary(rawIssue)),
        })),
        Effect.catch((error) =>
          Effect.succeed({
            kind: "error" as const,
            issueId,
            message: error.message,
          }),
        ),
      );

    return getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "issue-refs",
        params: { issueIds: uniqueIssueIds.toSorted() },
      },
      getRawIssues(input.cwd, uniqueIssueIds).pipe(
        Effect.map((rawIssuesById) => ({
          issues: uniqueIssueIds.flatMap((issueId) => {
            const rawIssue = rawIssuesById.get(issueId);
            return rawIssue ? [mapIssueReferenceSummary(mapIssueSummary(rawIssue))] : [];
          }),
          missingIssueIds: uniqueIssueIds.filter((issueId) => !rawIssuesById.has(issueId)),
          loadErrors: [],
        })),
        Effect.catch(() =>
          Effect.all(uniqueIssueIds.map(resolveOneIssueRef), { concurrency: 10 }).pipe(
            Effect.map((results) => ({
              issues: results.flatMap((result) => (result.kind === "found" ? [result.issue] : [])),
              missingIssueIds: [],
              loadErrors: results.flatMap((result) =>
                result.kind === "error"
                  ? [{ issueId: result.issueId, message: result.message }]
                  : [],
              ),
            })),
          ),
        ),
      ),
    );
  };

  const getEpicIssueSummaries: BeadsTrackerServiceShape["getEpicIssueSummaries"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "epic-issue-summaries",
        params: { epicIssueId: input.epicIssueId },
      },
      Effect.gen(function* () {
        const [rawEpic, issues] = yield* Effect.all(
          [
            getRawIssue(input.cwd, input.epicIssueId),
            runBdJson(
              input.cwd,
              ["list", "--all", "--parent", input.epicIssueId, "--limit", "0"],
              (json) => {
                const rawIssues = asRecordArray(json);
                const issueTitleById = buildIssueTitleMap(rawIssues);
                return rawIssues
                  .map((entry) => mapIssueSummary(entry, issueTitleById))
                  .toSorted((left, right) => compareIssueSummaries(left, right, "updated"))
                  .slice(0, 200);
              },
            ),
          ],
          { concurrency: "unbounded" },
        );

        return decodeEpicIssueSummaries(
          buildEpicIssueSummaries({
            epic: mapIssueSummary(rawEpic),
            issues,
          }),
        );
      }).pipe(
        Effect.mapError((error) =>
          Schema.is(BeadsError)(error)
            ? error
            : toBeadsError("Failed to load epic issue summaries.", error),
        ),
      ),
    );

  const updateIssue: BeadsTrackerServiceShape["updateIssue"] = (input) =>
    Effect.gen(function* () {
      const args = ["update", input.issueId];

      if (input.claim) {
        args.push("--claim");
      }
      if (input.title !== undefined) {
        args.push("--title", input.title);
      }
      if (input.description !== undefined) {
        args.push("--description", input.description);
      }
      if (input.notes !== undefined) {
        args.push("--notes", input.notes);
      }
      if (input.status !== undefined) {
        args.push("--status", input.status);
      }
      if (input.priority !== undefined) {
        args.push("--priority", String(input.priority));
      }
      if (input.assignee !== undefined) {
        args.push("--assignee", input.assignee ?? "");
      }
      if (input.labels !== undefined) {
        if (input.labels.length > 0) {
          for (const label of input.labels) {
            args.push("--set-labels", label);
          }
        } else {
          const current = yield* getIssueSummary({ cwd: input.cwd, issueId: input.issueId });
          for (const label of current.labels) {
            args.push("--remove-label", label);
          }
        }
      }

      const updated = yield* runBdJson(input.cwd, args, (json) => {
        const items = Array.isArray(json) ? json : [];
        const issue = items[0] as Record<string, unknown> | undefined;
        if (!issue) {
          throw new Error(`Issue '${input.issueId}' was not updated.`);
        }
        return mapIssueSummary(issue);
      });
      return updated;
    });

  const createIssue: BeadsTrackerServiceShape["createIssue"] = (input) =>
    Effect.gen(function* () {
      const args = ["create", input.title, "--json"];

      if (input.issueType !== undefined) {
        args.push("--type", input.issueType);
      }
      if (input.description !== undefined) {
        args.push("--description", input.description);
      }
      if (input.priority !== undefined) {
        args.push("--priority", String(input.priority));
      }
      if (input.assignee !== undefined) {
        args.push("--assignee", input.assignee);
      }
      if (input.parent !== undefined) {
        args.push("--parent", input.parent);
      }
      if (input.status !== undefined) {
        args.push("--status", input.status);
      }
      if (input.labels !== undefined && input.labels.length > 0) {
        args.push("--labels", input.labels.join(","));
      }

      const created = yield* runBdJson(input.cwd, args, (json) => {
        const items = Array.isArray(json) ? json : [json];
        const issue = (items[0] ?? json) as Record<string, unknown> | undefined;
        if (!issue) {
          throw new Error("Failed to create issue: no issue returned from bd create.");
        }
        return mapIssueSummary(issue);
      });
      return created;
    });

  const commentIssue: BeadsTrackerServiceShape["commentIssue"] = (input) =>
    Effect.gen(function* () {
      yield* runBdRaw(input.cwd, ["comment", input.issueId, input.text]);
      return yield* getIssueDetail({ cwd: input.cwd, issueId: input.issueId });
    });

  const getContext: BeadsTrackerServiceShape["getContext"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "context",
      },
      runBdJson(input.cwd, ["context"], (json) => {
        const record = asRecord(json);
        if (!record) {
          throw new Error("Expected beads context object.");
        }
        return mapBeadsContext(record);
      }),
    );

  const getIssueGraph: BeadsTrackerServiceShape["getIssueGraph"] = (input) =>
    getOrLoadCoalescedRead(
      {
        cwd: input.cwd,
        name: "issue-graph",
        params: { epicIssueId: input.epicIssueId },
      },
      Effect.gen(function* () {
        const rawIssue = yield* getRawIssue(input.cwd, input.epicIssueId);
        const parentRef = mapParentRef(rawIssue);
        const dependentRecords = asRecordArray(rawIssue.dependents);
        const childRecords = dependentRecords.filter(
          (entry) => getBdDependencyType(entry) === "parent-child",
        );
        const dependentIssueRecords = dependentRecords.filter(
          (entry) => getBdDependencyType(entry) !== "parent-child",
        );
        const childIds = childRecords.flatMap((entry) => {
          const childId = trimToNull(entry.id);
          return childId ? [childId] : [];
        });
        const relatedIssueIds = [...new Set([...(parentRef ? [parentRef.id] : []), ...childIds])];
        const relatedRawById = yield* getRawIssues(input.cwd, relatedIssueIds);
        const parent = parentRef
          ? relatedRawById.has(parentRef.id)
            ? mapIssueRelationSummary(relatedRawById.get(parentRef.id)!)
            : null
          : null;
        const childRawById = new Map(
          [...relatedRawById.entries()].filter(([issueId]) => childIds.includes(issueId)),
        );
        const childDetailsById = new Map(
          [...childRawById.entries()].map(([childId, rawChild]) => [
            childId,
            mapIssueDetail(rawChild, []),
          ]),
        );
        const children = sortChildIssueRelationsByDependencies({
          children: mapIssueRelationArray(childRecords, childRawById),
          childDetailsById,
        });
        const epic = mapIssueDetail(rawIssue, []);
        return decodeIssueGraph({
          epic,
          parent,
          children,
          dependencies: mapIssueRelationArray(rawIssue.dependencies),
          dependents: dependentIssueRecords.map((entry) => mapIssueRelationSummary(entry)),
        });
      }).pipe(
        Effect.mapError((error) =>
          Schema.is(BeadsError)(error)
            ? error
            : toBeadsError("Failed to load beads issue graph.", error),
        ),
      ),
    );

  const extractParentChildDependentIds = (
    rawIssue: Record<string, unknown>,
  ): ReadonlyArray<string> =>
    asRecordArray(rawIssue.dependents).flatMap((entry) => {
      if (getBdDependencyType(entry) !== "parent-child") {
        return [];
      }
      const childId = trimToNull(entry.id);
      return childId ? [childId] : [];
    });

  const hasOpenDirectDescendants = (rawIssue: Record<string, unknown>): boolean =>
    asRecordArray(rawIssue.dependents).some(
      (entry) =>
        getBdDependencyType(entry) === "parent-child" && trimToNull(entry.status) !== "closed",
    );

  const buildEpicCoordinationValidationFromGraphState = (
    state: EpicCoordinationGraphState,
  ): BeadsEpicCoordinationValidationType => {
    const validation = validateEpicCoordinationGraph(state.graph);
    return decodeEpicCoordinationValidation({
      epicId: state.epic.id,
      epicTitle: state.epic.title,
      summary: validation.summary,
      valid: validation.valid && state.loadErrors.length === 0,
      errors: [...state.loadErrors, ...validation.errors],
      warnings: validation.warnings,
      readyFronts: validation.readyFronts,
      estimatedWorkerSessions: validation.estimatedWorkerSessions,
      maxParallelism: validation.maxParallelism,
    });
  };

  const buildEpicCoordinationStatusFromGraphState = (
    state: EpicCoordinationGraphState,
  ): BeadsEpicCoordinationStatusType =>
    decodeEpicCoordinationStatus(deriveEpicCoordinationStatus(state.graph));

  const loadEpicCoordinationGraphState = (input: { cwd: string; epicIssueId: string }) =>
    Effect.gen(function* () {
      const rawEpic = yield* getRawIssue(input.cwd, input.epicIssueId);
      const epic = mapIssueSummary(rawEpic);
      const childIds = extractParentChildDependentIds(rawEpic);
      const childIdSet = new Set(childIds);
      const childIssueExits = yield* Effect.all(
        childIds.map((childId) => Effect.exit(getRawIssue(input.cwd, childId))),
        { concurrency: "unbounded" },
      );

      const childIssues = new Map<string, Record<string, unknown>>();
      const loadErrors: string[] = [];
      childIssueExits.forEach((exit, index) => {
        const childId = childIds[index]!;
        if (exit._tag === "Success") {
          childIssues.set(childId, exit.value);
          return;
        }
        loadErrors.push(
          `Failed to load direct child ${childId}: ${errorMessageFromCause(exit.cause)}`,
        );
      });

      const nodes = childIds.flatMap((childId) => {
        const rawChild = childIssues.get(childId);
        if (!rawChild) {
          return [];
        }

        const internalDependencyIds: string[] = [];
        const externalDependencyIds: string[] = [];
        const unknownDependencyIds: string[] = [];
        asRecordArray(rawChild.dependencies).forEach((dependency, index) => {
          if (getBdDependencyType(dependency) === "parent-child") {
            return;
          }
          if (trimToNull(dependency.status) === "closed") {
            return;
          }

          const dependencyId = trimToNull(dependency.id);
          if (!dependencyId) {
            unknownDependencyIds.push(`${childId}:unknown:${index}`);
          } else if (childIdSet.has(dependencyId)) {
            internalDependencyIds.push(dependencyId);
          } else {
            externalDependencyIds.push(dependencyId);
          }
        });

        return [
          {
            issue: mapIssueRelationSummary(rawChild),
            internalDependencyIds,
            externalDependencyIds,
            unknownDependencyIds,
            hasOpenDescendants: hasOpenDirectDescendants(rawChild),
          },
        ] as const;
      });

      return {
        epic,
        graph: buildEpicCoordinationGraph({
          epicId: epic.id,
          epicTitle: epic.title,
          nodes,
        }),
        loadErrors,
      } satisfies EpicCoordinationGraphState;
    });

  const validateEpicCoordination: BeadsTrackerServiceShape["validateEpicCoordination"] = (input) =>
    loadEpicCoordinationGraphState(input).pipe(
      Effect.map((state) => buildEpicCoordinationValidationFromGraphState(state)),
    );

  const getEpicCoordinationStatus: BeadsTrackerServiceShape["getEpicCoordinationStatus"] = (
    input,
  ) =>
    loadEpicCoordinationGraphState(input).pipe(
      Effect.map((state) => buildEpicCoordinationStatusFromGraphState(state)),
    );

  const loadEpicCoordinationState: BeadsTrackerServiceShape["loadEpicCoordinationState"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const graphStateExit = yield* Effect.exit(
        loadEpicCoordinationGraphState({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
      );

      if (graphStateExit._tag === "Failure") {
        const loadError = errorMessageFromCause(graphStateExit.cause);
        return {
          issueSummary: input.issueSummary ?? null,
          validation: null,
          status: null,
          validationError: loadError,
          statusError: loadError,
        } satisfies EpicWorkflowTrackerState;
      }

      const graphState = graphStateExit.value;
      const validationExit = yield* Effect.exit(
        Effect.sync(() => buildEpicCoordinationValidationFromGraphState(graphState)),
      );
      const statusExit = yield* Effect.exit(
        Effect.sync(() => buildEpicCoordinationStatusFromGraphState(graphState)),
      );

      return {
        issueSummary: input.issueSummary ?? graphState.epic,
        validation: validationExit._tag === "Success" ? validationExit.value : null,
        status: statusExit._tag === "Success" ? statusExit.value : null,
        validationError:
          validationExit._tag === "Failure" ? errorMessageFromCause(validationExit.cause) : null,
        statusError: statusExit._tag === "Failure" ? errorMessageFromCause(statusExit.cause) : null,
      } satisfies EpicWorkflowTrackerState;
    });

  return {
    queryIssues,
    listEpicWorkflowIssues,
    listCoordinatorEpics: listEpicWorkflowIssues,
    getIssueSummary,
    resolveIssueRefs,
    getIssueWithoutComments,
    getIssueSummaries,
    getIssue,
    getEpicIssueSummaries,
    createIssue,
    updateIssue,
    commentIssue,
    getContext,
    getIssueGraph,
    validateEpicCoordination,
    getEpicCoordinationStatus,
    loadEpicCoordinationState,
  } satisfies BeadsTrackerServiceShape;
});

const makeBeadsService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const beadsTracker = yield* BeadsTrackerService;
  const sessionActivityRef = yield* Ref.make<ReadonlyArray<SessionActivityRecord>>([]);
  type SessionWorkflowKind = BeadsStartWorkflowInput["workflow"] | "coordination-prep";

  const appendSessionActivity = (record: SessionActivityRecord) =>
    Ref.update(sessionActivityRef, (records) => [record, ...records].slice(0, 200));

  const appendWorkflowStartedSessionActivity = (input: {
    readonly cwd: string;
    readonly issue: BeadsIssueDetailType;
    readonly workflowKind: SessionWorkflowKind;
    readonly threadId: ThreadId;
  }) =>
    appendSessionActivity({
      cwd: input.cwd,
      entry: {
        kind: "workflow-started",
        issue: input.issue,
        createdAt: nowIso(),
        workflowKind: input.workflowKind,
        threadId: input.threadId,
      },
    });

  const createThreadWithInitialTurn = Effect.fn("BeadsService.createThreadWithInitialTurn")(
    function* (input: {
      threadId: ThreadId;
      projectId: BeadsStartWorkflowInput["projectId"];
      modelSelection: BeadsStartWorkflowInput["modelSelection"];
      runtimeMode: BeadsStartWorkflowInput["runtimeMode"];
      interactionMode: "default" | "plan";
      threadTitle: string;
      promptText: string;
      issueLink: ReturnType<typeof buildIssueLink> | null;
      createThreadErrorMessage: string;
      startTurnErrorMessage: string;
      deleteThreadCommandTag: string;
      createdAt: string;
    }) {
      const rollbackCreatedThread = () =>
        orchestrationEngine
          .dispatch({
            type: "thread.delete",
            commandId: commandId(input.deleteThreadCommandTag),
            threadId: input.threadId,
          })
          .pipe(Effect.ignoreCause({ log: true }));

      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: commandId("create-thread"),
          threadId: input.threadId,
          projectId: input.projectId,
          title: input.threadTitle,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: null,
          worktreePath: null,
          issueLink: input.issueLink,
          createdAt: input.createdAt,
        })
        .pipe(Effect.mapError((cause) => toBeadsError(input.createThreadErrorMessage, cause)));

      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId: commandId("start-turn"),
          threadId: input.threadId,
          message: {
            messageId: messageId("initial"),
            role: "user",
            text: input.promptText,
            attachments: [],
          },
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          titleSeed: input.threadTitle,
          createdAt: input.createdAt,
        })
        .pipe(
          Effect.mapError((cause) => toBeadsError(input.startTurnErrorMessage, cause)),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : rollbackCreatedThread().pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        );
    },
  );

  const startLinkedIssueThread = Effect.fn("BeadsService.startLinkedIssueThread")(
    function* (input: {
      cwd: string;
      projectId: BeadsStartWorkflowInput["projectId"];
      issue: BeadsIssueDetailType;
      modelSelection: BeadsStartWorkflowInput["modelSelection"];
      runtimeMode: BeadsStartWorkflowInput["runtimeMode"];
      interactionMode: "default" | "plan";
      threadTitle: string;
      promptText: string;
      workflowKind: SessionWorkflowKind;
      createThreadErrorMessage: string;
      startTurnErrorMessage: string;
    }) {
      const linkedIssueThreads = yield* projectionSnapshotQuery
        .listProjectLinkedIssueThreads(input.projectId)
        .pipe(
          Effect.mapError((cause) => toBeadsError("Failed to load orchestration state.", cause)),
        );
      const existingThread = findReusableLinkedIssueThread({
        threads: linkedIssueThreads,
        projectId: input.projectId,
        issueId: input.issue.id,
        interactionMode: input.interactionMode,
        threadTitle: input.threadTitle,
        allowArchived: false,
      });

      if (existingThread) {
        yield* appendWorkflowStartedSessionActivity({
          cwd: input.cwd,
          issue: input.issue,
          workflowKind: input.workflowKind,
          threadId: existingThread.id,
        });

        return {
          threadId: existingThread.id,
          created: false,
        } satisfies BeadsStartWorkflowResult;
      }

      const nextThreadId = threadId();
      const createdAt = nowIso();

      yield* createThreadWithInitialTurn({
        threadId: nextThreadId,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        threadTitle: input.threadTitle,
        promptText: input.promptText,
        issueLink: buildIssueLink(input.issue, input.cwd),
        createThreadErrorMessage: input.createThreadErrorMessage,
        startTurnErrorMessage: input.startTurnErrorMessage,
        deleteThreadCommandTag: "delete-linked-thread-after-start-failure",
        createdAt,
      });

      yield* appendWorkflowStartedSessionActivity({
        cwd: input.cwd,
        issue: input.issue,
        workflowKind: input.workflowKind,
        threadId: nextThreadId,
      });

      return {
        threadId: nextThreadId,
        created: true,
      } satisfies BeadsStartWorkflowResult;
    },
  );

  const startProjectThread = Effect.fn("BeadsService.startProjectThread")(function* (input: {
    projectId: BeadsStartBacklogGroomingInput["projectId"];
    modelSelection: BeadsStartBacklogGroomingInput["modelSelection"];
    runtimeMode: BeadsStartBacklogGroomingInput["runtimeMode"];
    interactionMode: "default" | "plan";
    threadTitle: string;
    promptText: string;
    createThreadErrorMessage: string;
    startTurnErrorMessage: string;
  }) {
    const nextThreadId = threadId();
    const createdAt = nowIso();

    yield* createThreadWithInitialTurn({
      threadId: nextThreadId,
      projectId: input.projectId,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      threadTitle: input.threadTitle,
      promptText: input.promptText,
      issueLink: null,
      createThreadErrorMessage: input.createThreadErrorMessage,
      startTurnErrorMessage: input.startTurnErrorMessage,
      deleteThreadCommandTag: "delete-project-thread-after-start-failure",
      createdAt,
    });

    return {
      threadId: nextThreadId,
      created: true,
    } satisfies BeadsStartWorkflowResult;
  });

  const queryIssues: BeadsServiceShape["queryIssues"] = (input) => beadsTracker.queryIssues(input);
  const getIssue: BeadsServiceShape["getIssue"] = (input) => beadsTracker.getIssue(input);
  const resolveIssueRefs: BeadsServiceShape["resolveIssueRefs"] = (input) =>
    beadsTracker.resolveIssueRefs(input);
  const getIssues: BeadsServiceShape["getIssues"] = (input) =>
    beadsTracker.getIssueSummaries(input).pipe(
      Effect.map((issues) => ({ issues })),
      Effect.mapError((error) =>
        Schema.is(BeadsError)(error) ? error : toBeadsError("Failed to load issues batch.", error),
      ),
    );

  const createIssue: BeadsServiceShape["createIssue"] = (input) =>
    Effect.gen(function* () {
      const created = yield* beadsTracker.createIssue(input);
      yield* appendSessionActivity({
        cwd: input.cwd,
        entry: {
          kind: "created",
          issue: created,
          createdAt: nowIso(),
        },
      });
      return created;
    });

  const updateIssue: BeadsServiceShape["updateIssue"] = (input) =>
    Effect.gen(function* () {
      const updated = yield* beadsTracker.updateIssue(input);
      yield* appendSessionActivity({
        cwd: input.cwd,
        entry: {
          kind: "updated",
          issue: updated,
          createdAt: nowIso(),
        },
      });
      return updated;
    });

  const commentIssue: BeadsServiceShape["commentIssue"] = (input) =>
    Effect.gen(function* () {
      const detail = yield* beadsTracker.commentIssue(input);
      yield* appendSessionActivity({
        cwd: input.cwd,
        entry: {
          kind: "commented",
          issue: detail,
          createdAt: nowIso(),
        },
      });
      return detail;
    });

  const getSessionActivity: BeadsServiceShape["getSessionActivity"] = (input) =>
    Ref.get(sessionActivityRef).pipe(
      Effect.map((records) =>
        decodeSessionActivity({
          entries: records
            .filter((record) => record.cwd === input.cwd)
            .map((record) => record.entry),
        }),
      ),
    );

  const getContext: BeadsServiceShape["getContext"] = (input) => beadsTracker.getContext(input);
  const getIssueGraph: BeadsServiceShape["getIssueGraph"] = (input) =>
    beadsTracker.getIssueGraph(input);
  const validateEpicCoordination: BeadsServiceShape["validateEpicCoordination"] = (input) =>
    beadsTracker.validateEpicCoordination(input);
  const getEpicCoordinationStatus: BeadsServiceShape["getEpicCoordinationStatus"] = (input) =>
    beadsTracker.getEpicCoordinationStatus(input);

  const getEpicIssueSummaries: BeadsServiceShape["getEpicIssueSummaries"] = (input) =>
    beadsTracker.getEpicIssueSummaries(input);

  const getEpicWorkflowDetail: BeadsServiceShape["getEpicWorkflowDetail"] = (input) =>
    Effect.gen(function* () {
      const [issue, runtimeState] = yield* Effect.all(
        [
          beadsTracker.getIssueSummary({ cwd: input.cwd, issueId: input.epicIssueId }),
          projectionSnapshotQuery
            .getEpicWorkflowRuntimeState({
              projectId: input.projectId,
              epicIssueId: input.epicIssueId,
            })
            .pipe(
              Effect.mapError((cause) =>
                toBeadsError("Failed to load epic workflow runtime state.", cause),
              ),
            ),
        ],
        { concurrency: "unbounded" },
      );
      const epicWorkflowState = yield* beadsTracker.loadEpicCoordinationState({
        cwd: input.cwd,
        epicIssueId: input.epicIssueId,
        issueSummary: issue,
      });

      return decodeEpicWorkflowDetail(
        buildEpicWorkflowSnapshot({
          issue,
          validation: epicWorkflowState.validation,
          status: epicWorkflowState.status,
          validationError: epicWorkflowState.validationError,
          statusError: epicWorkflowState.statusError,
          projectEpicRuns: runtimeState.projectEpicRuns,
          epicRuns: runtimeState.projectEpicRuns.filter(
            (run) => run.epicIssueId === input.epicIssueId,
          ),
          epicExecutions: runtimeState.epicIssueExecutions,
          fallbackEpicId: input.epicIssueId,
          fallbackEpicTitle: issue?.title ?? input.epicIssueId,
        }),
      );
    });

  const startWorkflow: BeadsServiceShape["startWorkflow"] = (input) =>
    Effect.gen(function* () {
      const issue = yield* beadsTracker.getIssueWithoutComments({
        cwd: input.cwd,
        issueId: input.issueId,
      });

      const nextInteractionMode =
        input.workflow === "refine" || input.workflow === "plan-implementation"
          ? "plan"
          : "default";
      const nextThreadTitle = buildWorkflowThreadTitle(issue, input.workflow);
      const promptText = buildWorkflowPrompt(issue, input.workflow);

      if (input.workflow === "continue") {
        const linkedIssueThreads = yield* projectionSnapshotQuery
          .listProjectLinkedIssueThreads(input.projectId)
          .pipe(
            Effect.mapError((cause) => toBeadsError("Failed to load orchestration state.", cause)),
          );
        const existingThread = findReusableLinkedIssueThread({
          threads: linkedIssueThreads,
          projectId: input.projectId,
          issueId: input.issueId,
          allowArchived: true,
        });

        if (existingThread) {
          yield* appendWorkflowStartedSessionActivity({
            cwd: input.cwd,
            issue,
            workflowKind: input.workflow,
            threadId: existingThread.id,
          });

          return {
            threadId: existingThread.id,
            created: false,
          } satisfies BeadsStartWorkflowResult;
        }
      }

      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: nextInteractionMode,
        threadTitle: nextThreadTitle,
        promptText,
        workflowKind: input.workflow,
        createThreadErrorMessage: "Failed to create issue thread.",
        startTurnErrorMessage: "Failed to start issue workflow.",
      });
    });

  const startBacklogGrooming: BeadsServiceShape["startBacklogGrooming"] = (input) =>
    startProjectThread({
      projectId: input.projectId,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: "plan",
      threadTitle: buildBacklogGroomingThreadTitle(),
      promptText: buildBacklogGroomingPrompt(),
      createThreadErrorMessage: "Failed to create backlog grooming thread.",
      startTurnErrorMessage: "Failed to start backlog grooming workflow.",
    });

  const startEpicQuickRefine: BeadsServiceShape["startEpicQuickRefine"] = (input) =>
    Effect.gen(function* () {
      const epic = yield* beadsTracker.getIssueWithoutComments({
        cwd: input.cwd,
        issueId: input.epicIssueId,
      });
      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue: epic,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        threadTitle: buildEpicQuickRefineThreadTitle(epic),
        promptText: buildEpicRefinePrompt(epic, "quick"),
        workflowKind: "refine",
        createThreadErrorMessage: "Failed to create epic quick refine thread.",
        startTurnErrorMessage: "Failed to start epic quick refine workflow.",
      });
    });

  const startEpicPlannedRefine: BeadsServiceShape["startEpicPlannedRefine"] = (input) =>
    Effect.gen(function* () {
      const epic = yield* beadsTracker.getIssueWithoutComments({
        cwd: input.cwd,
        issueId: input.epicIssueId,
      });
      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue: epic,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "plan",
        threadTitle: buildEpicPlannedRefineThreadTitle(epic),
        promptText: buildEpicRefinePrompt(epic, "planned"),
        workflowKind: "refine",
        createThreadErrorMessage: "Failed to create epic planned refine thread.",
        startTurnErrorMessage: "Failed to start epic planned refine workflow.",
      });
    });

  const startEpicCoordinationPrep: BeadsServiceShape["startEpicCoordinationPrep"] = (input) =>
    Effect.gen(function* () {
      const epic = yield* beadsTracker.getIssueWithoutComments({
        cwd: input.cwd,
        issueId: input.epicIssueId,
      });
      const epicWorkflowState = yield* beadsTracker.loadEpicCoordinationState({
        cwd: input.cwd,
        epicIssueId: input.epicIssueId,
        issueSummary: epic,
      });
      if (!epicWorkflowState.validation || !epicWorkflowState.status) {
        return yield* toBeadsError(
          epicWorkflowState.validationError ??
            epicWorkflowState.statusError ??
            "Failed to load epic workflow state.",
        );
      }

      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue: epic,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        threadTitle: buildEpicCoordinationPrepThreadTitle(epic),
        promptText: buildEpicCoordinationPrepPrompt({
          issue: epic,
          validation: epicWorkflowState.validation,
          status: epicWorkflowState.status,
        }),
        workflowKind: "coordination-prep",
        createThreadErrorMessage: "Failed to create epic workflow prep thread.",
        startTurnErrorMessage: "Failed to start epic workflow prep workflow.",
      });
    });

  return {
    queryIssues,
    getIssue,
    resolveIssueRefs,
    getIssues,
    createIssue,
    updateIssue,
    commentIssue,
    getContext,
    getIssueGraph,
    validateEpicCoordination,
    getEpicCoordinationStatus,
    getEpicIssueSummaries,
    getEpicWorkflowDetail,
    getSessionActivity,
    startWorkflow,
    startBacklogGrooming,
    startEpicQuickRefine,
    startEpicPlannedRefine,
    startEpicCoordinationPrep,
  } satisfies BeadsServiceShape;
});

export const BeadsTrackerServiceLive = Layer.effect(BeadsTrackerService, makeBeadsTrackerService);
export const BeadsServiceLive = Layer.effect(BeadsService, makeBeadsService);
