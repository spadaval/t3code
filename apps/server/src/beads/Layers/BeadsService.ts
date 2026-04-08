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
  type BeadsStartWorkflowInput,
  type BeadsStartWorkflowResult,
  type BeadsSwarmSummary as BeadsSwarmSummaryType,
  type BeadsSwarmSupport as BeadsSwarmSupportType,
} from "@t3tools/contracts";
import {
  Cause,
  Deferred,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Semaphore,
  SynchronizedRef,
} from "effect";

import { runProcess } from "../../processRunner.ts";
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

interface SessionActivityRecord {
  readonly cwd: string;
  readonly entry: BeadsSessionActivityEntry;
}

type BdExecutionStrategy = "parallel" | "serial";

interface BdExecutionStrategyReservation {
  readonly deferred: Deferred.Deferred<BdExecutionStrategy, BeadsError>;
  readonly created: boolean;
}

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

function buildWorkflowThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title}`;
}

function formatDependencies(issue: BeadsIssueDetailType): string {
  if (issue.dependencies.length === 0) {
    return "None";
  }
  return issue.dependencies
    .map((dependency) => `- ${dependency.id}: ${dependency.title} [${dependency.status}]`)
    .join("\n");
}

function buildWorkflowPrompt(
  issue: BeadsIssueDetailType,
  workflow: BeadsStartWorkflowInput["workflow"],
): string {
  const sections = [
    `Issue: ${issue.id}`,
    `Title: ${issue.title}`,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority === null ? "unset" : `P${issue.priority}`}`,
    "",
    "Description:",
    issue.description?.trim().length ? issue.description : "None",
    "",
    "Notes:",
    issue.notes?.trim().length ? issue.notes : "None",
    "",
    "Labels:",
    issue.labels.length > 0 ? issue.labels.join(", ") : "None",
    "",
    "Dependencies:",
    formatDependencies(issue),
  ];

  if (workflow === "refine") {
    sections.push(
      "",
      "Refine this issue into an implementation-ready plan.",
      "Clarify scope, risks, assumptions, acceptance criteria, and propose a concrete implementation plan.",
    );
  } else if (workflow === "solve") {
    sections.push(
      "",
      "Implement this issue.",
      "Keep the issue context grounded throughout the work and summarize any follow-up work that should be recorded back into beads.",
    );
  } else {
    sections.push(
      "",
      "Continue working on this issue in this dedicated thread.",
      "Use the existing issue context, make forward progress, and call out follow-up work that should be tracked in beads.",
    );
  }

  return sections.join("\n");
}

function buildEpicQuickRefineThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Quick refine)`;
}

function buildEpicPlannedRefineThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Planned refine)`;
}

type EpicPlanImplementationIntent = "create_swarm" | "repair_swarm";

function resolveEpicPlanImplementationIntent(
  validation: Pick<BeadsSwarmValidation, "swarm">,
): EpicPlanImplementationIntent {
  return validation.swarm === null ? "create_swarm" : "repair_swarm";
}

function buildEpicPlanImplementationThreadTitle(
  issue: BeadsIssueSummaryType,
  intent: EpicPlanImplementationIntent,
): string {
  return `${issue.id}: ${issue.title} (${intent === "create_swarm" ? "Create swarm" : "Repair swarm"})`;
}

