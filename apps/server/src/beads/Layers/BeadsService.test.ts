import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  EpicRunId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { BeadsService } from "../Services/BeadsService.ts";
import { BeadsServiceLive, BeadsTrackerServiceLive } from "./BeadsService.ts";

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
const mockedDispatch = vi.fn<(command: unknown) => Effect.Effect<{ sequence: number }, never>>(
  (_: unknown) => Effect.die("dispatch was not expected in this test"),
);

const orchestrationEngineLayer = Layer.mock(OrchestrationEngineService)({
  getReadModel: () => mockedGetReadModel(),
  readEvents: () => Stream.empty,
  dispatch: (command) => mockedDispatch(command),
  streamDomainEvents: Stream.empty,
});

const layer = it.layer(
  BeadsServiceLive.pipe(
    Layer.provide(BeadsTrackerServiceLive),
    Layer.provide(orchestrationEngineLayer),
  ),
);

afterEach(() => {
  mockedRunProcess.mockReset();
  mockedGetReadModel.mockReset();
  mockedDispatch.mockReset();
  mockedGetReadModel.mockImplementation(() => Effect.succeed(makeEmptyReadModel()));
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
  return args.filter((arg) => arg !== "--json").join(" ");
}

function installBdJsonMock(outputs: Record<string, unknown>) {
  mockedRunProcess.mockImplementation(async (_command, args) => {
    const key = commandKey(args);
    const output =
      outputs[key] ??
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
      expect(mockedRunProcess).toHaveBeenCalledTimes(5);
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

  it.effect("loads beads context and derives embedded swarm support gating", () =>
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

      const beads = yield* BeadsService;
      const context = yield* beads.getContext({ cwd: "/repo" });
      const support = yield* beads.getEpicRunSupport({ cwd: "/repo" });
      const swarms = yield* beads.listEpicTrackerSummaries({ cwd: "/repo" });

      assert.equal(context.backend.kind, "dolt");
      assert.equal(context.backend.doltMode, "embedded");
      assert.equal(support.supported, false);
      expect(support.reason).toContain("embedded Dolt mode");
      assert.deepStrictEqual(swarms.trackerSummaries, []);
      expect(
        mockedRunProcess.mock.calls.some(([, args]) => commandKey(args).startsWith("swarm ")),
      ).toBe(false);
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

  it.effect("maps epic issue graph relations from show/comments/history output", () =>
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
        "comments EPIC-1": [],
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
    }),
  );

  it.effect("maps swarm summary, validation, and status when swarm support is enabled", () =>
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
        "swarm list": {
          swarms: [
            {
              swarm_id: "SWARM-1",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              total_issue_count: 4,
              completed_issue_count: 1,
              active_issue_count: 1,
              ready_issue_count: 1,
              blocked_issue_count: 1,
              active_worker_count: 1,
            },
          ],
        },
        "swarm validate EPIC-1": {
          valid: true,
          errors: [],
          warnings: ["One dependency chain is longer than the others."],
          ready_fronts: [
            [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
              },
            ],
          ],
          estimated_worker_sessions: 2,
          max_parallelism: 3,
        },
        "swarm status EPIC-1": {
          completed: [
            {
              id: "DONE-1",
              title: "Completed child",
              status: "closed",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active: [
            {
              id: "ACTIVE-1",
              title: "Active child",
              status: "in_progress",
              priority: 1,
              issue_type: "task",
              assignee: "bob",
              owner: null,
            },
          ],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
        },
        "show BLOCKED-1 --long": [
          {
            id: "BLOCKED-1",
            title: "Blocked child",
            status: "blocked",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
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
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const swarm = yield* beads.getEpicTrackerSummary({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const validation = yield* beads.validateEpicRun({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(swarm?.trackerId, "SWARM-1");
      assert.equal(validation.valid, true);
      assert.equal(validation.trackerSummary?.epicId, "EPIC-1");
      assert.equal(validation.maxParallelism, 3);
      assert.deepStrictEqual(
        validation.readyFronts.map((front) => front.map((issue) => issue.id)),
        [["READY-1"]],
      );
      assert.deepStrictEqual(
        status.completed.map((issue) => issue.id),
        ["DONE-1"],
      );
      assert.deepStrictEqual(
        status.active.map((issue) => issue.id),
        ["ACTIVE-1"],
      );
      assert.deepStrictEqual(
        status.ready.map((issue) => issue.id),
        ["READY-1"],
      );
      assert.deepStrictEqual(
        status.blocked.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
      assert.deepStrictEqual(
        status.blockedBreakdown.external.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
    }),
  );

  it.effect("maps current bd swarm JSON field names without zeroing summary counts", () =>
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
        "swarm list": {
          swarms: [
            {
              id: "SWARM-1",
              title: "Swarm: Epic coordination",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              status: "open",
              coordinator: "",
              total_issues: 13,
              completed_issues: 5,
              active_issues: 0,
              progress_percent: 38.46153846153847,
            },
          ],
        },
        "swarm validate EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          total_issues: 13,
          closed_issues: 5,
          ready_fronts: [
            {
              wave: 0,
              issues: ["READY-1", "READY-2"],
              titles: ["Ready child 1", "Ready child 2"],
            },
          ],
          max_parallelism: 6,
          estimated_sessions: 13,
          warnings: null,
          errors: null,
          swarmable: true,
        },
        "swarm status EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          total_issues: 13,
          completed: [
            {
              id: "DONE-1",
              title: "Completed child",
              status: "closed",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child 1",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active_count: 0,
          ready_count: 1,
          blocked_count: 1,
        },
        "show BLOCKED-1 --long": [
          {
            id: "BLOCKED-1",
            title: "Blocked child",
            status: "blocked",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
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
            dependents: [],
          },
        ],
      });

      const beads = yield* BeadsService;
      const swarms = yield* beads.listEpicTrackerSummaries({ cwd: "/repo" });
      const validation = yield* beads.validateEpicRun({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.deepStrictEqual(swarms.trackerSummaries, [
        {
          trackerId: "SWARM-1",
          epicId: "EPIC-1",
          epicTitle: "Epic coordination",
          totalIssueCount: 13,
          completedIssueCount: 5,
          activeIssueCount: 0,
          readyIssueCount: 0,
          blockedIssueCount: 0,
          activeWorkerCount: 0,
        },
      ]);
      assert.equal(validation.trackerSummary?.totalIssueCount, 13);
      assert.equal(validation.trackerSummary?.completedIssueCount, 5);
      assert.equal(validation.maxParallelism, 6);
      assert.equal(validation.estimatedWorkerSessions, 13);
      assert.deepStrictEqual(
        validation.readyFronts.map((front) => front.map((issue) => issue.id)),
        [["READY-1", "READY-2"]],
      );
      assert.equal(status.trackerSummary?.totalIssueCount, 13);
      assert.equal(status.trackerSummary?.completedIssueCount, 1);
      assert.equal(status.trackerSummary?.readyIssueCount, 1);
      assert.equal(status.trackerSummary?.blockedIssueCount, 1);
      assert.deepStrictEqual(
        status.blockedBreakdown.external.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
    }),
  );

  it.effect(
    "returns null swarm summaries when beads reports epic metadata without a swarm id",
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
          "swarm list": {
            swarms: [],
          },
          "swarm validate EPIC-1": {
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issues: 3,
            closed_issues: 1,
            ready_fronts: [],
            max_parallelism: 1,
            estimated_sessions: 3,
            warnings: null,
            errors: null,
            swarmable: true,
          },
          "swarm status EPIC-1": {
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issues: 3,
            completed: [],
            active: [],
            ready: [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
              },
            ],
            blocked: [],
            active_count: 0,
            ready_count: 1,
            blocked_count: 0,
          },
        });

        const beads = yield* BeadsService;
        const validation = yield* beads.validateEpicRun({ cwd: "/repo", epicIssueId: "EPIC-1" });
        const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

        assert.equal(validation.trackerSummary, null);
        assert.equal(status.trackerSummary, null);
        assert.equal(validation.estimatedWorkerSessions, 3);
        assert.deepStrictEqual(
          status.ready.map((issue) => issue.id),
          ["READY-1"],
        );
      }),
  );

  it.effect("hydrates sparse swarm status entries from epic child records", () =>
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
        "swarm list": {
          swarms: [],
        },
        "swarm status EPIC-1": {
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
            },
          ],
        },
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
      const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

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
            dependents: [],
          },
        ],
        "swarm list": {
          swarms: [],
        },
        "swarm status EPIC-1": {
          completed: [],
          active: [],
          ready: [],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
            },
          ],
        },
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.deepStrictEqual(
        status.blockedBreakdown.unknown.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
    }),
  );

  it.effect("reuses shared tracker reads within a project coordinator snapshot request", () =>
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
        "list --all --type epic --limit 0": [
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
          {
            id: "EPIC-2",
            title: "Second epic",
            description: null,
            notes: null,
            status: "open",
            priority: 3,
            issue_type: "epic",
            assignee: null,
            owner: "bob",
            created_at: now,
            created_by: "bob",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "swarm list": {
          swarms: [
            {
              swarm_id: "SWARM-1",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              total_issue_count: 3,
              completed_issue_count: 1,
              active_issue_count: 0,
              ready_issue_count: 1,
              blocked_issue_count: 1,
              active_worker_count: 0,
            },
          ],
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
        "show EPIC-2 --long": [
          {
            id: "EPIC-2",
            title: "Second epic",
            description: null,
            notes: null,
            status: "open",
            priority: 3,
            issue_type: "epic",
            assignee: null,
            owner: "bob",
            created_at: now,
            created_by: "bob",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "swarm validate EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          valid: true,
          errors: [],
          warnings: [],
          ready_fronts: [],
          estimated_sessions: 2,
          max_parallelism: 1,
        },
        "swarm validate EPIC-2": {
          epic_id: "EPIC-2",
          epic_title: "Second epic",
          valid: false,
          errors: ["Blocked dependency remains."],
          warnings: [],
          ready_fronts: [],
          estimated_sessions: 1,
          max_parallelism: 1,
        },
        "swarm status EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          completed: [],
          active: [],
          ready: [],
          blocked: [],
        },
        "swarm status EPIC-2": {
          epic_id: "EPIC-2",
          epic_title: "Second epic",
          completed: [],
          active: [],
          ready: [],
          blocked: [],
        },
      });

      const beads = yield* BeadsService;
      const snapshot = yield* beads.getProjectCoordinatorSnapshot({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
      });

      assert.deepStrictEqual(
        snapshot.epics.map((epic) => epic.epicId),
        ["EPIC-1", "EPIC-2"],
      );
      expect(countBdCommandCalls("context")).toBe(1);
      expect(countBdCommandCalls("list --all --type epic --limit 0")).toBe(1);
      expect(countBdCommandCalls("swarm list")).toBe(1);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
      expect(countBdCommandCalls("show EPIC-2 --long")).toBe(1);
      expect(countBdCommandCalls("swarm validate EPIC-1")).toBe(1);
      expect(countBdCommandCalls("swarm validate EPIC-2")).toBe(1);
      expect(countBdCommandCalls("swarm status EPIC-1")).toBe(1);
      expect(countBdCommandCalls("swarm status EPIC-2")).toBe(1);
    }),
  );

  it.effect(
    "short-circuits unsupported project coordinator snapshots before per-epic swarm work",
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
            dolt_mode: "embedded",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          },
          "list --all --type epic --limit 0": [
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
        const snapshot = yield* beads.getProjectCoordinatorSnapshot({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
        });

        assert.equal(snapshot.epics.length, 1);
        assert.equal(snapshot.epics[0]?.epicId, "EPIC-1");
        assert.equal(snapshot.epics[0]?.validation, null);
        assert.equal(snapshot.epics[0]?.status, null);
        expect(countBdCommandCalls("context")).toBe(1);
        expect(countBdCommandCalls("swarm ")).toBe(0);
        expect(countBdCommandCalls("show ")).toBe(0);
      }),
  );

  it.effect(
    "keeps run-only epics in project coordinator snapshots and preserves missing-issue detail",
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
          "list --all --type epic --limit 0": [],
          "swarm list": {
            swarms: [],
          },
        });
        mockedRunProcess.mockImplementation(async (_command, args) => {
          const key = commandKey(args);
          if (key === "show EPIC-MISSING --long") {
            return {
              stdout: 'Error fetching EPIC-MISSING: no issue found matching "EPIC-MISSING"',
              stderr: "",
              code: 1,
              signal: null,
              timedOut: false,
            } as const;
          }

          const outputs: Record<string, unknown> = {
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
            "list --all --type epic --limit 0": [],
            "swarm list": {
              swarms: [],
            },
          };
          const output = outputs[key];
          if (output === undefined) {
            throw new Error(`Unexpected bd args: ${args.join(" ")}`);
          }
          return successJson(output);
        });
        mockedGetReadModel.mockImplementation(() =>
          Effect.succeed({
            snapshotSequence: 0,
            updatedAt: now,
            planImplementationLaunches: [],
            epicRuns: [
              {
                runId: EpicRunId.makeUnsafe("run-1"),
                projectId: ProjectId.makeUnsafe("project-1"),
                epicIssueId: "EPIC-MISSING",
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
            epicIssueExecutions: [],
            projects: [],
            threads: [],
          }),
        );

        const beads = yield* BeadsService;
        const snapshot = yield* beads.getProjectCoordinatorSnapshot({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
        });

        assert.equal(snapshot.epics[0]?.epicId, "EPIC-MISSING");
        assert.equal(snapshot.epics[0]?.trackerLoadState, "error");
        expect(snapshot.epics[0]?.trackerLoadDetail).toContain("no issue found matching");
        expect(countBdCommandCalls("show EPIC-MISSING --long")).toBe(1);
        expect(countBdCommandCalls("swarm validate EPIC-MISSING")).toBe(0);
        expect(countBdCommandCalls("swarm status EPIC-MISSING")).toBe(0);
      }),
  );

  it.effect("runs validateEpicRun without nested extra context or swarm-list reads", () =>
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
        "swarm list": {
          swarms: [],
        },
        "swarm validate EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          valid: true,
          errors: [],
          warnings: [],
          ready_fronts: [],
          estimated_sessions: 1,
          max_parallelism: 1,
        },
      });

      const beads = yield* BeadsService;
      const validation = yield* beads.validateEpicRun({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(validation.epicId, "EPIC-1");
      expect(countBdCommandCalls("context")).toBe(1);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
      expect(countBdCommandCalls("swarm list")).toBe(1);
      expect(countBdCommandCalls("swarm validate EPIC-1")).toBe(1);
    }),
  );

  it.effect("runs getEpicTrackerStatus without nested extra context or swarm-list reads", () =>
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
        "swarm list": {
          swarms: [],
        },
        "swarm status EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          completed: [],
          active: [],
          ready: [],
          blocked: [],
        },
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicTrackerStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(status.epicId, "EPIC-1");
      expect(countBdCommandCalls("context")).toBe(1);
      expect(countBdCommandCalls("show EPIC-1 --long")).toBe(1);
      expect(countBdCommandCalls("swarm list")).toBe(1);
      expect(countBdCommandCalls("swarm status EPIC-1")).toBe(1);
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
        Effect.succeed({
          snapshotSequence: 0,
          updatedAt: now,
          planImplementationLaunches: [],
          epicRuns: [],
          epicIssueExecutions: [],
          projects: [],
          threads: [
            makeLinkedThreadFixture({
              id: "thread-existing-solve",
              title: "TASK-1: Implement settings persistence",
              issueId: "TASK-1",
              interactionMode: "default",
              now,
            }),
          ],
        }),
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
      mockedGetReadModel.mockImplementation(() =>
        Effect.succeed({
          snapshotSequence: 0,
          updatedAt: now,
          planImplementationLaunches: [],
          epicRuns: [],
          epicIssueExecutions: [],
          projects: [],
          threads: [
            makeLinkedThreadFixture({
              id: "thread-existing-plan",
              title: "TASK-1: Implement settings persistence (Planned implementation)",
              issueId: "TASK-1",
              interactionMode: "plan",
              now,
            }),
          ],
        }),
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
      mockedGetReadModel.mockImplementation(() =>
        Effect.succeed({
          snapshotSequence: 0,
          updatedAt: now,
          planImplementationLaunches: [],
          epicRuns: [],
          epicIssueExecutions: [],
          projects: [],
          threads: [
            makeLinkedThreadFixture({
              id: "thread-existing-refine",
              title: "TASK-1: Implement settings persistence",
              issueId: "TASK-1",
              interactionMode: "plan",
              now,
            }),
          ],
        }),
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

  it.effect("opens coordination prep when no swarm exists yet and epic structure is invalid", () =>
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
        "swarm list": {
          swarms: [],
        },
        "swarm validate EPIC-1": {
          valid: false,
          errors: ["Epic is missing a swarm."],
          warnings: [],
          ready_fronts: [],
          estimated_worker_sessions: 0,
          max_parallelism: 0,
        },
        "swarm status EPIC-1": {
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [],
        },
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
      expect(messageText).toContain(
        "Do NOT describe this as repairing an existing swarm -- the epic is not ready yet.",
      );
      expect(messageText).toContain("Do NOT implement application code. Do NOT create a worktree.");
    }),
  );

  it.effect("opens coordination prep when an invalid swarm already exists", () =>
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
        "swarm list": {
          swarms: [
            {
              swarm_id: "swarm-1",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              total_issue_count: 3,
              completed_issue_count: 0,
              active_issue_count: 0,
              ready_issue_count: 1,
              blocked_issue_count: 2,
              active_worker_count: 0,
            },
          ],
        },
        "swarm validate EPIC-1": {
          valid: false,
          swarm: {
            swarm_id: "swarm-1",
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issue_count: 3,
            completed_issue_count: 0,
            active_issue_count: 0,
            ready_issue_count: 1,
            blocked_issue_count: 2,
            active_worker_count: 0,
          },
          errors: ["Blocked issue graph is inconsistent."],
          warnings: [],
          ready_fronts: [],
          estimated_worker_sessions: 0,
          max_parallelism: 0,
        },
        "swarm status EPIC-1": {
          swarm: {
            swarm_id: "swarm-1",
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issue_count: 3,
            completed_issue_count: 0,
            active_issue_count: 0,
            ready_issue_count: 1,
            blocked_issue_count: 2,
            active_worker_count: 0,
          },
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
        },
        "show BLOCKED-1 --long": [
          {
            id: "BLOCKED-1",
            title: "Blocked child",
            status: "blocked",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
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
            dependents: [],
          },
        ],
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
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        title: "EPIC-1: Epic coordination (Coordination prep)",
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain(
        "Use `bd` to repair the existing coordination setup and correct tracker metadata drift.",
      );
      expect(messageText).toContain(
        "Repair the current coordination setup instead of replacing it unless recovery is impossible.",
      );
      expect(messageText).toContain(
        "Do NOT implement application code. Do NOT create a worktree unless tracker-only recovery is impossible.",
      );
    }),
  );

  it.effect("rejects epic coordination prep when swarm support is unavailable", () =>
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
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "alice",
            updated_at: "2026-01-01T00:00:00.000Z",
            labels: [],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });

      const beads = yield* BeadsService;
      const exit = yield* beads
        .startEpicCoordinationPrep({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
          epicIssueId: "EPIC-1",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
        })
        .pipe(Effect.exit);

      assert.strictEqual(exit._tag, "Failure");
      expect(mockedDispatch).not.toHaveBeenCalled();
    }),
  );
});
