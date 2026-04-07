import path from "node:path";

import {
  BeadsContext,
  BeadsError,
  BeadsGetSessionActivityResult,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueRelationSummary,
  BeadsIssueSummary,
  BeadsListSwarmsResult,
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
import { Effect, Layer, Option, Ref, Schema, Semaphore, SynchronizedRef } from "effect";

import { runProcess } from "../../processRunner.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { BeadsService, type BeadsServiceShape } from "../Services/BeadsService.ts";

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

interface SessionActivityRecord {
  readonly cwd: string;
  readonly entry: BeadsSessionActivityEntry;
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

function asNonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = asNumber(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : fallback;
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

function mapIssueRelationSummary(raw: Record<string, unknown>): BeadsIssueRelationSummaryType {
  return decodeIssueRelationSummary({
    id: raw.id,
    title: raw.title,
    status: raw.status,
    priority: asNumber(raw.priority),
    issueType: raw.issue_type,
    assignee: trimToNull(raw.assignee),
    owner: trimToNull(raw.owner),
    parent: mapParentRef(raw),
  });
}

function mapIssueRelationArray(value: unknown): BeadsIssueRelationSummaryType[] {
  return asRecordArray(value).map((entry) => mapIssueRelationSummary(entry));
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

function mapSwarmSummary(raw: Record<string, unknown>): BeadsSwarmSummaryType {
  return decodeSwarmSummary({
    swarmId: trimToNull(raw.swarm_id) ?? trimToNull(raw.id),
    epicId: trimToNull(raw.epic_id),
    epicTitle: trimToNull(raw.epic_title) ?? trimToNull(raw.title) ?? trimToNull(raw.epic_id),
    totalIssueCount: asNonNegativeInt(raw.total_issue_count ?? raw.issue_count),
    completedIssueCount: asNonNegativeInt(raw.completed_issue_count),
    activeIssueCount: asNonNegativeInt(raw.active_issue_count),
    readyIssueCount: asNonNegativeInt(raw.ready_issue_count),
    blockedIssueCount: asNonNegativeInt(raw.blocked_issue_count),
    activeWorkerCount: asNonNegativeInt(raw.active_worker_count ?? raw.active_workers),
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

function buildEpicPlanImplementationThreadTitle(issue: BeadsIssueSummaryType): string {
  return `${issue.id}: ${issue.title} (Plan implementation)`;
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
    "Prepare swarm-backed implementation for this epic.",
    "This is tracker-only coordination work. Use bd to create or repair the epic swarm required for implementation and any required tracker metadata.",
    "Do not implement application code, and do not create a worktree unless tracker-only recovery is impossible.",
    "When you finish, summarize the resulting swarm state and any blockers that still prevent launching worker threads.",
  ];

  return sections.join("\n");
}

const makeBeadsService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const sessionActivityRef = yield* Ref.make<ReadonlyArray<SessionActivityRecord>>([]);
  const bdLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());

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

  const getBdSemaphore = (cwd: string): Effect.Effect<Semaphore.Semaphore> =>
    SynchronizedRef.modifyEffect(bdLocksRef, (current) => {
      const key = path.resolve(cwd);
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

  const runBdRaw = Effect.fn("BeadsService.runBdRaw")(function* (
    cwd: string,
    args: ReadonlyArray<string>,
  ) {
    const semaphore = yield* getBdSemaphore(cwd);
    const result = yield* semaphore.withPermit(
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

    if (result.timedOut) {
      return yield* toBeadsError("Beads command timed out.");
    }

    if (result.code !== 0) {
      const stdout = result.stdout.trim();
      const parsedMessage = parseBdErrorMessage(stdout);
      if (parsedMessage) {
        return yield* toBeadsError(parsedMessage);
      }

      const detail =
        trimToNull(result.stderr) ?? trimToNull(result.stdout) ?? "Beads command failed.";
      return yield* toBeadsError(detail);
    }

    return result.stdout;
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

  const queryIssues: BeadsServiceShape["queryIssues"] = (input) =>
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

  const getIssue: BeadsServiceShape["getIssue"] = (input) => getIssueDetail(input);

  const updateIssue: BeadsServiceShape["updateIssue"] = (input) =>
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

      const updated = yield* runBdJson(input.cwd, args, (json) => {
        const items = Array.isArray(json) ? json : [];
        const issue = items[0] as Record<string, unknown> | undefined;
        if (!issue) {
          throw new Error(`Issue '${input.issueId}' was not updated.`);
        }
        return mapIssueSummary(issue);
      });

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
      yield* runBdRaw(input.cwd, ["comment", input.issueId, input.text]);
      const detail = yield* getIssueDetail({ cwd: input.cwd, issueId: input.issueId });
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

  const getContext: BeadsServiceShape["getContext"] = (input) =>
    runBdJson(input.cwd, ["context"], (json) => {
      const record = asRecord(json);
      if (!record) {
        throw new Error("Expected beads context object.");
      }
      return mapBeadsContext(record);
    });

  const getSwarmSupport: BeadsServiceShape["getSwarmSupport"] = (input) =>
    getContext({ cwd: input.cwd }).pipe(Effect.map((context) => deriveSwarmSupport(context)));

  const listSwarms: BeadsServiceShape["listSwarms"] = (input) =>
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

  const getIssueGraph: BeadsServiceShape["getIssueGraph"] = (input) =>
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

  const getEpicSwarm: BeadsServiceShape["getEpicSwarm"] = (input) =>
    listSwarms({ cwd: input.cwd }).pipe(
      Effect.map(
        (result) => result.swarms.find((swarm) => swarm.epicId === input.epicIssueId) ?? null,
      ),
    );

  const validateEpicSwarm: BeadsServiceShape["validateEpicSwarm"] = (input) =>
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

      return decodeSwarmValidation({
        epicId: epic.id,
        epicTitle: epic.title,
        swarm,
        valid: asBoolean(rawValidation.valid) ?? asStringArray(rawValidation.errors).length === 0,
        errors: asStringArray(rawValidation.errors),
        warnings: asStringArray(rawValidation.warnings),
        readyFronts: mapReadyFronts(rawValidation.ready_fronts),
        estimatedWorkerSessions: asNumber(rawValidation.estimated_worker_sessions),
        maxParallelism: asNumber(rawValidation.max_parallelism),
      });
    });

  const getEpicSwarmStatus: BeadsServiceShape["getEpicSwarmStatus"] = (input) =>
    Effect.gen(function* () {
      const [epic, support] = yield* Effect.all(
        [
          getRawIssue(input.cwd, input.epicIssueId).pipe(Effect.map((raw) => mapIssueSummary(raw))),
          getSwarmSupport({ cwd: input.cwd }),
        ],
        { concurrency: "unbounded" },
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

      return decodeSwarmStatus({
        epicId: epic.id,
        epicTitle: epic.title,
        swarm,
        completed: mapIssueRelationArray(rawStatus.completed),
        active: mapIssueRelationArray(rawStatus.active),
        ready: mapIssueRelationArray(rawStatus.ready),
        blocked: mapIssueRelationArray(rawStatus.blocked),
      });
    });

  const startWorkflow: BeadsServiceShape["startWorkflow"] = (input) =>
    Effect.gen(function* () {
      const issue = yield* getIssueDetail({ cwd: input.cwd, issueId: input.issueId });
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
      const epic = yield* getIssueDetail({ cwd: input.cwd, issueId: input.epicIssueId });
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
      const epic = yield* getIssueDetail({ cwd: input.cwd, issueId: input.epicIssueId });
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
          getSwarmSupport({ cwd: input.cwd }),
          getIssueDetail({ cwd: input.cwd, issueId: input.epicIssueId }),
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
          validateEpicSwarm({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
          getEpicSwarmStatus({ cwd: input.cwd, epicIssueId: input.epicIssueId }),
        ],
        { concurrency: "unbounded" },
      );

      return yield* startLinkedIssueThread({
        cwd: input.cwd,
        projectId: input.projectId,
        issue: epic,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: "default",
        threadTitle: buildEpicPlanImplementationThreadTitle(epic),
        promptText: buildEpicPlanImplementationPrompt({
          issue: epic,
          validation,
          status,
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
    getSessionActivity,
    startWorkflow,
    startEpicQuickRefine,
    startEpicPlannedRefine,
    startEpicPlanImplementation,
  } satisfies BeadsServiceShape;
});

export const BeadsServiceLive = Layer.effect(BeadsService, makeBeadsService);
