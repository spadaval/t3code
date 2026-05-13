// @ts-nocheck
import { assert, it } from "@effect/vitest";
import {
  BeadsError,
  ProjectId,
  EpicRunId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { Cause, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import {
  OrchestrationCommandInvariantError,
  type OrchestrationDispatchError,
} from "../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { BeadsService } from "../Services/BeadsService.ts";
import {
  BeadsServiceLive,
  BeadsTrackerServiceLive,
  clearBeadsReadCachesForTesting,
} from "./BeadsService.ts";

const mockedRunProcess = vi.mocked(runProcess);
function makeEmptyReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: new Date().toISOString(),
    planImplementationLaunches: [],
    epicRuns: [],
    epicIssueExecutions: [],
    projects: [],
    threads: [],
  };
}

const mockedGetReadModel = vi.fn(() => Effect.succeed(makeEmptyReadModel()));
const mockedListProjectLinkedIssueThreads = vi.fn(() => Effect.succeed([]));
const mockedGetEpicWorkflowRuntimeState = vi.fn(() =>
  Effect.succeed({
    projectEpicRuns: [],
    epicIssueExecutions: [],
  }),
);
const mockedDispatch = vi.fn<
  (command: unknown) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>
>((_: unknown) => Effect.die("dispatch was not expected in this test"));

const orchestrationEngineLayer = Layer.mock(OrchestrationEngineService)({
  getReadModel: () => mockedGetReadModel(),
  readEvents: () => Stream.empty,
  dispatch: (command) => mockedDispatch(command),
  streamDomainEvents: Stream.empty,
});

const projectionSnapshotQueryLayer = Layer.mock(ProjectionSnapshotQuery)({
  getCommandReadModel: () => mockedGetReadModel(),
  getSnapshot: () => mockedGetReadModel(),
  getShellSnapshot: () => Effect.die("getShellSnapshot was not expected in this test"),
  getSnapshotSequence: () => Effect.die("getSnapshotSequence was not expected in this test"),
  getCounts: () => Effect.die("getCounts was not expected in this test"),
  getActiveProjectByWorkspaceRoot: () =>
    Effect.die("getActiveProjectByWorkspaceRoot was not expected in this test"),
  getProjectShellById: () => Effect.die("getProjectShellById was not expected in this test"),
  getFirstActiveThreadIdByProjectId: () =>
    Effect.die("getFirstActiveThreadIdByProjectId was not expected in this test"),
  getThreadCheckpointContext: () =>
    Effect.die("getThreadCheckpointContext was not expected in this test"),
  getEpicWorkflowRuntimeState: (input) => mockedGetEpicWorkflowRuntimeState(input),
  listPendingCheckpointCaptures: () => Effect.succeed([]),
  listProjectLinkedIssueThreads: (projectId) => mockedListProjectLinkedIssueThreads(projectId),
  getThreadShellById: () => Effect.die("getThreadShellById was not expected in this test"),
  getThreadDetailById: () => Effect.succeed(Option.none()),
});

const layer = it.layer(
  BeadsServiceLive.pipe(
    Layer.provide(BeadsTrackerServiceLive),
    Layer.provide(projectionSnapshotQueryLayer),
    Layer.provide(orchestrationEngineLayer),
  ),
);

afterEach(() => {
  mockedRunProcess.mockReset();
  mockedGetReadModel.mockReset();
  mockedListProjectLinkedIssueThreads.mockReset();
  mockedGetEpicWorkflowRuntimeState.mockReset();
  mockedDispatch.mockReset();
  Effect.runSync(clearBeadsReadCachesForTesting());
  mockedGetReadModel.mockImplementation(() => Effect.succeed(makeEmptyReadModel()));
  mockedListProjectLinkedIssueThreads.mockImplementation(() => Effect.succeed([]));
  mockedGetEpicWorkflowRuntimeState.mockImplementation(() =>
    Effect.succeed({
      projectEpicRuns: [],
      epicIssueExecutions: [],
    }),
  );
  mockedDispatch.mockImplementation((_: unknown) =>
    Effect.die("dispatch was not expected in this test"),
  );
});

function successJson(value: unknown) {
  return {
    stdout: JSON.stringify(value),
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
  } as const;
}

function commandKey(args: readonly string[]): string {
  return args
    .filter((arg) => arg !== "--json")
    .map((arg) => (arg.startsWith("--id=") ? arg.slice("--id=".length) : arg))
    .join(" ");
}

function installBdJsonMock(outputs: Record<string, unknown>) {
  mockedRunProcess.mockImplementation(async (_command, args) => {
    const key = commandKey(args);
    const nonJsonArgs = args.filter((arg) => arg !== "--json");
    const showIds =
      nonJsonArgs[0] === "show"
        ? nonJsonArgs.flatMap((arg, index) => {
            if (index === 0 || arg === "--long") return [];
            return arg.startsWith("--id=") ? [arg.slice("--id=".length)] : [arg];
          })
        : [];
    const output =
      outputs[key] ??
      (showIds.length > 1
        ? showIds.flatMap((issueId) => {
            const issueOutput = outputs[`show ${issueId} --long`];
            return Array.isArray(issueOutput) ? issueOutput : [];
          })
        : undefined) ??
      (args[0] === "history" && args.includes("--limit")
        ? outputs[
            args
              .filter((arg, index, allArgs) => {
                if (arg === "--json") return false;
                if (arg === "--limit") return false;
                if (index > 0 && allArgs[index - 1] === "--limit") return false;
                return true;
              })
              .join(" ")
          ]
        : undefined);
    if (output === undefined) {
      throw new Error(`Unexpected bd args: ${args.join(" ")}`);
    }
    return successJson(output);
  });
}

