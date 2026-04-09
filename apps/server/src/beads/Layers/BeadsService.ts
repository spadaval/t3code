import path from "node:path";

import {
  BeadsContext,
  BeadsEpicCoordinatorSnapshot,
  BeadsError,
  BeadsGetSessionActivityResult,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueRelationSummary,
  BeadsIssueSummary,
  BeadsListSwarmsResult,
  BeadsProjectCoordinatorSnapshot,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  CommandId,
  MessageId,
  ThreadId,
  type BeadsContext as BeadsContextType,
  type BeadsGetIssueInput,
  type BeadsIssueComment,
  type BeadsIssueDependency,
  type BeadsIssueDetail as BeadsIssueDetailType,
  type BeadsIssueHistoryEntry,
  type BeadsIssueRelationSummary as BeadsIssueRelationSummaryType,
  type BeadsIssueSummary as BeadsIssueSummaryType,
  type BeadsQueryIssuesInput,
  type BeadsQueryIssuesResult,
  type BeadsSessionActivityEntry,
  type BeadsStartBacklogGroomingInput,
  type BeadsStartWorkflowInput,
  type BeadsStartWorkflowResult,
  type BeadsSwarmSummary as BeadsSwarmSummaryType,
  type BeadsSwarmSupport as BeadsSwarmSupportType,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Layer,
  Metric,
  Option,
  Ref,
  Schema,
  Semaphore,
  SynchronizedRef,
} from "effect";

import { runProcess } from "../../processRunner.ts";
import {
  beadsCommandDuration,
  beadsCommandsTotal,
  metricAttributes,
} from "../../observability/Metrics.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  buildProjectCoordinatorSnapshot,
  buildSingleEpicCoordinatorSnapshot,
} from "../coordinatorSnapshots.ts";
import { BeadsService, type BeadsServiceShape } from "../Services/BeadsService.ts";
import {
  BeadsTrackerService,
  type BeadsTrackerServiceShape,
} from "../Services/BeadsTrackerService.ts";

const MAX_BD_OUTPUT_BYTES = 512 * 1024;
const ISSUE_HISTORY_LIMIT = 20;
const SLOW_BD_COMMAND_WARN_MS = 3_000;
const BD_COMMAND_PREVIEW_LIMIT = 240;
const BD_LOG_SCOPE = "beads.bd";
const decodeIssueSummary = Schema.decodeUnknownSync(BeadsIssueSummary);
const decodeIssueDetail = Schema.decodeUnknownSync(BeadsIssueDetail);
const decodeBeadsContext = Schema.decodeUnknownSync(BeadsContext);
const decodeIssueRelationSummary = Schema.decodeUnknownSync(BeadsIssueRelationSummary);
const decodeIssueGraph = Schema.decodeUnknownSync(BeadsIssueGraph);
const decodeSessionActivity = Schema.decodeUnknownSync(BeadsGetSessionActivityResult);
const decodeSwarmSummary = Schema.decodeUnknownSync(BeadsSwarmSummary);
const decodeSwarmSupport = Schema.decodeUnknownSync(BeadsSwarmSupport);
const decodeSwarmValidation = Schema.decodeUnknownSync(BeadsSwarmValidation);
const decodeSwarmStatus = Schema.decodeUnknownSync(BeadsSwarmStatus);
const decodeListSwarmsResult = Schema.decodeUnknownSync(BeadsListSwarmsResult);
const decodeProjectCoordinatorSnapshot = Schema.decodeUnknownSync(BeadsProjectCoordinatorSnapshot);
const decodeEpicCoordinatorSnapshot = Schema.decodeUnknownSync(BeadsEpicCoordinatorSnapshot);
const PROJECT_COORDINATOR_EPIC_LOAD_CONCURRENCY = 4;
const BLOCKED_ISSUE_LOOKUP_CONCURRENCY = 4;

interface SessionActivityRecord {
  readonly cwd: string;
  readonly entry: BeadsSessionActivityEntry;
}