function buildEpicRefinePrompt(issue: BeadsIssueDetailType, mode: "quick" | "planned"): string {
  const sections = [
    `Epic: ${issue.id}`,
    `Title: ${issue.title}`,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority === null ? "unset" : `P${issue.priority}`}`,
    "",
    "Description:",
    issue.description?.trim().length ? issue.description : "None",
    "",
    "Notes:",
    issue.notes?.trim().length ? issue.notes : "None",
    "",
    "Labels:",
    issue.labels.length > 0 ? issue.labels.join(", ") : "None",
    "",
    "Dependencies:",
    formatDependencies(issue),
  ];

  if (mode === "quick") {
    sections.push(
      "",
      "Refine this epic in a working thread.",
      "Break it into concrete child issues, capture sequencing and blockers, and record any tracker follow-up that should be created or updated.",
    );
  } else {
    sections.push(
      "",
      "Produce a tracker refinement plan for this epic.",
      "Do not implement code. Generate a concrete refinement plan that can be applied back into beads later, including proposed child issues, dependencies, sequencing, and any tracker updates.",
    );
  }

  return sections.join("\n");
}

function formatIssueRelationList(issues: ReadonlyArray<BeadsIssueRelationSummaryType>): string {
  if (issues.length === 0) {
    return "None";
  }

  return issues.map((issue) => `- ${issue.id}: ${issue.title} [${issue.status}]`).join("\n");
}

function buildEpicPlanImplementationPrompt(input: {
  issue: BeadsIssueDetailType;
  validation: BeadsSwarmValidation;
  status: BeadsSwarmStatus;
  intent: EpicPlanImplementationIntent;
}): string {
  const sections = [
    `Epic: ${input.issue.id}`,
    `Title: ${input.issue.title}`,
    `Status: ${input.issue.status}`,
    `Priority: ${input.issue.priority === null ? "unset" : `P${input.issue.priority}`}`,
    "",
    "Description:",
    input.issue.description?.trim().length ? input.issue.description : "None",
    "",
    "Notes:",
    input.issue.notes?.trim().length ? input.issue.notes : "None",
    "",
    "Current swarm:",
    input.validation.swarm
      ? `${input.validation.swarm.swarmId} (${input.validation.valid ? "valid" : "needs work"})`
      : "No swarm exists yet",
    "",
    "Validation errors:",
    input.validation.errors.length > 0
      ? input.validation.errors.map((error) => `- ${error}`).join("\n")
      : "None",
    "",
    "Validation warnings:",
    input.validation.warnings.length > 0
      ? input.validation.warnings.map((warning) => `- ${warning}`).join("\n")
      : "None",
    "",
    "Ready issues:",
    formatIssueRelationList(input.status.ready),
    "",
    "Active issues:",
    formatIssueRelationList(input.status.active),
    "",
    "Blocked issues:",
    formatIssueRelationList(input.status.blocked),
    "",
    input.intent === "create_swarm"
      ? "Prepare swarm-backed implementation for this epic by creating the missing swarm."
      : "Prepare swarm-backed implementation for this epic by repairing the existing swarm.",
    input.intent === "create_swarm"
      ? "This is tracker-only coordination work. Use bd to create the epic swarm required for implementation and any required tracker metadata."
      : "This is tracker-only coordination work. Use bd to repair the existing epic swarm required for implementation and correct any tracker metadata drift.",
    input.intent === "create_swarm"
      ? "Do not describe this as a repair task because no swarm exists yet."
      : "Repair the current swarm instead of creating a replacement unless recovery is impossible.",
    "Do not implement application code, and do not create a worktree unless tracker-only recovery is impossible.",
    "When you finish, summarize the resulting swarm state and any blockers that still prevent launching worker threads.",
  ];

  return sections.join("\n");
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
  ): Effect.Effect<Awaited<ReturnType<typeof runProcess>>, BeadsError> =>
    Effect.tryPromise({
      try: () =>
        runProcess("bd", args, {
          cwd,
          allowNonZeroExit: true,
          outputMode: "truncate",
          maxBufferBytes: MAX_BD_OUTPUT_BYTES,
        }),
      catch: (cause) => toBeadsError("Failed to run bd.", cause),
    });

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
  ): Effect.Effect<string, BeadsError> =>
    runBdProcess(cwd, args).pipe(Effect.flatMap((result) => decodeBdProcessResult(result)));

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
      withSerializedBdAccess(cwd, runBdRawProcess(cwd, ["context", "--json"])).pipe(
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
        return yield* withSerializedBdAccess(cwd, runBdRawProcess(cwd, args));
      }

      if (isBdContextCommand(args)) {
        const cached = yield* getCachedBdExecutionStrategy(cwd);
        if (cached) {
          return yield* (
            cached === "parallel"
              ? runBdRawProcess(cwd, args)
              : withSerializedBdAccess(cwd, runBdRawProcess(cwd, args))
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
            ? runBdRawProcess(cwd, args)
            : withSerializedBdAccess(cwd, runBdRawProcess(cwd, args));
        }

        const exit = yield* Effect.exit(
          withSerializedBdAccess(cwd, runBdRawProcess(cwd, args)).pipe(
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
        ? runBdRawProcess(cwd, args)
        : withSerializedBdAccess(cwd, runBdRawProcess(cwd, args));
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
      ["history", issueId],
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

  const listSwarms: BeadsTrackerServiceShape["listSwarms"] = (input) =>
    Effect.gen(function* () {
      const support = yield* getSwarmSupport({ cwd: input.cwd });
      if (!support.supported) {
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
    listSwarms({ cwd: input.cwd }).pipe(
      Effect.map(
        (result) => result.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null,
      ),
    );

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

      const [swarm, rawValidation] = yield* Effect.all(
        [
          getEpicSwarm(input),
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
      const validationSwarm =
        swarm === null &&
        trimToNull(rawValidation.swarm_id) === null &&
        trimToNull(rawValidation.id) === null &&
        trimToNull(rawValidation.epic_id) === null
          ? null
          : mapSwarmSummary(rawValidation, swarm ?? undefined);

      return decodeSwarmValidation({
        epicId: epic.id,
        epicTitle: epic.title,
        swarm: validationSwarm,
        valid: asBoolean(rawValidation.valid) ?? asStringArray(rawValidation.errors).length === 0,
        errors: asStringArray(rawValidation.errors),
        warnings: asStringArray(rawValidation.warnings),
        readyFronts: mapReadyFronts(rawValidation.ready_fronts),
        estimatedWorkerSessions:
          asNumber(rawValidation.estimated_worker_sessions) ??
          asNumber(rawValidation.estimated_sessions),
        maxParallelism: asNumber(rawValidation.max_parallelism),
      });
    });

  const getEpicSwarmStatus: BeadsTrackerServiceShape["getEpicSwarmStatus"] = (input) =>
    Effect.gen(function* () {
      const [rawEpic, support] = yield* Effect.all(
        [getRawIssue(input.cwd, input.epicIssueId), getSwarmSupport({ cwd: input.cwd })],
        { concurrency: "unbounded" },
      );
      const epic = mapIssueSummary(rawEpic);
      const childIssueRecordById = buildIssueRecordLookup(
        asRecordArray(rawEpic.dependents).filter(
          (entry) => trimToNull(entry.dependency_type) === "parent-child",
        ),
      );

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

      const [swarm, rawStatus] = yield* Effect.all(
        [
          getEpicSwarm(input),
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
      const rawStatusSwarm = asRecord(rawStatus.swarm);
      const statusSwarm =
        swarm === null &&
        rawStatusSwarm === null &&
        trimToNull(rawStatus.epic_id) === null &&
        trimToNull(rawStatus.epic_title) === null
          ? null
          : mapSwarmSummary(
              {
                ...rawStatusSwarm,
                epic_id: rawStatus.epic_id ?? rawStatusSwarm?.epic_id,
                epic_title: rawStatus.epic_title ?? rawStatusSwarm?.epic_title,
                total_issues: rawStatus.total_issues ?? rawStatusSwarm?.total_issues,
                completed_issues:
                  rawStatus.completed_issues ?? asRecordArray(rawStatus.completed).length,
                active_issues:
                  rawStatus.active_issues ??
                  rawStatus.active_count ??
                  asRecordArray(rawStatus.active).length,
                ready_issues:
                  rawStatus.ready_issues ??
                  rawStatus.ready_count ??
                  asRecordArray(rawStatus.ready).length,
                blocked_issues:
                  rawStatus.blocked_issues ??
                  rawStatus.blocked_count ??
                  asRecordArray(rawStatus.blocked).length,
              },
              swarm ?? undefined,
            );

      return decodeSwarmStatus({
        epicId: epic.id,
        epicTitle: epic.title,
        swarm: statusSwarm,
        completed: mapIssueRelationArray(rawStatus.completed, childIssueRecordById),
        active: mapIssueRelationArray(rawStatus.active, childIssueRecordById),
        ready: mapIssueRelationArray(rawStatus.ready, childIssueRecordById),
        blocked: mapIssueRelationArray(rawStatus.blocked, childIssueRecordById),
      });
    });

  return {
    queryIssues,
    getIssue,
    updateIssue,
    commentIssue,
    getContext,
    getSwarmSupport,
    getIssueGraph,
    getEpicSwarm,
    validateEpicSwarm,
    getEpicSwarmStatus,
    listSwarms,
  } satisfies BeadsTrackerServiceShape;
});

const makeBeadsService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const beadsTracker = yield* BeadsTrackerService;
  const sessionActivityRef = yield* Ref.make<ReadonlyArray<SessionActivityRecord>>([]);

  const appendSessionActivity = (record: SessionActivityRecord) =>
    Ref.update(sessionActivityRef, (records) => [record, ...records].slice(0, 200));

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
      workflowKind: BeadsStartWorkflowInput["workflow"] | "plan-implementation";
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

      yield* appendSessionActivity({
        cwd: input.cwd,
        entry: {
          kind: "workflow-started",
          issue: input.issue,
          createdAt,
          workflowKind: input.workflowKind,
          threadId: nextThreadId,
        },
      });

      return {
        threadId: nextThreadId,
        created: true,
      } satisfies BeadsStartWorkflowResult;
    },
  );

  const queryIssues: BeadsServiceShape["queryIssues"] = (input) => beadsTracker.queryIssues(input);
  const getIssue: BeadsServiceShape["getIssue"] = (input) => beadsTracker.getIssue(input);

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
  const loadEpicCoordinatorTrackerState = (input: {
    cwd: string;
    epicIssueId: string;
    support: BeadsSwarmSupportType;
  }): Effect.Effect<
    {
      readonly validation: BeadsSwarmValidation | null;
      readonly status: BeadsSwarmStatus | null;
      readonly validationError: string | null;
      readonly statusError: string | null;
    },
    never
  > =>
    Effect.gen(function* () {
      if (!input.support.supported) {
        return {
          validation: null,
          status: null,
          validationError: null,
          statusError: null,
        } as const;
      }

      const [validationResult, statusResult] = yield* Effect.all(
        [
          Effect.exit(
            beadsTracker.validateEpicSwarm({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
          ),
          Effect.exit(
            beadsTracker.getEpicSwarmStatus({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
          ),
        ],
        { concurrency: "unbounded" },
      );

      return {
        validation: validationResult._tag === "Success" ? validationResult.value : null,
        status: statusResult._tag === "Success" ? statusResult.value : null,
        validationError:
          validationResult._tag === "Failure"
            ? errorMessageFromCause(validationResult.cause)
            : null,
        statusError:
          statusResult._tag === "Failure" ? errorMessageFromCause(statusResult.cause) : null,
      } as const;
    });

  const getProjectCoordinatorSnapshot: BeadsServiceShape["getProjectCoordinatorSnapshot"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const [support, epicIssuesResult, swarms, readModel] = yield* Effect.all(
        [
          beadsTracker.getSwarmSupport({ cwd: input.cwd }),
          beadsTracker.queryIssues({
            cwd: input.cwd,
            issueTypes: ["epic"],
            sortBy: "updated",
          }),
          beadsTracker.listSwarms({ cwd: input.cwd }),
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
      const perEpicStateEntries = yield* Effect.forEach(
        new Set([
          ...epicIssuesResult.issues.map((issue) => issue.id),
          ...swarms.swarms.map((swarm) => swarm.epicId),
          ...readModel.swarmRuns
            .filter((run) => run.projectId === input.projectId)
            .map((run) => run.epicIssueId),
        ]),
        (epicIssueId) =>
          loadEpicCoordinatorTrackerState({
            cwd: input.cwd,
            epicIssueId,
            support,
          }).pipe(Effect.map((state) => [epicIssueId, state] as const)),
        { concurrency: "unbounded" },
      );

      return decodeProjectCoordinatorSnapshot(
        buildProjectCoordinatorSnapshot({
          projectId: input.projectId,
          support,
          epicIssues: epicIssuesResult.issues,
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
      const trackerState = yield* loadEpicCoordinatorTrackerState({
        cwd: input.cwd,
        epicIssueId: input.epicIssueId,
        support,
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
      const readModel = yield* orchestrationEngine
        .getReadModel()
        .pipe(
          Effect.mapError((cause) => toBeadsError("Failed to load orchestration state.", cause)),
        );

      if (input.workflow === "continue") {
        const existingThread = readModel.threads
          .filter(
            (thread) =>
              thread.projectId === input.projectId &&
              thread.deletedAt === null &&
              thread.issueLink?.issueId === input.issueId,
          )
          .toSorted((left, right) => {
            const archivedDelta =
              Number(left.archivedAt !== null) - Number(right.archivedAt !== null);
            if (archivedDelta !== 0) {
              return archivedDelta;
            }
            return right.updatedAt.localeCompare(left.updatedAt);
          })[0];

        if (existingThread) {
          yield* appendSessionActivity({
            cwd: input.cwd,
            entry: {
              kind: "workflow-started",
              issue,
              createdAt: nowIso(),
              workflowKind: input.workflow,
              threadId: existingThread.id,
            },
          });

          return {
            threadId: existingThread.id,
            created: false,
          } satisfies BeadsStartWorkflowResult;
        }
      }

      const nextInteractionMode = input.workflow === "refine" ? "plan" : "default";
      const nextThreadTitle = buildWorkflowThreadTitle(issue);
      const promptText = buildWorkflowPrompt(issue, input.workflow);

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

  const startEpicPlanImplementation: BeadsServiceShape["startEpicPlanImplementation"] = (input) =>
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
          support.reason ?? "Swarm-backed implementation is unavailable for this beads backend.",
        );
      }

      const [validation, status] = yield* Effect.all(
        [
          beadsTracker.validateEpicSwarm({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
          beadsTracker.getEpicSwarmStatus({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
        ],
        { concurrency: "unbounded" },
      );
      const intent = resolveEpicPlanImplementationIntent(validation);

      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue: epic,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        threadTitle: buildEpicPlanImplementationThreadTitle(epic, intent),
        promptText: buildEpicPlanImplementationPrompt({
          issue: epic,
          validation,
          status,
          intent,
        }),
        workflowKind: "plan-implementation",
        createThreadErrorMessage: "Failed to create epic implementation-planning thread.",
        startTurnErrorMessage: "Failed to start epic implementation-planning workflow.",
      });
    });

  return {
    queryIssues,
    getIssue,
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
    startEpicQuickRefine,
    startEpicPlannedRefine,
    startEpicPlanImplementation,
  } satisfies BeadsServiceShape;
});

export const BeadsTrackerServiceLive = Layer.effect(BeadsTrackerService, makeBeadsTrackerService);
export const BeadsServiceLive = Layer.effect(BeadsService, makeBeadsService);