function countBdCommandCalls(prefix: string): number {
  return mockedRunProcess.mock.calls.filter(([, args]) => commandKey(args).startsWith(prefix))
    .length;
}

function makeLinkedThreadFixture(input: {
  id: string;
  title: string;
  issueId: string;
  interactionMode: "default" | "plan";
  now: string;
  archivedAt?: string | null;
}): OrchestrationThread {
  return {
    id: ThreadId.makeUnsafe(input.id),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: input.title,
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    interactionMode: input.interactionMode,
    runtimeMode: "full-access" as const,
    branch: null,
    worktreePath: null,
    issueLink: {
      issueId: input.issueId,
      title: "Implement settings persistence",
      status: "open",
      priority: 2,
      repoRoot: "/repo",
      linkedAt: input.now,
    },
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: input.archivedAt ?? null,
    latestTurn: null,
    messages: [],
    session: null,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    pendingCheckpointCaptures: [],
    deletedAt: null,
  };
}

function toLinkedIssueThreadFixture(thread: OrchestrationThread) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    issueLink: thread.issueLink,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    deletedAt: thread.deletedAt,
  };
}

layer("BeadsServiceLive", (it) => {
  it.effect("serializes read-only bd access per repository in embedded mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-embedded";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "context") {
            return successJson({
              beads_dir: "/repo/.beads",
              repo_root: cwd,
              cwd_repo_root: cwd,
              is_redirected: false,
              is_worktree: false,
              backend: "dolt",
              dolt_mode: "embedded",
              database: "repo",
              project_id: "project-1",
              role: "contributor",
              bd_version: "1.0.0",
            });
          }

          if (action === "show") {
            return successJson([
              {
                id: "ISS-1",
                title: "Serialize beads access",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          if (action === "comments") {
            return successJson([]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [beads.getIssue({ cwd, issueId: "ISS-1" }), beads.getIssue({ cwd, issueId: "ISS-1" })],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(mockedRunProcess).toHaveBeenCalledTimes(3);
      expect(maxActiveCalls).toBe(1);
    }),
  );

  it.effect("allows read-only bd access to run in parallel in server mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-server";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "context") {
            return successJson({
              beads_dir: "/repo/.beads",
              repo_root: cwd,
              cwd_repo_root: cwd,
              is_redirected: false,
              is_worktree: false,
              backend: "dolt",
              dolt_mode: "server",
              database: "repo",
              project_id: "project-1",
              role: "contributor",
              bd_version: "1.0.0",
            });
          }

          if (action === "show") {
            return successJson([
              {
                id: "ISS-1",
                title: "Parallel beads access",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          if (action === "comments") {
            return successJson([]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [beads.getIssue({ cwd, issueId: "ISS-1" }), beads.getIssue({ cwd, issueId: "ISS-1" })],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(maxActiveCalls).toBeGreaterThan(1);
    }),
  );

  it.effect("loads issue detail without fetching history", () =>
    Effect.gen(function* () {
      const cwd = "/repo-history-limit";
      const now = new Date().toISOString();

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: cwd,
            cwd_repo_root: cwd,
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }

        if (key === "show ISS-1 --long") {
          return successJson([
            {
              id: "ISS-1",
              title: "Issue detail without history",
              description: "desc",
              notes: "notes",
              status: "open",
              priority: 1,
              issue_type: "feature",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
            },
          ]);
        }

        if (key === "comments ISS-1") {
          return successJson([]);
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const issue = yield* beads.getIssue({ cwd, issueId: "ISS-1" });

      assert.equal(issue.id, "ISS-1");
      expect(
        mockedRunProcess.mock.calls.some(([, args]) =>
          commandKey(args).startsWith("history ISS-1"),
        ),
      ).toBe(false);
    }),
  );

  it.effect("loads issue detail when comments are unavailable", () =>
    Effect.gen(function* () {
      const cwd = "/repo-comments-unavailable";
      const now = new Date().toISOString();

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: cwd,
            cwd_repo_root: cwd,
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }

        if (key === "show ISS-1 --long") {
          return successJson([
            {
              id: "ISS-1",
              title: "Issue detail without comments",
              description: "desc",
              notes: "notes",
              status: "open",
              priority: 1,
              issue_type: "feature",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
              dependencies: [],
              dependents: [],
            },
          ]);
        }

        if (key === "comments ISS-1") {
          return {
            stdout: '{"error":"comments unavailable"}',
            stderr: "",
            code: 1,
            signal: null,
            timedOut: false,
          } as const;
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const issue = yield* beads.getIssue({ cwd, issueId: "ISS-1" });

      assert.equal(issue.id, "ISS-1");
      assert.deepStrictEqual(issue.comments, []);
    }),
  );

  it.effect("reloads issue detail after an earlier read completes", () =>
    Effect.gen(function* () {
      const cwd = "/repo-live-issue";
      const now = new Date().toISOString();
      let title = "First title";

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: cwd,
            cwd_repo_root: cwd,
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }

        if (key === "show ISS-1 --long") {
          return successJson([
            {
              id: "ISS-1",
              title,
              description: "desc",
              notes: "notes",
              status: "open",
              priority: 1,
              issue_type: "feature",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
            },
          ]);
        }

        if (key === "comments ISS-1") {
          return successJson([]);
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const first = yield* beads.getIssue({ cwd, issueId: "ISS-1" });
      title = "Second title";
      const second = yield* beads.getIssue({ cwd, issueId: "ISS-1" });

      assert.equal(first.title, "First title");
      assert.equal(second.title, "Second title");
      expect(countBdCommandCalls("show ISS-1 --long")).toBe(2);
      expect(countBdCommandCalls("comments ISS-1")).toBe(2);
    }),
  );

  it.effect("loads issue batches as summaries", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show TASK-1": [
          {
            id: "TASK-1",
            title: "Batched issue",
            description: "desc",
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [
              {
                id: "DEP-1",
                title: "External dependency",
                status: "open",
                priority: 2,
                issue_type: "task",
                owner: "alice",
                created_at: now,
                created_by: "alice",
                updated_at: now,
                type: "blocks",
              },
            ],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.getIssues({ cwd: "/repo", issueIds: ["TASK-1"] });

      assert.equal(result.issues[0]?.id, "TASK-1");
      expect(countBdCommandCalls("comments TASK-1")).toBe(0);
      expect(countBdCommandCalls("show TASK-1 --long")).toBe(0);
    }),
  );

  it.effect("resolves issue references with found and missing issues", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Resolved task",
            description: "desc",
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
          },
        ],
        "show MISSING-1 --long": [],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.resolveIssueRefs({
        cwd: "/repo",
        issueIds: ["TASK-1", "TASK-1", "MISSING-1"],
      });

      expect(result.issues).toEqual([
        {
          id: "TASK-1",
          title: "Resolved task",
          status: "open",
          issueType: "task",
        },
      ]);
      expect(result.missingIssueIds).toEqual(["MISSING-1"]);
      expect(result.loadErrors).toEqual([]);
      expect(countBdCommandCalls("show TASK-1 MISSING-1")).toBe(1);
      expect(countBdCommandCalls("show TASK-1 MISSING-1 --long")).toBe(0);
    }),
  );

  it.effect("preserves per-issue resolver errors", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "maintainer",
            bd_version: "1.0.0",
          });
        }
        if (key === "show TASK-1 --long") {
          return successJson([
            {
              id: "TASK-1",
              title: "Resolved task",
              description: "desc",
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: "alice",
              created_at: now,
              created_by: "alice",
              updated_at: now,
              labels: [],
            },
          ]);
        }
        throw new Error(`bd show failed for ${key}`);
      });

      const beads = yield* BeadsService;
      const result = yield* beads.resolveIssueRefs({
        cwd: "/repo",
        issueIds: ["TASK-1", "BROKEN-1"],
      });

      expect(result.issues.map((issue) => issue.id)).toEqual(["TASK-1"]);
      expect(result.loadErrors).toEqual([
        {
          issueId: "BROKEN-1",
          message: "Failed to run bd: bd show failed for show BROKEN-1 --long",
        },
      ]);
    }),
  );

  it.effect("reloads issue queries after an earlier read completes", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      let listTitle = "Ready issue v1";

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "maintainer",
            bd_version: "1.0.0",
          });
        }

        if (key === "list --all --limit 0") {
          return successJson([
            {
              id: "TASK-1",
              title: listTitle,
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
            },
          ]);
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const first = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "updated",
      });
      listTitle = "Ready issue v2";
      const second = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "updated",
      });

      assert.equal(first.issues[0]?.title, "Ready issue v1");
      assert.equal(second.issues[0]?.title, "Ready issue v2");
      expect(countBdCommandCalls("list --all --limit 0")).toBe(2);
    }),
  );

  it.effect("rejects oversized issue reference resolution requests", () =>
    Effect.gen(function* () {
      const beads = yield* BeadsService;
      const exit = yield* beads
        .resolveIssueRefs({
          cwd: "/repo",
          issueIds: Array.from({ length: 51 }, (_, index) => `TASK-${index + 1}`),
        })
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        return;
      }
      expect(Cause.squash(exit.cause)).toMatchObject({
        message: "Cannot resolve more than 50 beads issue references per request.",
      });
    }),
  );

  it.effect("keeps write-capable bd commands serialized in server mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-server-write";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "update") {
            return successJson([
              {
                id: "ISS-1",
                title: args.at(-1) ?? "Updated issue",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [
          beads.updateIssue({ cwd, issueId: "ISS-1", title: "Left update" }),
          beads.updateIssue({ cwd, issueId: "ISS-1", title: "Right update" }),
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(mockedRunProcess).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);
    }),
  );

  it.effect("keeps beads context tracker-only", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "embedded",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
      });
      mockedGetReadModel.mockImplementation(() =>
        Effect.die("getCommandReadModel should not be used for beads context"),
      );

      const beads = yield* BeadsService;
      const context = yield* beads.getContext({ cwd: "/repo" });

      assert.equal(context.backend.kind, "dolt");
      assert.equal(context.backend.doltMode, "embedded");
    }),
  );

  it.effect("allows large JSON tracker reads to exceed the non-JSON truncation cap", () =>
    Effect.gen(function* () {
      const largeDescription = "x".repeat(400);
      const issues = Array.from({ length: 1400 }, (_, index) => ({
        id: `TASK-${index}`,
        title: `Task ${index}`,
        description: largeDescription,
        notes: null,
        status: "open",
        priority: 1,
        issue_type: "task",
        assignee: null,
        owner: null,
        created_at: new Date(index * 1_000).toISOString(),
        created_by: null,
        updated_at: new Date(index * 1_000).toISOString(),
        labels: [],
      }));
      const stdout = JSON.stringify(issues);
      expect(Buffer.byteLength(stdout)).toBeGreaterThan(512 * 1024);

      mockedRunProcess.mockImplementation(async (_command, args, options) => {
        if (commandKey(args) === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }
        expect(args).toEqual(["list", "--all", "--limit", "0", "--json"]);
        expect(options?.outputMode).toBe("error");
        expect(options?.maxBufferBytes).toBe(8 * 1024 * 1024);
        return {
          stdout,
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        sortBy: "updated",
      });

      assert.equal(result.issues.length, 200);
      assert.equal(result.issues[0]?.id, "TASK-1399");
    }),
  );

  it.effect("surfaces explicit oversized JSON buffer failures", () =>
    Effect.gen(function* () {
      mockedRunProcess.mockImplementation(async (_command, args, options) => {
        if (commandKey(args) === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }
        expect(args).toEqual(["list", "--all", "--limit", "0", "--json"]);
        expect(options?.outputMode).toBe("error");
        throw new Error(
          "bd list --all --limit 0 --json exceeded stdout buffer limit (8388608 bytes).",
        );
      });

      const beads = yield* BeadsService;
      const exit = yield* beads
        .queryIssues({
          cwd: "/repo",
          sortBy: "updated",
        })
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        return;
      }

      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(BeadsError);
      if (!Schema.is(BeadsError)(error)) {
        return;
      }

      expect(error.message).toBe(
        "Failed to run bd: bd list --all --limit 0 --json exceeded stdout buffer limit (8388608 bytes).",
      );
      expect((error.cause as Error).message).toBe(
        "bd list --all --limit 0 --json exceeded stdout buffer limit (8388608 bytes).",
      );
    }),
  );

  it.effect("preserves parent refs when querying visible issues for epic grouping", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Epic description",
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
          },
          {
            id: "TASK-1",
            title: "First child",
            description: "Implements the first step",
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            parent: "EPIC-1",
          },
          {
            id: "TASK-2",
            title: "Closed child",
            description: "Done already",
            notes: null,
            status: "closed",
            priority: 3,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            parent: "EPIC-1",
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "updated",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["EPIC-1", "TASK-1"],
      );
      assert.deepStrictEqual(result.issues[1]?.parent, {
        id: "EPIC-1",
        title: "Epic coordination",
      });
    }),
  );

  it.effect("reloads issue graphs after an earlier read completes", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      let childTitle = "First child";

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "maintainer",
            bd_version: "1.0.0",
          });
        }

        if (key === "show EPIC-1 --long") {
          return successJson([
            {
              id: "EPIC-1",
              title: "Epic coordination",
              description: null,
              notes: null,
              status: "open",
              priority: 2,
              issue_type: "epic",
              assignee: null,
              owner: "alice",
              created_at: now,
              created_by: "alice",
              updated_at: now,
              labels: [],
              dependencies: [],
              dependents: [
                {
                  id: "CHILD-1",
                  title: childTitle,
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: "alice",
                  parent_id: "EPIC-1",
                  parent_title: "Epic coordination",
                  dependency_type: "parent-child",
                },
              ],
            },
          ]);
        }

        if (key === "show CHILD-1") {
          return successJson([
            {
              id: "CHILD-1",
              title: childTitle,
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: "alice",
              created_at: now,
              created_by: "alice",
              updated_at: now,
              labels: [],
              parent_id: "EPIC-1",
              parent_title: "Epic coordination",
              dependencies: [],
              dependents: [],
            },
          ]);
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const first = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-1" });
      childTitle = "Updated child";
      const second = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(first.children[0]?.title, "First child");
      assert.equal(second.children[0]?.title, "Updated child");
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(2);
      expect(countBdCommandCalls("show CHILD-1")).toBe(2);
      expect(countBdCommandCalls("show CHILD-1 --long")).toBe(0);
    }),
  );

  it.effect("uses bd ready for ready issue queries", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
        ready: [
          {
            id: "TASK-READY",
            title: "Ready task",
            description: "Can start now",
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        mode: "ready",
        sortBy: "priority",
      });

      expect(mockedRunProcess.mock.calls.some(([, args]) => commandKey(args) === "ready")).toBe(
        true,
      );
      expect(
        mockedRunProcess.mock.calls.some(([, args]) => commandKey(args) === "list --all --limit 0"),
      ).toBe(false);
      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["TASK-READY"],
      );
    }),
  );

  it.effect("parses bd JSON payloads when stdout includes log lines", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();

      mockedRunProcess.mockImplementation(async (_command, args) => {
        const key = commandKey(args);
        if (key === "context") {
          return {
            stdout: `bd server ready\n${JSON.stringify({
              beads_dir: "/repo/.beads",
              repo_root: "/repo",
              cwd_repo_root: "/repo",
              is_redirected: false,
              is_worktree: false,
              backend: "dolt",
              dolt_mode: "server",
              database: "repo",
              project_id: "project-1",
              role: "contributor",
              bd_version: "1.0.0",
            })}\n`,
            stderr: "",
            code: 0,
            signal: null,
            timedOut: false,
          } as const;
        }

        if (key === "list --all --limit 0") {
          return {
            stdout: `warming tracker cache\n${JSON.stringify([
              {
                id: "TASK-1",
                title: "Ready issue",
                description: null,
                notes: null,
                status: "open",
                priority: 1,
                issue_type: "task",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ])}\ntracker query complete`,
            stderr: "",
            code: 0,
            signal: null,
            timedOut: false,
          } as const;
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "updated",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["TASK-1"],
      );
    }),
  );

  it.effect("includes closed issues when statuses are omitted", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "TASK-OPEN",
            title: "Open task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
          },
          {
            id: "TASK-CLOSED",
            title: "Closed task",
            description: null,
            notes: null,
            status: "closed",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        sortBy: "updated",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["TASK-CLOSED", "TASK-OPEN"],
      );
    }),
  );

  it.effect("sorts queried issues by created date descending", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "TASK-OLD",
            title: "Old task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-05T00:00:00Z",
            labels: [],
          },
          {
            id: "TASK-NEW",
            title: "New task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-03T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-04T00:00:00Z",
            labels: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "created",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["TASK-NEW", "TASK-OLD"],
      );
    }),
  );

  it.effect("sorts queried issues by title with updated-at tie breakers", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "TASK-BETA",
            title: "Beta task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-02T00:00:00Z",
            labels: [],
          },
          {
            id: "TASK-ALPHA-OLDER",
            title: "Alpha task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-01T00:00:00Z",
            labels: [],
          },
          {
            id: "TASK-ALPHA-NEWER",
            title: "alpha task",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-03T00:00:00Z",
            labels: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        statuses: ["open"],
        sortBy: "title",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["TASK-ALPHA-NEWER", "TASK-ALPHA-OLDER", "TASK-BETA"],
      );
    }),
  );

  it.effect("preserves dependency refs in queried issue summaries", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "TASK-2",
            title: "Second task",
            description: null,
            notes: null,
            status: "blocked",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-02T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-03T00:00:00Z",
            labels: [],
            dependencies: [
              {
                issue_id: "TASK-2",
                depends_on_id: "TASK-1",
                type: "blocks",
              },
            ],
          },
          {
            id: "TASK-1",
            title: "First task",
            description: null,
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-03T00:00:00Z",
            labels: [],
            dependencies: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        sortBy: "updated",
      });

      expect(result.issues.find((issue) => issue.id === "TASK-2")?.dependencyRefs).toEqual([
        {
          issueId: "TASK-2",
          dependsOnId: "TASK-1",
          dependencyType: "blocks",
        },
      ]);
    }),
  );

  it.effect("maps epic issue graph relations without reading comments", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Epic description",
            notes: "Epic notes",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            parent_id: "PARENT-1",
            parent_title: "Parent initiative",
            dependencies: [
              {
                id: "DEP-1",
                title: "Dependency",
                status: "open",
                priority: 1,
                issue_type: "task",
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                dependency_type: "blocks",
              },
            ],
            dependents: [
              {
                id: "CHILD-1",
                title: "First child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: "bob",
                owner: null,
                parent_id: "EPIC-1",
                parent_title: "Epic coordination",
                dependency_type: "parent-child",
              },
              {
                id: "FOLLOW-1",
                title: "Dependent issue",
                status: "blocked",
                priority: 3,
                issue_type: "task",
                assignee: null,
                owner: null,
                dependency_type: "blocks",
              },
            ],
          },
        ],
        "show CHILD-1 --long": [
          {
            id: "CHILD-1",
            title: "First child",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: "bob",
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            parent_id: "EPIC-1",
            parent_title: "Epic coordination",
            dependencies: [],
            dependents: [],
          },
        ],
        "show PARENT-1 --long": [
          {
            id: "PARENT-1",
            title: "Parent initiative",
            status: "open",
            priority: 1,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const graph = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(graph.epic.id, "EPIC-1");
      assert.equal(graph.parent?.id, "PARENT-1");
      assert.deepStrictEqual(
        graph.children.map((issue) => issue.id),
        ["CHILD-1"],
      );
      assert.deepStrictEqual(
        graph.dependencies.map((issue) => issue.id),
        ["DEP-1"],
      );
      assert.deepStrictEqual(
        graph.dependents.map((issue) => issue.id),
        ["FOLLOW-1"],
      );
      expect(countBdCommandCalls("comments EPIC-1")).toBe(0);
    }),
  );

  it.effect("sorts epic child issues by dependency order with created_at as the tie breaker", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Epic description",
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-04T00:00:00Z",
            labels: [],
            dependencies: [],
            dependents: [
              {
                id: "CHILD-2",
                title: "Depends on first child",
                status: "blocked",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
                dependency_type: "parent-child",
              },
              {
                id: "CHILD-3",
                title: "Second independent child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
                dependency_type: "parent-child",
              },
              {
                id: "CHILD-1",
                title: "First independent child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
                dependency_type: "parent-child",
              },
            ],
          },
        ],
        "show CHILD-1 --long": [
          {
            id: "CHILD-1",
            title: "First independent child",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-01T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-01T00:00:00Z",
            labels: [],
            parent_id: "EPIC-1",
            parent_title: "Epic coordination",
            dependencies: [],
            dependents: [],
          },
        ],
        "show CHILD-2 --long": [
          {
            id: "CHILD-2",
            title: "Depends on first child",
            description: null,
            notes: null,
            status: "blocked",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-03T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-03T00:00:00Z",
            labels: [],
            parent_id: "EPIC-1",
            parent_title: "Epic coordination",
            dependencies: [
              {
                id: "CHILD-1",
                title: "First independent child",
                status: "open",
                priority: 2,
                issue_type: "task",
                owner: null,
                created_at: "2024-01-01T00:00:00Z",
                created_by: null,
                updated_at: "2024-01-01T00:00:00Z",
                dependency_type: "depends_on",
              },
            ],
            dependents: [],
          },
        ],
        "show CHILD-3 --long": [
          {
            id: "CHILD-3",
            title: "Second independent child",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: "2024-01-02T00:00:00Z",
            created_by: null,
            updated_at: "2024-01-02T00:00:00Z",
            labels: [],
            parent_id: "EPIC-1",
            parent_title: "Epic coordination",
            dependencies: [],
            dependents: [],
          },
        ],
        "comments EPIC-1": [],
      });

      const beads = yield* BeadsService;
      const graph = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.deepStrictEqual(
        graph.children.map((issue) => issue.id),
        ["CHILD-1", "CHILD-3", "CHILD-2"],
      );
    }),
  );

  it.effect(
    "treats sibling `blocks` dependencies as predecessor edges when sorting epic children",
    () =>
      Effect.gen(function* () {
        installBdJsonMock({
          "show EPIC-STACK --long": [
            {
              id: "EPIC-STACK",
              title: "Stacked epic",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "epic",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:47:24Z",
              created_by: null,
              updated_at: "2026-04-12T03:50:36Z",
              labels: [],
              dependencies: [],
              dependents: [
                {
                  id: "PR4",
                  title: "PR4",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
                {
                  id: "PR6",
                  title: "PR6",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
                {
                  id: "PR1",
                  title: "PR1",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
                {
                  id: "PR3",
                  title: "PR3",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
                {
                  id: "PR5",
                  title: "PR5",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
                {
                  id: "PR2",
                  title: "PR2",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  assignee: null,
                  owner: null,
                  dependency_type: "parent-child",
                },
              ],
            },
          ],
          "show PR1 --long": [
            {
              id: "PR1",
              title: "PR1",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:47:57Z",
              created_by: null,
              updated_at: "2026-04-12T03:14:12Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "EPIC-STACK",
                  title: "Stacked epic",
                  status: "open",
                  priority: 1,
                  issue_type: "epic",
                  owner: null,
                  created_at: "2026-04-12T02:47:24Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:50:36Z",
                  dependency_type: "parent-child",
                },
              ],
              dependents: [],
            },
          ],
          "show PR2 --long": [
            {
              id: "PR2",
              title: "PR2",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:48:11Z",
              created_by: null,
              updated_at: "2026-04-12T03:14:30Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "PR1",
                  title: "PR1",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  owner: null,
                  created_at: "2026-04-12T02:47:57Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:14:12Z",
                  dependency_type: "blocks",
                },
                {
                  id: "EPIC-STACK",
                  title: "Stacked epic",
                  status: "open",
                  priority: 1,
                  issue_type: "epic",
                  owner: null,
                  created_at: "2026-04-12T02:47:24Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:50:36Z",
                  dependency_type: "parent-child",
                },
              ],
              dependents: [],
            },
          ],
          "show PR3 --long": [
            {
              id: "PR3",
              title: "PR3",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:48:30Z",
              created_by: null,
              updated_at: "2026-04-12T03:14:31Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "PR2",
                  title: "PR2",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  owner: null,
                  created_at: "2026-04-12T02:48:11Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:14:30Z",
                  dependency_type: "blocks",
                },
              ],
              dependents: [],
            },
          ],
          "show PR4 --long": [
            {
              id: "PR4",
              title: "PR4",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:48:49Z",
              created_by: null,
              updated_at: "2026-04-12T04:06:49Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "PR3",
                  title: "PR3",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  owner: null,
                  created_at: "2026-04-12T02:48:30Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:14:31Z",
                  dependency_type: "blocks",
                },
              ],
              dependents: [],
            },
          ],
          "show PR5 --long": [
            {
              id: "PR5",
              title: "PR5",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:49:05Z",
              created_by: null,
              updated_at: "2026-04-12T03:14:32Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "PR4",
                  title: "PR4",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  owner: null,
                  created_at: "2026-04-12T02:48:49Z",
                  created_by: null,
                  updated_at: "2026-04-12T04:06:49Z",
                  dependency_type: "blocks",
                },
              ],
              dependents: [],
            },
          ],
          "show PR6 --long": [
            {
              id: "PR6",
              title: "PR6",
              description: null,
              notes: null,
              status: "open",
              priority: 1,
              issue_type: "task",
              assignee: null,
              owner: null,
              created_at: "2026-04-12T02:49:25Z",
              created_by: null,
              updated_at: "2026-04-12T03:14:32Z",
              labels: [],
              parent_id: "EPIC-STACK",
              parent_title: "Stacked epic",
              dependencies: [
                {
                  id: "PR5",
                  title: "PR5",
                  status: "open",
                  priority: 1,
                  issue_type: "task",
                  owner: null,
                  created_at: "2026-04-12T02:49:05Z",
                  created_by: null,
                  updated_at: "2026-04-12T03:14:32Z",
                  dependency_type: "blocks",
                },
              ],
              dependents: [],
            },
          ],
          "comments EPIC-STACK": [],
        });

        const beads = yield* BeadsService;
        const graph = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-STACK" });

        assert.deepStrictEqual(
          graph.children.map((issue) => issue.id),
          ["PR1", "PR2", "PR3", "PR4", "PR5", "PR6"],
        );
      }),
  );

  it.effect("normalizes bd dependency type fields when deriving epic readiness", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "epic",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [
              {
                id: "TASK-1",
                title: "Ready child",
                status: "open",
                priority: 1,
                issue_type: "task",
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                type: "parent-child",
              },
            ],
          },
        ],
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Ready child",
            description: null,
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [
              {
                id: "EPIC-1",
                title: "Epic coordination",
                status: "open",
                priority: 1,
                issue_type: "epic",
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                type: "parent-child",
              },
            ],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const validation = yield* beads.validateEpicCoordination({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });
      const status = yield* beads.getEpicCoordinationStatus({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.equal(validation.valid, true);
      assert.deepStrictEqual(
        validation.readyFronts.map((front) => front.map((issue) => issue.id)),
        [["TASK-1"]],
      );
      assert.deepStrictEqual(
        status.ready.map((issue) => issue.id),
        ["TASK-1"],
      );
      assert.deepStrictEqual(status.blocked, []);
    }),
  );

  it.effect("derives coordination status from epic child records", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "shared",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Track epic swarm progress",
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependents: [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: "alice",
                dependency_type: "parent-child",
              },
              {
                id: "BLOCKED-1",
                title: "Blocked child",
                status: "blocked",
                priority: 1,
                issue_type: "task",
                assignee: null,
                owner: "bob",
                dependency_type: "parent-child",
              },
            ],
            dependencies: [],
          },
        ],
        "show READY-1 --long": [
          {
            id: "READY-1",
            title: "Ready child",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "show BLOCKED-1 --long": [
          {
            id: "BLOCKED-1",
            title: "Blocked child",
            status: "blocked",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: "bob",
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                owner: "alice",
                created_at: now,
                created_by: null,
                updated_at: now,
                dependency_type: "blocks",
              },
            ],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicCoordinationStatus({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.deepStrictEqual(status.ready, [
        {
          id: "READY-1",
          title: "Ready child",
          status: "open",
          priority: 2,
          issueType: "task",
          assignee: null,
          owner: "alice",
          parent: null,
        },
      ]);
      assert.deepStrictEqual(status.blocked, [
        {
          id: "BLOCKED-1",
          title: "Blocked child",
          status: "blocked",
          priority: 1,
          issueType: "task",
          assignee: null,
          owner: "bob",
          parent: null,
        },
      ]);
      assert.deepStrictEqual(status.blockedBreakdown.internal, [
        {
          id: "BLOCKED-1",
          title: "Blocked child",
          status: "blocked",
          priority: 1,
          issueType: "task",
          assignee: null,
          owner: "bob",
          parent: null,
        },
      ]);
    }),
  );

  it.effect("classifies blocked issues as unknown when dependency metadata is missing", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [
              {
                id: "BLOCKED-1",
                title: "Blocked child",
                status: "blocked",
                priority: 1,
                issue_type: "task",
                assignee: null,
                owner: "bob",
                dependency_type: "parent-child",
              },
            ],
          },
        ],
        "show BLOCKED-1 --long": [
          {
            id: "BLOCKED-1",
            title: "Blocked child",
            status: "blocked",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: "bob",
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            dependencies: [
              {
                title: "Unknown dependency",
                status: "open",
                priority: 1,
                issue_type: "task",
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                dependency_type: "blocks",
              },
            ],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicCoordinationStatus({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.deepStrictEqual(
        status.blockedBreakdown.unknown.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
    }),
  );

  it.effect("runs validateEpicCoordination without context or swarm reads", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const validation = yield* beads.validateEpicCoordination({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.equal(validation.epicId, "EPIC-1");
      expect(countBdCommandCalls("context")).toBe(0);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
      expect(countBdCommandCalls("swarm ")).toBe(0);
    }),
  );

  it.effect("runs getEpicCoordinationStatus without context or swarm reads", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicCoordinationStatus({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.equal(status.epicId, "EPIC-1");
      expect(countBdCommandCalls("context")).toBe(0);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
      expect(countBdCommandCalls("swarm ")).toBe(0);
    }),
  );

  it.effect(
    "loads epic workflow detail from narrow runtime state without hydrating the command read model",
    () =>
      Effect.gen(function* () {
        const now = new Date().toISOString();
        installBdJsonMock({
          context: {
            beads_dir: "/repo/.beads",
            repo_root: "/repo",
            cwd_repo_root: "/repo",
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "maintainer",
            bd_version: "1.0.0",
          },
          "show EPIC-1 --long": [
            {
              id: "EPIC-1",
              title: "Epic coordination",
              description: null,
              notes: null,
              status: "open",
              priority: 2,
              issue_type: "epic",
              assignee: null,
              owner: "alice",
              created_at: now,
              created_by: "alice",
              updated_at: now,
              labels: [],
              dependencies: [],
              dependents: [],
            },
          ],
        });
        mockedGetReadModel.mockImplementation(() =>
          Effect.die("getCommandReadModel should not be used for epic workflow detail"),
        );
        mockedGetEpicWorkflowRuntimeState.mockImplementation(({ projectId, epicIssueId }) =>
          Effect.succeed({
            projectEpicRuns: [
              {
                runId: EpicRunId.makeUnsafe("run-1"),
                projectId,
                epicIssueId,
                status: "running",
                provider: "codex",
                model: "gpt-5-codex",
                modelOptions: null,
                providerOptions: null,
                assistantDeliveryMode: null,
                runtimeMode: "full-access",
                failureContext: null,
                requestedAt: now,
                startedAt: now,
                stopRequestedAt: null,
                stoppedAt: null,
                failedAt: null,
                completedAt: null,
                updatedAt: now,
              },
            ],
            epicIssueExecutions: [
              {
                executionId: "exec-1" as never,
                runId: EpicRunId.makeUnsafe("run-1"),
                issueId: "TASK-1",
                workerThreadId: ThreadId.makeUnsafe("thread-1"),
                sequenceNumber: 1,
                status: "running",
                workspaceKey: "shared",
                workspacePath: null,
                failureContext: null,
                requestedAt: now,
                startedAt: now,
                stopRequestedAt: null,
                stoppedAt: null,
                completedAt: null,
                failedAt: null,
                updatedAt: now,
              },
            ],
          }),
        );

        const beads = yield* BeadsService;
        const detail = yield* beads.getEpicWorkflowDetail({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
          epicIssueId: "EPIC-1",
        });

        assert.equal(detail.epicId, "EPIC-1");
        assert.equal(detail.activeRunId, EpicRunId.makeUnsafe("run-1"));
        assert.equal(detail.activeExecutionId, "exec-1");
        expect(mockedGetEpicWorkflowRuntimeState).toHaveBeenCalledWith({
          projectId: ProjectId.makeUnsafe("project-1"),
          epicIssueId: "EPIC-1",
        });
        expect(countBdCommandCalls("comments EPIC-1")).toBe(0);
      }),
  );

  it.effect("loads epic issue summaries without reading comments", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "list --all --parent EPIC-1 --limit 0": [
          {
            id: "TASK-1",
            title: "Ready child",
            description: null,
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            parent_id: "EPIC-1",
            parent_title: "Epic coordination",
            dependencies: [],
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const summaries = yield* beads.getEpicIssueSummaries({
        cwd: "/repo",
        epicIssueId: "EPIC-1",
      });

      assert.equal(summaries.epicId, "EPIC-1");
      assert.equal(summaries.progress.readyIssueCount, 1);
      expect(countBdCommandCalls("comments EPIC-1")).toBe(0);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
    }),
  );

  it.effect("starts epic quick refine in a default-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicQuickRefine({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Quick refine)",
        interactionMode: "default",
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "default",
      });
    }),
  );

  it.effect("starts epic planned refine in a plan-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicPlannedRefine({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Planned refine)",
        interactionMode: "plan",
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "plan",
      });
    }),
  );

  it.effect("starts planned implementation in a plan-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startWorkflow({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: "TASK-1",
        workflow: "plan-implementation",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "TASK-1: Implement settings persistence (Planned implementation)",
        interactionMode: "plan",
        issueLink: {
          issueId: "TASK-1",
          title: "Implement settings persistence",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "plan",
        message: {
          text: expect.stringContaining(
            "Produce a concrete implementation plan for issue TASK-1: Implement settings persistence",
          ),
        },
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain("Do NOT implement code yet.");
      expect(messageText).toContain("acceptance criteria");
      expect(messageText).toContain("Update beads with your plan");
    }),
  );

  it.effect("deletes a newly created linked workflow thread when first-turn start fails", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        if ((command as { type?: string }).type === "thread.turn.start") {
          return Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: "thread.turn.start",
              detail: "provider unavailable",
            }),
          );
        }
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const exit = yield* Effect.exit(
        beads.startWorkflow({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
          issueId: "TASK-1",
          workflow: "solve",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) {
        return;
      }

      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(BeadsError);
      if (!Schema.is(BeadsError)(error)) {
        return;
      }

      expect(error.message).toBe("Failed to start issue workflow.");
      expect(error.cause).toBeInstanceOf(OrchestrationCommandInvariantError);
      expect((error.cause as Error).message).toContain("provider unavailable");
      expect(dispatchedCommands).toHaveLength(3);
      expect(dispatchedCommands.map((command) => (command as { type: string }).type)).toEqual([
        "thread.create",
        "thread.turn.start",
        "thread.delete",
      ]);
      expect(dispatchedCommands[2]).toMatchObject({
        type: "thread.delete",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
      });
    }),
  );

  it.effect("starts backlog grooming in a new plan-mode project thread", () =>
    Effect.gen(function* () {
      const dispatchedCommands: unknown[] = [];

      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startBacklogGrooming({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Backlog grooming",
        interactionMode: "plan",
        branch: null,
        worktreePath: null,
        issueLink: null,
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "plan",
        message: {
          text: expect.stringContaining("Review and improve the project backlog"),
        },
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain("bd ready");
      expect(messageText).toContain("Keep this tracker-only");
      expect(messageText).toContain("ask for clarification before making it");
    }),
  );

  it.effect("reuses an existing active solve thread for repeated issue launches", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedGetReadModel.mockImplementation(() =>
        Effect.die("getCommandReadModel should not be used for linked workflow reuse"),
      );
      mockedListProjectLinkedIssueThreads.mockImplementation(() =>
        Effect.succeed([
          toLinkedIssueThreadFixture(
            makeLinkedThreadFixture({
              id: "thread-existing-solve",
              title: "TASK-1: Implement settings persistence",
              issueId: "TASK-1",
              interactionMode: "default",
              now,
            }),
          ),
        ]),
      );

      const beads = yield* BeadsService;
      const result = yield* beads.startWorkflow({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: "TASK-1",
        workflow: "solve",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, false);
      assert.equal(result.threadId, ThreadId.makeUnsafe("thread-existing-solve"));
      expect(mockedListProjectLinkedIssueThreads).toHaveBeenCalledWith(
        ProjectId.makeUnsafe("project-1"),
      );
      expect(mockedDispatch).not.toHaveBeenCalled();
    }),
  );

  it.effect("reuses an existing matching planned implementation thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedListProjectLinkedIssueThreads.mockImplementation(() =>
        Effect.succeed([
          toLinkedIssueThreadFixture(
            makeLinkedThreadFixture({
              id: "thread-existing-plan",
              title: "TASK-1: Implement settings persistence (Planned implementation)",
              issueId: "TASK-1",
              interactionMode: "plan",
              now,
            }),
          ),
        ]),
      );

      const beads = yield* BeadsService;
      const result = yield* beads.startWorkflow({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: "TASK-1",
        workflow: "plan-implementation",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, false);
      assert.equal(result.threadId, ThreadId.makeUnsafe("thread-existing-plan"));
      expect(mockedDispatch).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not reuse a mismatched refine thread for planned implementation", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedListProjectLinkedIssueThreads.mockImplementation(() =>
        Effect.succeed([
          toLinkedIssueThreadFixture(
            makeLinkedThreadFixture({
              id: "thread-existing-refine",
              title: "TASK-1: Implement settings persistence",
              issueId: "TASK-1",
              interactionMode: "plan",
              now,
            }),
          ),
        ]),
      );
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startWorkflow({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: "TASK-1",
        workflow: "plan-implementation",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        title: "TASK-1: Implement settings persistence (Planned implementation)",
      });
    }),
  );

  it.effect("opens coordination prep for tracker-only graph refinement", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
            dependents: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicCoordinationPrep({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Coordination prep)",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "default",
        message: {
          text: expect.stringContaining(
            "Prepare epic EPIC-1: Epic coordination for coordinated execution",
          ),
        },
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain(
        "Fix the epic structure so it is ready for coordinated execution.",
      );
      expect(messageText).toContain("Use `bd` to refine child issues");
      expect(messageText).toContain("Do NOT implement application code. Do NOT create a worktree.");
    }),
  );
});