interface EpicCoordinatorTrackerState {
  readonly issueSummary: BeadsIssueSummaryType | null;
  readonly validation: BeadsSwarmValidation | null;
  readonly status: BeadsSwarmStatus | null;
  readonly validationError: string | null;
  readonly statusError: string | null;
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
  const squashed = Cause.squash(cause as any);
  return squashed instanceof Error ? squashed.message : String(squashed);
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
  const startIndex = action === "swarm" ? 2 : 1;

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
  const subcommand = action === "swarm" ? (trimToNull(args[1]) ?? null) : null;
  return {
    action,
    subcommand,
    commandFamily: subcommand ? `${action}.${subcommand}` : action,
    subject: getBdSubject(args),
    preview: summarizeBdArgs(args),
    argCount: args.length,
  };
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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const trimmed = trimToNull(entry);
        return trimmed ? [trimmed] : [];
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

function asFirstNonNegativeInt(values: ReadonlyArray<unknown>, fallback = 0): number {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
}

function toBeadsError(message: string, cause?: unknown): BeadsError {
  return new BeadsError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function parseBdErrorMessage(stdout: string): string | null {
  if (!stdout.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout) as { error?: unknown };
    return trimToNull(parsed.error);
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
  }

  const updatedDelta = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
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

function buildIssueRecordLookup(
  rawIssues: ReadonlyArray<Record<string, unknown>>,
): ReadonlyMap<string, Record<string, unknown>> {
  const entries = rawIssues.flatMap((rawIssue) => {
    const id = trimToNull(rawIssue.id);
    return id ? ([[id, rawIssue]] as const) : [];
  });
  return new Map(entries);
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

function mapSwarmSummary(
  raw: Record<string, unknown>,
  fallback?: Partial<BeadsSwarmSummaryType>,
): BeadsSwarmSummaryType {
  return decodeSwarmSummary({
    swarmId: trimToNull(raw.swarm_id) ?? trimToNull(raw.id) ?? fallback?.swarmId,
    epicId: trimToNull(raw.epic_id) ?? fallback?.epicId,
    epicTitle:
      trimToNull(raw.epic_title) ??
      trimToNull(raw.title) ??
      trimToNull(raw.epic_id) ??
      fallback?.epicTitle ??
      fallback?.epicId,
    totalIssueCount: asFirstNonNegativeInt(
      [raw.total_issue_count, raw.issue_count, raw.total_issues, fallback?.totalIssueCount],
      0,
    ),
    completedIssueCount: asFirstNonNegativeInt(
      [
        raw.completed_issue_count,
        raw.completed_issues,
        raw.closed_issues,
        fallback?.completedIssueCount,
      ],
      0,
    ),
    activeIssueCount: asFirstNonNegativeInt(
      [raw.active_issue_count, raw.active_issues, raw.active_count, fallback?.activeIssueCount],
      0,
    ),
    readyIssueCount: asFirstNonNegativeInt(
      [raw.ready_issue_count, raw.ready_issues, raw.ready_count, fallback?.readyIssueCount],
      0,
    ),
    blockedIssueCount: asFirstNonNegativeInt(
      [raw.blocked_issue_count, raw.blocked_issues, raw.blocked_count, fallback?.blockedIssueCount],
      0,
    ),
    activeWorkerCount: asFirstNonNegativeInt(
      [raw.active_worker_count, raw.active_workers, fallback?.activeWorkerCount],
      0,
    ),
  });
}

function mapSwarmSummaryIfPresent(
  raw: Record<string, unknown>,
  fallback?: Partial<BeadsSwarmSummaryType>,
): BeadsSwarmSummaryType | null {
  const swarmId =
    trimToNull(raw.swarm_id) ??
    trimToNull(raw.swarmId) ??
    trimToNull(raw.id) ??
    fallback?.swarmId ??
    null;

  if (swarmId === null) {
    return null;
  }

  return mapSwarmSummary(raw, fallback);
}

function mapReadyFronts(value: unknown): BeadsIssueRelationSummaryType[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((front) => {
    if (Array.isArray(front)) {
      return mapIssueRelationArray(front);
    }
    const record = asRecord(front);
    if (!record) {
      return [];
    }
    if (Array.isArray(record.issues) && Array.isArray(record.titles)) {
      const titles = asStringArray(record.titles);
      return record.issues.flatMap((issueId, index) => {
        const id = trimToNull(issueId);
        const title = titles[index];
        return id && title
          ? [
              decodeIssueRelationSummary({
                id,
                title,
                status: "open",
                priority: null,
                issueType: "task",
                assignee: null,
                owner: null,
                parent: null,
              }),
            ]
          : [];
      });
    }
    return mapIssueRelationArray(record.issues ?? record.ready ?? record.items);
  });
}

function deriveSwarmSupport(context: BeadsContextType): BeadsSwarmSupportType {
  let supported = true;
  let reason: string | null = null;

  if (context.backend.kind !== "dolt") {
    supported = false;
    reason = "Swarm requires a Dolt-backed beads project.";
  } else if (context.backend.doltMode === "embedded") {
    supported = false;
    reason =
      "Swarm-backed implementation is unavailable while beads uses embedded Dolt mode because the backend only supports one writer at a time.";
  }

  return decodeSwarmSupport({
    supported,
    reason,
    backend: context.backend,
  });
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

  return (
    action === "swarm" && (args[1] === "list" || args[1] === "status" || args[1] === "validate")
  );
}

function isBdContextCommand(args: ReadonlyArray<string>): boolean {
  return args[0] === "context";
}

function parseBdExecutionStrategyFromContextStdout(stdout: string): BdExecutionStrategy | null {
  try {
    const record = asRecord(JSON.parse(stdout));
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
    parent: mapParentRef(raw, issueTitleById),
    dependencyCount: typeof raw.dependency_count === "number" ? raw.dependency_count : undefined,
    dependentCount: typeof raw.dependent_count === "number" ? raw.dependent_count : undefined,
    commentCount: typeof raw.comment_count === "number" ? raw.comment_count : undefined,
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

function buildIssueSummaryLookup(
  issues: ReadonlyArray<BeadsIssueSummaryType>,
): ReadonlyMap<string, BeadsIssueSummaryType> {
  return new Map(issues.map((issue) => [issue.id, issue] as const));
}

function buildSwarmSummaryLookup(
  swarms: ReadonlyArray<BeadsSwarmSummaryType>,
): ReadonlyMap<string, BeadsSwarmSummaryType> {
  return new Map(swarms.map((swarm) => [swarm.epicId, swarm] as const));
}

function matchesIssueSummary(issue: BeadsIssueSummaryType, input: BeadsQueryIssuesInput): boolean {
  if (input.statuses && input.statuses.length > 0 && !input.statuses.includes(issue.status)) {
    return false;
  }

  if (!input.statuses?.length && issue.status === "closed") {
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
    dependencyType: String(raw.dependency_type),
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

function mapIssueHistoryEntry(raw: Record<string, unknown>): BeadsIssueHistoryEntry {
  const issue = raw.Issue as Record<string, unknown> | undefined;
  return {
    commitHash: String(raw.CommitHash),
    committer: trimToNull(raw.Committer),
    commitDate: String(raw.CommitDate),
    title: typeof issue?.title === "string" ? issue.title : "Unknown issue",
    status: typeof issue?.status === "string" ? issue.status : "unknown",
  };
}

function mapIssueDetail(
  rawIssue: Record<string, unknown>,
  comments: ReadonlyArray<Record<string, unknown>>,
  history: ReadonlyArray<Record<string, unknown>>,
): BeadsIssueDetailType {
  return decodeIssueDetail({
    ...mapIssueSummary(rawIssue),
    dependencies: Array.isArray(rawIssue.dependencies)
      ? rawIssue.dependencies.map((entry) => mapIssueDependency(entry as Record<string, unknown>))
      : [],
    comments: comments.map(mapIssueComment),
    history: history.map(mapIssueHistoryEntry),
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

function compareLinkedIssueThreads(left: OrchestrationThread, right: OrchestrationThread): number {
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
  readonly readModel: OrchestrationReadModel;
  readonly projectId: BeadsStartWorkflowInput["projectId"];
  readonly issueId: string;
  readonly interactionMode?: "default" | "plan";
  readonly threadTitle?: string;
  readonly allowArchived: boolean;
}): OrchestrationThread | null {
  return (
    input.readModel.threads
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

type EpicCoordinationPrepIntent = "prepare" | "repair";

function resolveEpicCoordinationPrepIntent(
  validation: Pick<BeadsSwarmValidation, "swarm">,
): EpicCoordinationPrepIntent {
  return validation.swarm === null ? "prepare" : "repair";
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
  validation: BeadsSwarmValidation;
  status: BeadsSwarmStatus;
  intent: EpicCoordinationPrepIntent;
}): string {
  const swarmState = input.validation.swarm
    ? `${input.validation.swarm.swarmId} (${input.validation.valid ? "valid" : "needs work"})`
    : "No swarm exists yet";

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

  if (input.intent === "prepare") {
    return [
      "## Assignment",
      "",
      `Prepare epic ${input.issue.id}: ${input.issue.title} for coordinated execution`,
      "",
      "## Getting started",
      "",
      `Run \`bd show ${input.issue.id}\` to read the full epic details, including description, child issues, and dependencies.`,
      "",
      "## Current swarm state",
      "",
      `Swarm: ${swarmState}`,
      `Validation errors: ${validationErrors}`,
      `Validation warnings: ${validationWarnings}`,
      `Ready issues: ${readyIssues}`,
      `Active issues: ${activeIssues}`,
      `Blocked issues: ${blockedIssues}`,
      "",
      "## Instructions",
      "",
      "- This is tracker-only coordination work. Fix the epic structure so it is ready for coordinated execution.",
      "- Use `bd` to refine child issues, dependencies, and any coordination metadata required to make the epic swarmable.",
      "- Do NOT describe this as repairing an existing swarm -- the epic is not ready yet.",
      "- Do NOT implement application code. Do NOT create a worktree.",
      "- When finished, summarize the resulting swarm state and any blockers that still prevent launching worker threads.",
    ].join("\n");
  }

  // repair intent
  return [
    "## Assignment",
    "",
    `Repair coordination setup for epic ${input.issue.id}: ${input.issue.title}`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${input.issue.id}\` to read the full epic details, including description, child issues, and dependencies.`,
    "",
    "## Current swarm state",
    "",
    `Swarm: ${swarmState}`,
    `Validation errors: ${validationErrors}`,
    `Validation warnings: ${validationWarnings}`,
    `Ready issues: ${readyIssues}`,
    `Active issues: ${activeIssues}`,
    `Blocked issues: ${blockedIssues}`,
    "",
    "## Instructions",
    "",
    "- This is tracker-only coordination work. Use `bd` to repair the existing coordination setup and correct tracker metadata drift.",
    "- Repair the current coordination setup instead of replacing it unless recovery is impossible.",
    "- Do NOT implement application code. Do NOT create a worktree unless tracker-only recovery is impossible.",
    "- When finished, summarize the resulting swarm state and any blockers that still prevent launching worker threads.",
  ].join("\n");
}

const makeBeadsTrackerService = Effect.gen(function* () {
  const bdLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
  const bdExecutionStrategiesRef = yield* Ref.make(new Map<string, BdExecutionStrategy>());
  const bdExecutionStrategyDeferredsRef = yield* SynchronizedRef.make(
    new Map<string, Deferred.Deferred<BdExecutionStrategy, BeadsError>>(),
  );

  const getBdKey = (cwd: string) => path.resolve(cwd);

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
              outputMode: "truncate",
              maxBufferBytes: MAX_BD_OUTPUT_BYTES,
            }),
          catch: (cause) => toBeadsError("Failed to run bd.", cause),
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
          try: () => map(JSON.parse(stdout)),
          catch: (cause) => toBeadsError("Failed to parse beads JSON output.", cause),
        }),
      ),
    );

  const getRawIssue = (cwd: string, issueId: string) =>
    runBdJson(cwd, ["show", issueId, "--long"], (json) => {
      const items = Array.isArray(json) ? json : [];
      const issue = items[0] as Record<string, unknown> | undefined;
      if (!issue) {
        throw new Error(`Issue '${issueId}' was not found.`);
      }
      return issue;
    });

  const getIssueComments = (cwd: string, issueId: string) =>
    runBdJson(
      cwd,
      ["comments", issueId],
      (json) => (Array.isArray(json) ? json : []) as ReadonlyArray<Record<string, unknown>>,
    );

  const getIssueHistory = (cwd: string, issueId: string) =>
    runBdJson(
      cwd,
      ["history", issueId, "--limit", String(ISSUE_HISTORY_LIMIT)],
      (json) => (Array.isArray(json) ? json : []) as ReadonlyArray<Record<string, unknown>>,
    );

  const getIssueDetail = (input: BeadsGetIssueInput) =>
    Effect.all(
      [
        getRawIssue(input.cwd, input.issueId),
        getIssueComments(input.cwd, input.issueId),
        getIssueHistory(input.cwd, input.issueId),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(([issue, comments, history]) => mapIssueDetail(issue, comments, history)),
      Effect.mapError((error) =>
        Schema.is(BeadsError)(error) ? error : toBeadsError("Failed to load issue detail.", error),
      ),
    );

  const queryIssues: BeadsTrackerServiceShape["queryIssues"] = (input) =>
    runBdJson(input.cwd, ["list", "--all", "--limit", "0"], (json) => {
      const rawIssues = asRecordArray(json);
      const issueTitleById = buildIssueTitleMap(rawIssues);
      const issues = rawIssues
        .map((entry) => mapIssueSummary(entry, issueTitleById))
        .filter((issue) => matchesIssueSummary(issue, input))
        .toSorted((left, right) => compareIssueSummaries(left, right, input.sortBy))
        .slice(0, 200);
      return {
        issues,
      } satisfies BeadsQueryIssuesResult;
    });

  const listCoordinatorEpics: BeadsTrackerServiceShape["listCoordinatorEpics"] = (input) =>
    runBdJson(input.cwd, ["list", "--all", "--type", "epic", "--limit", "0"], (json) => {
      const rawIssues = asRecordArray(json);
      const issueTitleById = buildIssueTitleMap(rawIssues);
      return rawIssues
        .map((entry) => mapIssueSummary(entry, issueTitleById))
        .filter((issue) => issue.status !== "closed")
        .toSorted((left, right) => compareIssueSummaries(left, right, "updated"))
        .slice(0, 200);
    });

  const getIssue: BeadsTrackerServiceShape["getIssue"] = (input) => getIssueDetail(input);

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
          const current = yield* getIssueDetail({ cwd: input.cwd, issueId: input.issueId });
          for (const label of current.labels) {
            args.push("--remove-label", label);
          }
        }
      }

      return yield* runBdJson(input.cwd, args, (json) => {
        const items = Array.isArray(json) ? json : [];
        const issue = items[0] as Record<string, unknown> | undefined;
        if (!issue) {
          throw new Error(`Issue '${input.issueId}' was not updated.`);
        }
        return mapIssueSummary(issue);
      });
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

      return yield* runBdJson(input.cwd, args, (json) => {
        const items = Array.isArray(json) ? json : [json];
        const issue = (items[0] ?? json) as Record<string, unknown> | undefined;
        if (!issue) {
          throw new Error("Failed to create issue: no issue returned from bd create.");
        }
        return mapIssueSummary(issue);
      });
    });

  const commentIssue: BeadsTrackerServiceShape["commentIssue"] = (input) =>
    Effect.gen(function* () {
      yield* runBdRaw(input.cwd, ["comment", input.issueId, input.text]);
      return yield* getIssueDetail({ cwd: input.cwd, issueId: input.issueId });
    });

  const getContext: BeadsTrackerServiceShape["getContext"] = (input) =>
    runBdJson(input.cwd, ["context"], (json) => {
      const record = asRecord(json);
      if (!record) {
        throw new Error("Expected beads context object.");
      }
      return mapBeadsContext(record);
    });

  const getSwarmSupport: BeadsTrackerServiceShape["getSwarmSupport"] = (input) =>
    getContext({ cwd: input.cwd }).pipe(Effect.map((context) => deriveSwarmSupport(context)));

  const listSwarmsWithSupport: BeadsTrackerServiceShape["listSwarmsWithSupport"] = (input) =>
    Effect.gen(function* () {
      if (!input.support.supported) {
        return decodeListSwarmsResult({ swarms: [] });
      }

      return yield* runBdJson(input.cwd, ["swarm", "list"], (json) => {
        const record = asRecord(json);
        const swarmsSource =
          record && Array.isArray(record.swarms) ? record.swarms : Array.isArray(json) ? json : [];
        return decodeListSwarmsResult({
          swarms: swarmsSource.map((entry) => mapSwarmSummary(entry as Record<string, unknown>)),
        });
      });
    });

  const listSwarms: BeadsTrackerServiceShape["listSwarms"] = (input) =>
    Effect.gen(function* () {
      const support = yield* getSwarmSupport({ cwd: input.cwd });
      return yield* listSwarmsWithSupport({ cwd: input.cwd, support });
    });

  const getIssueGraph: BeadsTrackerServiceShape["getIssueGraph"] = (input) =>
    Effect.gen(function* () {
      const [rawIssue, comments, history] = yield* Effect.all(
        [
          getRawIssue(input.cwd, input.epicIssueId),
          getIssueComments(input.cwd, input.epicIssueId),
          getIssueHistory(input.cwd, input.epicIssueId),
        ],
        { concurrency: "unbounded" },
      );
      const parentRef = mapParentRef(rawIssue);
      const parent =
        parentRef === null
          ? null
          : yield* getRawIssue(input.cwd, parentRef.id).pipe(
              Effect.map((rawParent) => mapIssueRelationSummary(rawParent)),
            );
      const dependentRecords = asRecordArray(rawIssue.dependents);
      const childRecords = dependentRecords.filter(
        (entry) => trimToNull(entry.dependency_type) === "parent-child",
      );
      const dependentIssueRecords = dependentRecords.filter(
        (entry) => trimToNull(entry.dependency_type) !== "parent-child",
      );
      const epic = mapIssueDetail(rawIssue, comments, history);
      return decodeIssueGraph({
        epic,
        parent,
        children: childRecords.map((entry) => mapIssueRelationSummary(entry)),
        dependencies: mapIssueRelationArray(rawIssue.dependencies),
        dependents: dependentIssueRecords.map((entry) => mapIssueRelationSummary(entry)),
      });
    }).pipe(
      Effect.mapError((error) =>
        Schema.is(BeadsError)(error)
          ? error
          : toBeadsError("Failed to load beads issue graph.", error),
      ),
    );

  const getEpicSwarm: BeadsTrackerServiceShape["getEpicSwarm"] = (input) =>
    Effect.gen(function* () {
      const support = yield* getSwarmSupport({ cwd: input.cwd });
      const swarms = yield* listSwarmsWithSupport({ cwd: input.cwd, support });
      return swarms.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null;
    });

  const createEpicSwarm: BeadsTrackerServiceShape["createEpicSwarm"] = (input) =>
    Effect.gen(function* () {
      const support = yield* getSwarmSupport({ cwd: input.cwd });
      if (!support.supported) {
        return yield* toBeadsError(
          support.reason ?? "Swarm coordination is unavailable for this beads backend.",
        );
      }

      yield* runBdRaw(input.cwd, ["swarm", "create", input.epicIssueId, "--json"]).pipe(
        Effect.mapError((error) =>
          toBeadsError(
            `Failed to create swarm for ${input.epicIssueId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        ),
      );

      const swarm = yield* getEpicSwarm(input);
      if (swarm === null) {
        return yield* toBeadsError(
          `Failed to create swarm for ${input.epicIssueId}: swarm was still missing after create completed.`,
        );
      }

      return swarm;
    });

  const decodeValidationFromRaw = (input: {
    epic: BeadsIssueSummaryType;
    rawValidation: Record<string, unknown>;
    swarmSummary: BeadsSwarmSummaryType | null | undefined;
  }) => {
    const rawValidationSwarm = asRecord(input.rawValidation.swarm);
    const validationSwarm = mapSwarmSummaryIfPresent(
      rawValidationSwarm ?? input.rawValidation,
      input.swarmSummary ?? undefined,
    );

    return decodeSwarmValidation({
      epicId: input.epic.id,
      epicTitle: input.epic.title,
      swarm: validationSwarm,
      valid:
        asBoolean(input.rawValidation.valid) ??
        asStringArray(input.rawValidation.errors).length === 0,
      errors: asStringArray(input.rawValidation.errors),
      warnings: asStringArray(input.rawValidation.warnings),
      readyFronts: mapReadyFronts(input.rawValidation.ready_fronts),
      estimatedWorkerSessions:
        asNumber(input.rawValidation.estimated_worker_sessions) ??
        asNumber(input.rawValidation.estimated_sessions),
      maxParallelism: asNumber(input.rawValidation.max_parallelism),
    });
  };

  const decodeStatusFromRaw = (input: {
    rawEpic: Record<string, unknown>;
    epic: BeadsIssueSummaryType;
    rawStatus: Record<string, unknown>;
    swarmSummary: BeadsSwarmSummaryType | null | undefined;
  }) => {
    const childIssueRecordById = buildIssueRecordLookup(
      asRecordArray(input.rawEpic.dependents).filter(
        (entry) => trimToNull(entry.dependency_type) === "parent-child",
      ),
    );
    const rawStatusSwarm = asRecord(input.rawStatus.swarm);
    const statusSwarm = mapSwarmSummaryIfPresent(
      {
        ...rawStatusSwarm,
        epic_id: input.rawStatus.epic_id ?? rawStatusSwarm?.epic_id,
        epic_title: input.rawStatus.epic_title ?? rawStatusSwarm?.epic_title,
        total_issues: input.rawStatus.total_issues ?? rawStatusSwarm?.total_issues,
        completed_issues:
          input.rawStatus.completed_issues ?? asRecordArray(input.rawStatus.completed).length,
        active_issues:
          input.rawStatus.active_issues ??
          input.rawStatus.active_count ??
          asRecordArray(input.rawStatus.active).length,
        ready_issues:
          input.rawStatus.ready_issues ??
          input.rawStatus.ready_count ??
          asRecordArray(input.rawStatus.ready).length,
        blocked_issues:
          input.rawStatus.blocked_issues ??
          input.rawStatus.blocked_count ??
          asRecordArray(input.rawStatus.blocked).length,
      },
      input.swarmSummary ?? undefined,
    );

    return decodeSwarmStatus({
      epicId: input.epic.id,
      epicTitle: input.epic.title,
      swarm: statusSwarm,
      completed: mapIssueRelationArray(input.rawStatus.completed, childIssueRecordById),
      active: mapIssueRelationArray(input.rawStatus.active, childIssueRecordById),
      ready: mapIssueRelationArray(input.rawStatus.ready, childIssueRecordById),
      blocked: mapIssueRelationArray(input.rawStatus.blocked, childIssueRecordById),
      blockedBreakdown: {
        internal: [],
        external: [],
        unknown: [],
      },
    });
  };

  const buildBlockedIssueBreakdown = (input: {
    cwd: string;
    rawEpic: Record<string, unknown>;
    status: BeadsSwarmStatus;
  }) =>
    Effect.gen(function* () {
      if (input.status.blocked.length === 0) {
        return {
          internal: [],
          external: [],
          unknown: [],
        } satisfies BeadsSwarmStatus["blockedBreakdown"];
      }

      const epicChildIssueIds = new Set(
        asRecordArray(input.rawEpic.dependents)
          .filter((entry) => trimToNull(entry.dependency_type) === "parent-child")
          .flatMap((entry) => {
            const issueId = trimToNull(entry.id);
            return issueId ? [issueId] : [];
          }),
      );
      const cachedRawIssueEffects = new Map<
        string,
        Effect.Effect<Record<string, unknown>, BeadsError>
      >();
      const loadRawIssueCached = (issueId: string) =>
        Effect.gen(function* () {
          let cached = cachedRawIssueEffects.get(issueId);
          if (!cached) {
            cached = yield* Effect.cached(getRawIssue(input.cwd, issueId));
            cachedRawIssueEffects.set(issueId, cached);
          }
          return yield* cached;
        });

      const blockedClassifications = yield* Effect.forEach(
        input.status.blocked,
        (blockedIssue) =>
          Effect.gen(function* () {
            const rawBlockedIssueExit = yield* Effect.exit(loadRawIssueCached(blockedIssue.id));
            if (rawBlockedIssueExit._tag === "Failure") {
              return {
                issue: blockedIssue,
                classification: "unknown" as const,
              };
            }

            const rawBlockedIssue = rawBlockedIssueExit.value;
            if (!Array.isArray(rawBlockedIssue.dependencies)) {
              return {
                issue: blockedIssue,
                classification: "unknown" as const,
              };
            }

            const unresolvedDependencyIds = asRecordArray(rawBlockedIssue.dependencies).flatMap(
              (dependency) => {
                if (trimToNull(dependency.dependency_type) === "parent-child") {
                  return [];
                }

                const dependencyId = trimToNull(dependency.id);
                if (!dependencyId) {
                  return [null];
                }

                return trimToNull(dependency.status) === "closed" ? [] : [dependencyId];
              },
            );

            if (unresolvedDependencyIds.length === 0) {
              return {
                issue: blockedIssue,
                classification: "unknown" as const,
              };
            }

            if (unresolvedDependencyIds.some((dependencyId) => dependencyId === null)) {
              return {
                issue: blockedIssue,
                classification: "unknown" as const,
              };
            }

            const unresolvedDependencyIdStrings = unresolvedDependencyIds.filter(
              (dependencyId): dependencyId is string => dependencyId !== null,
            );

            return {
              issue: blockedIssue,
              classification: unresolvedDependencyIdStrings.some(
                (dependencyId) => !epicChildIssueIds.has(dependencyId),
              )
                ? ("external" as const)
                : ("internal" as const),
            };
          }),
        { concurrency: BLOCKED_ISSUE_LOOKUP_CONCURRENCY },
      );

      const breakdown = {
        internal: [] as BeadsIssueRelationSummaryType[],
        external: [] as BeadsIssueRelationSummaryType[],
        unknown: [] as BeadsIssueRelationSummaryType[],
      };
      for (const item of blockedClassifications) {
        breakdown[item.classification].push(item.issue);
      }

      return breakdown;
    });

  const buildSwarmStatusFromRaw = (input: {
    cwd: string;
    rawEpic: Record<string, unknown>;
    epic: BeadsIssueSummaryType;
    rawStatus: Record<string, unknown>;
    swarmSummary: BeadsSwarmSummaryType | null | undefined;
  }) =>
    Effect.gen(function* () {
      const status = decodeStatusFromRaw(input);
      const blockedBreakdown = yield* buildBlockedIssueBreakdown({
        cwd: input.cwd,
        rawEpic: input.rawEpic,
        status,
      });

      return decodeSwarmStatus({
        ...status,
        blockedBreakdown,
      });
    });

  const loadEpicCoordinatorTrackerState: BeadsTrackerServiceShape["loadEpicCoordinatorTrackerState"] =
    (input) =>
      Effect.gen(function* () {
        if (!input.support.supported) {
          return {
            issueSummary: input.issueSummary ?? null,
            validation: null,
            status: null,
            validationError: null,
            statusError: null,
          } satisfies EpicCoordinatorTrackerState;
        }

        const rawEpicExit = yield* Effect.exit(getRawIssue(input.cwd, input.epicIssueId));
        if (rawEpicExit._tag === "Failure") {
          const detail = errorMessageFromCause(rawEpicExit.cause);
          return {
            issueSummary: input.issueSummary ?? null,
            validation: null,
            status: null,
            validationError: detail,
            statusError: detail,
          } satisfies EpicCoordinatorTrackerState;
        }

        const rawEpic = rawEpicExit.value;
        const epic = mapIssueSummary(rawEpic);
        const [validationExit, statusExit] = yield* Effect.all(
          [
            Effect.exit(
              runBdJson(input.cwd, ["swarm", "validate", input.epicIssueId], (json) => {
                const record = asRecord(json);
                if (!record) {
                  throw new Error("Expected epic swarm validation object.");
                }
                return record;
              }),
            ),
            Effect.exit(
              runBdJson(input.cwd, ["swarm", "status", input.epicIssueId], (json) => {
                const record = asRecord(json);
                if (!record) {
                  throw new Error("Expected epic swarm status object.");
                }
                return record;
              }),
            ),
          ],
          { concurrency: "unbounded" },
        );

        return {
          issueSummary: epic,
          validation:
            validationExit._tag === "Success"
              ? decodeValidationFromRaw({
                  epic,
                  rawValidation: validationExit.value,
                  swarmSummary: input.swarmSummary,
                })
              : null,
          status:
            statusExit._tag === "Success"
              ? yield* buildSwarmStatusFromRaw({
                  cwd: input.cwd,
                  rawEpic,
                  epic,
                  rawStatus: statusExit.value,
                  swarmSummary: input.swarmSummary,
                })
              : null,
          validationError:
            validationExit._tag === "Failure" ? errorMessageFromCause(validationExit.cause) : null,
          statusError:
            statusExit._tag === "Failure" ? errorMessageFromCause(statusExit.cause) : null,
        } satisfies EpicCoordinatorTrackerState;
      });

  const validateEpicSwarm: BeadsTrackerServiceShape["validateEpicSwarm"] = (input) =>
    Effect.gen(function* () {
      const [epic, support] = yield* Effect.all(
        [
          getRawIssue(input.cwd, input.epicIssueId).pipe(Effect.map((raw) => mapIssueSummary(raw))),
          getSwarmSupport({ cwd: input.cwd }),
        ],
        { concurrency: "unbounded" },
      );

      if (!support.supported) {
        return decodeSwarmValidation({
          epicId: epic.id,
          epicTitle: epic.title,
          swarm: null,
          valid: false,
          errors: support.reason ? [support.reason] : [],
        });
      }

      const [swarms, rawValidation] = yield* Effect.all(
        [
          listSwarmsWithSupport({ cwd: input.cwd, support }),
          runBdJson(input.cwd, ["swarm", "validate", input.epicIssueId], (json) => {
            const record = asRecord(json);
            if (!record) {
              throw new Error("Expected epic swarm validation object.");
            }
            return record;
          }),
        ],
        { concurrency: "unbounded" },
      );
      const swarmSummary =
        swarms.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null;

      return decodeValidationFromRaw({ epic, rawValidation, swarmSummary });
    });

  const getEpicSwarmStatus: BeadsTrackerServiceShape["getEpicSwarmStatus"] = (input) =>
    Effect.gen(function* () {
      const [rawEpic, support] = yield* Effect.all(
        [getRawIssue(input.cwd, input.epicIssueId), getSwarmSupport({ cwd: input.cwd })],
        { concurrency: "unbounded" },
      );
      const epic = mapIssueSummary(rawEpic);

      if (!support.supported) {
        return decodeSwarmStatus({
          epicId: epic.id,
          epicTitle: epic.title,
          swarm: null,
          completed: [],
          active: [],
          ready: [],
          blocked: [],
        });
      }

      const [swarms, rawStatus] = yield* Effect.all(
        [
          listSwarmsWithSupport({ cwd: input.cwd, support }),
          runBdJson(input.cwd, ["swarm", "status", input.epicIssueId], (json) => {
            const record = asRecord(json);
            if (!record) {
              throw new Error("Expected epic swarm status object.");
            }
            return record;
          }),
        ],
        { concurrency: "unbounded" },
      );
      const swarmSummary =
        swarms.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null;

      return yield* buildSwarmStatusFromRaw({
        cwd: input.cwd,
        rawEpic,
        epic,
        rawStatus,
        swarmSummary,
      });
    });

  return {
    queryIssues,
    listCoordinatorEpics,
    getIssue,
    createIssue,
    updateIssue,
    commentIssue,
    getContext,
    getSwarmSupport,
    getIssueGraph,
    getEpicSwarm,
    validateEpicSwarm,
    getEpicSwarmStatus,
    listSwarms,
    listSwarmsWithSupport,
    createEpicSwarm,
    loadEpicCoordinatorTrackerState,
  } satisfies BeadsTrackerServiceShape;
});

const makeBeadsService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
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
      const readModel = yield* orchestrationEngine
        .getReadModel()
        .pipe(
          Effect.mapError((cause) => toBeadsError("Failed to load orchestration state.", cause)),
        );
      const existingThread = findReusableLinkedIssueThread({
        readModel,
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

      yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: commandId("create-thread"),
          threadId: nextThreadId,
          projectId: input.projectId,
          title: input.threadTitle,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: null,
          worktreePath: null,
          issueLink: buildIssueLink(input.issue, input.cwd),
          createdAt,
        })
        .pipe(Effect.mapError((cause) => toBeadsError(input.createThreadErrorMessage, cause)));

      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId: commandId("start-turn"),
          threadId: nextThreadId,
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
          createdAt,
        })
        .pipe(Effect.mapError((cause) => toBeadsError(input.startTurnErrorMessage, cause)));

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

    yield* orchestrationEngine
      .dispatch({
        type: "thread.create",
        commandId: commandId("create-thread"),
        threadId: nextThreadId,
        projectId: input.projectId,
        title: input.threadTitle,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        branch: null,
        worktreePath: null,
        issueLink: null,
        createdAt,
      })
      .pipe(Effect.mapError((cause) => toBeadsError(input.createThreadErrorMessage, cause)));

    yield* orchestrationEngine
      .dispatch({
        type: "thread.turn.start",
        commandId: commandId("start-turn"),
        threadId: nextThreadId,
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
        createdAt,
      })
      .pipe(Effect.mapError((cause) => toBeadsError(input.startTurnErrorMessage, cause)));

    return {
      threadId: nextThreadId,
      created: true,
    } satisfies BeadsStartWorkflowResult;
  });

  const queryIssues: BeadsServiceShape["queryIssues"] = (input) => beadsTracker.queryIssues(input);
  const getIssue: BeadsServiceShape["getIssue"] = (input) => beadsTracker.getIssue(input);

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
  const getSwarmSupport: BeadsServiceShape["getSwarmSupport"] = (input) =>
    beadsTracker.getSwarmSupport(input);
  const listSwarms: BeadsServiceShape["listSwarms"] = (input) => beadsTracker.listSwarms(input);
  const getIssueGraph: BeadsServiceShape["getIssueGraph"] = (input) =>
    beadsTracker.getIssueGraph(input);
  const getEpicSwarm: BeadsServiceShape["getEpicSwarm"] = (input) =>
    beadsTracker.getEpicSwarm(input);
  const validateEpicSwarm: BeadsServiceShape["validateEpicSwarm"] = (input) =>
    beadsTracker.validateEpicSwarm(input);
  const getEpicSwarmStatus: BeadsServiceShape["getEpicSwarmStatus"] = (input) =>
    beadsTracker.getEpicSwarmStatus(input);

  const getProjectCoordinatorSnapshot: BeadsServiceShape["getProjectCoordinatorSnapshot"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const [support, epicIssues, readModel] = yield* Effect.all(
        [
          beadsTracker.getSwarmSupport({ cwd: input.cwd }),
          beadsTracker.listCoordinatorEpics({ cwd: input.cwd }),
          orchestrationEngine
            .getReadModel()
            .pipe(
              Effect.mapError((cause) =>
                toBeadsError("Failed to load orchestration state.", cause),
              ),
            ),
        ],
        { concurrency: "unbounded" },
      );
      const swarms = yield* beadsTracker.listSwarmsWithSupport({ cwd: input.cwd, support });
      const issueSummaryById = buildIssueSummaryLookup(epicIssues);
      const swarmSummaryByEpicId = buildSwarmSummaryLookup(swarms.swarms);
      const perEpicStateEntries = yield* Effect.forEach(
        new Set([
          ...epicIssues.map((issue) => issue.id),
          ...swarms.swarms.map((swarm) => swarm.epicId),
          ...readModel.swarmRuns
            .filter((run) => run.projectId === input.projectId)
            .map((run) => run.epicIssueId),
        ]),
        (epicIssueId) =>
          beadsTracker
            .loadEpicCoordinatorTrackerState({
              cwd: input.cwd,
              epicIssueId,
              support,
              issueSummary: issueSummaryById.get(epicIssueId) ?? null,
              swarmSummary: swarmSummaryByEpicId.get(epicIssueId) ?? null,
            })
            .pipe(Effect.map((state) => [epicIssueId, state] as const)),
        { concurrency: PROJECT_COORDINATOR_EPIC_LOAD_CONCURRENCY },
      );

      return decodeProjectCoordinatorSnapshot(
        buildProjectCoordinatorSnapshot({
          projectId: input.projectId,
          support,
          epicIssues,
          swarms: swarms.swarms,
          readModel,
          perEpicState: new Map(perEpicStateEntries),
        }),
      );
    });

  const getEpicCoordinatorSnapshot: BeadsServiceShape["getEpicCoordinatorSnapshot"] = (input) =>
    Effect.gen(function* () {
      const [support, issue, readModel] = yield* Effect.all(
        [
          beadsTracker.getSwarmSupport({ cwd: input.cwd }),
          beadsTracker.getIssue({ cwd: input.cwd, issueId: input.epicIssueId }),
          orchestrationEngine
            .getReadModel()
            .pipe(
              Effect.mapError((cause) =>
                toBeadsError("Failed to load orchestration state.", cause),
              ),
            ),
        ],
        { concurrency: "unbounded" },
      );
      const swarms = yield* beadsTracker.listSwarmsWithSupport({ cwd: input.cwd, support });
      const trackerState = yield* beadsTracker.loadEpicCoordinatorTrackerState({
        cwd: input.cwd,
        epicIssueId: input.epicIssueId,
        support,
        issueSummary: issue,
        swarmSummary: swarms.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null,
      });

      return decodeEpicCoordinatorSnapshot({
        projectId: input.projectId,
        support,
        epic: buildSingleEpicCoordinatorSnapshot({
          projectId: input.projectId,
          support,
          issue,
          validation: trackerState.validation,
          status: trackerState.status,
          validationError: trackerState.validationError,
          statusError: trackerState.statusError,
          readModel,
        }),
      });
    });

  const startWorkflow: BeadsServiceShape["startWorkflow"] = (input) =>
    Effect.gen(function* () {
      const issue = yield* beadsTracker.getIssue({ cwd: input.cwd, issueId: input.issueId });

      const nextInteractionMode =
        input.workflow === "refine" || input.workflow === "plan-implementation"
          ? "plan"
          : "default";
      const nextThreadTitle = buildWorkflowThreadTitle(issue, input.workflow);
      const promptText = buildWorkflowPrompt(issue, input.workflow);

      if (input.workflow === "continue") {
        const readModel = yield* orchestrationEngine
          .getReadModel()
          .pipe(
            Effect.mapError((cause) => toBeadsError("Failed to load orchestration state.", cause)),
          );
        const existingThread = findReusableLinkedIssueThread({
          readModel,
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
      const epic = yield* beadsTracker.getIssue({ cwd: input.cwd, issueId: input.epicIssueId });
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
      const epic = yield* beadsTracker.getIssue({ cwd: input.cwd, issueId: input.epicIssueId });
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
      const [support, epic] = yield* Effect.all(
        [
          beadsTracker.getSwarmSupport({ cwd: input.cwd }),
          beadsTracker.getIssue({ cwd: input.cwd, issueId: input.epicIssueId }),
        ],
        { concurrency: "unbounded" },
      );

      if (!support.supported) {
        return yield* toBeadsError(
          support.reason ?? "Swarm coordination is unavailable for this beads backend.",
        );
      }

      const [validation, status] = yield* Effect.all(
        [
          beadsTracker.validateEpicSwarm({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
          beadsTracker.getEpicSwarmStatus({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
        ],
        { concurrency: "unbounded" },
      );
      const intent = resolveEpicCoordinationPrepIntent(validation);

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
          validation,
          status,
          intent,
        }),
        workflowKind: "coordination-prep",
        createThreadErrorMessage: "Failed to create epic coordination prep thread.",
        startTurnErrorMessage: "Failed to start epic coordination prep workflow.",
      });
    });

  return {
    queryIssues,
    getIssue,
    createIssue,
    updateIssue,
    commentIssue,
    getContext,
    getSwarmSupport,
    getIssueGraph,
    getEpicSwarm,
    validateEpicSwarm,
    getEpicSwarmStatus,
    listSwarms,
    getProjectCoordinatorSnapshot,
    getEpicCoordinatorSnapshot,
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
