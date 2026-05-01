import type {
  BeadsEpicCoordinationDetail,
  BeadsIssueSummary,
  BeadsProjectRunSummary,
  ProjectId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveDraftQuickLaunchSections,
  deriveReadyEpicRows,
  deriveReadyStandaloneIssueRows,
} from "./draftQuickLaunch";

const PROJECT_ID = "project-1" as ProjectId;

function makeIssue(
  input: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">,
): BeadsIssueSummary {
  const { id, title, ...rest } = input;
  return {
    id,
    title,
    description: null,
    notes: null,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    labels: [],
    parent: null,
    dependencyRefs: [],
    ...rest,
  };
}

function makeProjectRunSummary(epicIds: string[]): BeadsProjectRunSummary {
  return {
    projectId: PROJECT_ID,
    epics: epicIds.map((epicIssueId) => ({
      epicIssueId,
      epicTitle: `Epic ${epicIssueId}`,
      runs: [],
      executions: [],
    })),
  };
}

function makeEpicCoordinationDetail(
  input: Partial<BeadsEpicCoordinationDetail> & Pick<BeadsEpicCoordinationDetail, "epicId">,
): BeadsEpicCoordinationDetail {
  const { epicId, ...rest } = input;
  return {
    epicId,
    coordinationLoadState: "ready",
    coordinationLoadDetail: null,
    validationState: "valid",
    validationErrors: [],
    coordinationState: "not_started",
    summary: {
      epicId,
      epicTitle: `Epic ${epicId}`,
      totalIssueCount: 4,
      completedIssueCount: 1,
      activeIssueCount: 0,
      readyIssueCount: 2,
      blockedIssueCount: 1,
      activeWorkerCount: 0,
    },
    validation: {
      epicId,
      epicTitle: `Epic ${epicId}`,
      summary: {
        epicId,
        epicTitle: `Epic ${epicId}`,
        totalIssueCount: 4,
        completedIssueCount: 1,
        activeIssueCount: 0,
        readyIssueCount: 2,
        blockedIssueCount: 1,
        activeWorkerCount: 0,
      },
      valid: true,
      errors: [],
      warnings: [],
      readyFronts: [
        [
          {
            id: `TASK-${epicId}-1`,
            title: "Ready child",
            status: "open",
            priority: null,
            issueType: "task",
            assignee: null,
            owner: null,
            parent: { id: epicId, title: `Epic ${epicId}` },
          },
        ],
        [
          {
            id: `TASK-${epicId}-2`,
            title: "Later wave child",
            status: "open",
            priority: null,
            issueType: "task",
            assignee: null,
            owner: null,
            parent: { id: epicId, title: `Epic ${epicId}` },
          },
        ],
      ],
      maxParallelism: null,
      estimatedWorkerSessions: null,
    },
    status: {
      epicId,
      epicTitle: `Epic ${epicId}`,
      summary: {
        epicId,
        epicTitle: `Epic ${epicId}`,
        totalIssueCount: 4,
        completedIssueCount: 1,
        activeIssueCount: 0,
        readyIssueCount: 2,
        blockedIssueCount: 1,
        activeWorkerCount: 0,
      },
      completed: [],
      ready: [],
      active: [],
      blocked: [],
      blockedBreakdown: {
        internal: [],
        external: [],
        unknown: [],
      },
    },
    execution: {
      state: "ready",
      summary: "Epic is ready to launch.",
      blockingReason: null,
      nextIssue: null,
    },
    commands: [
      {
        kind: "start_epic_run",
        label: "Start epic",
        busyLabel: "Starting...",
        disabled: false,
        disabledReason: null,
      },
    ],
    ...rest,
  };
}

describe("deriveReadyEpicRows", () => {
  it("includes only epics with ready work and never returns child issue rows", () => {
    const rows = deriveReadyEpicRows({
      projectRunSummary: makeProjectRunSummary(["EPIC-1", "EPIC-2"]),
      issuesById: new Map(
        [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
          }),
          makeIssue({
            id: "EPIC-2",
            title: "Epic 2",
            issueType: "epic",
          }),
        ].map((issue) => [issue.id, issue] as const),
      ),
      epicCoordinationDetailById: new Map([
        ["EPIC-1", makeEpicCoordinationDetail({ epicId: "EPIC-1" })],
        [
          "EPIC-2",
          makeEpicCoordinationDetail({
            epicId: "EPIC-2",
            summary: {
              epicId: "EPIC-2",
              epicTitle: "Epic EPIC-2",
              totalIssueCount: 3,
              completedIssueCount: 3,
              activeIssueCount: 0,
              readyIssueCount: 0,
              blockedIssueCount: 0,
              activeWorkerCount: 0,
            },
            validation: {
              epicId: "EPIC-2",
              epicTitle: "Epic EPIC-2",
              summary: {
                epicId: "EPIC-2",
                epicTitle: "Epic EPIC-2",
                totalIssueCount: 3,
                completedIssueCount: 3,
                activeIssueCount: 0,
                readyIssueCount: 0,
                blockedIssueCount: 0,
                activeWorkerCount: 0,
              },
              valid: true,
              errors: [],
              warnings: [],
              readyFronts: [],
              maxParallelism: null,
              estimatedWorkerSessions: null,
            },
            status: {
              epicId: "EPIC-2",
              epicTitle: "Epic EPIC-2",
              summary: {
                epicId: "EPIC-2",
                epicTitle: "Epic EPIC-2",
                totalIssueCount: 3,
                completedIssueCount: 3,
                activeIssueCount: 0,
                readyIssueCount: 0,
                blockedIssueCount: 0,
                activeWorkerCount: 0,
              },
              completed: [],
              ready: [],
              active: [],
              blocked: [],
              blockedBreakdown: {
                internal: [],
                external: [],
                unknown: [],
              },
            },
          }),
        ],
      ]),
    });

    expect(rows.map((row) => row.id)).toEqual(["EPIC-1"]);
    expect(rows[0]).toMatchObject({
      kind: "epic",
      id: "EPIC-1",
      readyIssueCount: 2,
      totalIssueCount: 4,
    });
  });

  it("orders epics by priority, then ready count, then updatedAt", () => {
    const rows = deriveReadyEpicRows({
      projectRunSummary: makeProjectRunSummary(["EPIC-1", "EPIC-2", "EPIC-3"]),
      issuesById: new Map(
        [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
            priority: 2,
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
          makeIssue({
            id: "EPIC-2",
            title: "Epic 2",
            issueType: "epic",
            priority: 1,
            updatedAt: "2026-01-03T00:00:00.000Z",
          }),
          makeIssue({
            id: "EPIC-3",
            title: "Epic 3",
            issueType: "epic",
            priority: 1,
            updatedAt: "2026-01-04T00:00:00.000Z",
          }),
        ].map((issue) => [issue.id, issue] as const),
      ),
      epicCoordinationDetailById: new Map([
        ["EPIC-1", makeEpicCoordinationDetail({ epicId: "EPIC-1" })],
        ["EPIC-2", makeEpicCoordinationDetail({ epicId: "EPIC-2" })],
        [
          "EPIC-3",
          makeEpicCoordinationDetail({
            epicId: "EPIC-3",
            summary: {
              epicId: "EPIC-3",
              epicTitle: "Epic EPIC-3",
              totalIssueCount: 3,
              completedIssueCount: 0,
              activeIssueCount: 0,
              readyIssueCount: 1,
              blockedIssueCount: 2,
              activeWorkerCount: 0,
            },
          }),
        ],
      ]),
    });

    expect(rows.map((row) => row.id)).toEqual(["EPIC-3", "EPIC-2", "EPIC-1"]);
  });
});

describe("deriveReadyStandaloneIssueRows", () => {
  it("includes only standalone issues without unresolved blockers", () => {
    const doneDependency = makeIssue({
      id: "TASK-DONE",
      title: "Done blocker",
      status: "closed",
    });
    const readyIssue = makeIssue({
      id: "TASK-READY",
      title: "Ready issue",
      dependencyRefs: [
        {
          issueId: "TASK-READY",
          dependsOnId: "TASK-DONE",
          dependencyType: "blocked_by",
        },
      ],
    });
    const blockedIssue = makeIssue({
      id: "TASK-BLOCKED",
      title: "Blocked issue",
      dependencyRefs: [
        {
          issueId: "TASK-BLOCKED",
          dependsOnId: "TASK-OPEN",
          dependencyType: "depends_on",
        },
      ],
    });
    const openDependency = makeIssue({
      id: "TASK-OPEN",
      title: "Open blocker",
    });
    const childIssue = makeIssue({
      id: "TASK-CHILD",
      title: "Child issue",
      parent: { id: "EPIC-1", title: "Epic 1" },
    });
    const inProgressIssue = makeIssue({
      id: "TASK-IN-PROGRESS",
      title: "In progress issue",
      status: "in_progress",
    });

    const rows = deriveReadyStandaloneIssueRows({
      issuesById: new Map(
        [doneDependency, readyIssue, blockedIssue, openDependency, childIssue, inProgressIssue].map(
          (issue) => [issue.id, issue] as const,
        ),
      ),
    });

    expect(rows.map((row) => row.id)).toEqual(["TASK-OPEN", "TASK-READY"]);
  });

  it("treats missing blockers as unresolved and ignores blocks edges", () => {
    const missingDependencyIssue = makeIssue({
      id: "TASK-MISSING",
      title: "Missing blocker issue",
      dependencyRefs: [
        {
          issueId: "TASK-MISSING",
          dependsOnId: "TASK-NOT-LOADED",
          dependencyType: "blocked_by",
        },
      ],
    });
    const blockingIssue = makeIssue({
      id: "TASK-BLOCKS",
      title: "Issue that blocks another",
      dependencyRefs: [
        {
          issueId: "TASK-BLOCKS",
          dependsOnId: "TASK-OTHER",
          dependencyType: "blocks",
        },
      ],
    });

    const rows = deriveReadyStandaloneIssueRows({
      issuesById: new Map(
        [missingDependencyIssue, blockingIssue].map((issue) => [issue.id, issue] as const),
      ),
    });

    expect(rows.map((row) => row.id)).toEqual(["TASK-BLOCKS"]);
  });

  it("orders standalone issues by priority then updatedAt", () => {
    const rows = deriveReadyStandaloneIssueRows({
      issuesById: new Map(
        [
          makeIssue({
            id: "TASK-2",
            title: "Later issue",
            priority: 2,
            updatedAt: "2026-01-04T00:00:00.000Z",
          }),
          makeIssue({
            id: "TASK-1",
            title: "Higher priority",
            priority: 1,
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
          makeIssue({
            id: "TASK-3",
            title: "Newest high priority",
            priority: 1,
            updatedAt: "2026-01-05T00:00:00.000Z",
          }),
        ].map((issue) => [issue.id, issue] as const),
      ),
    });

    expect(rows.map((row) => row.id)).toEqual(["TASK-3", "TASK-1", "TASK-2"]);
  });
});

describe("deriveDraftQuickLaunchSections", () => {
  it("returns sections in epic-first order and omits empty sections", () => {
    const result = deriveDraftQuickLaunchSections({
      projectRunSummary: makeProjectRunSummary(["EPIC-1"]),
      issuesById: new Map(
        [
          makeIssue({
            id: "EPIC-1",
            title: "Epic 1",
            issueType: "epic",
          }),
          makeIssue({
            id: "TASK-1",
            title: "Standalone",
          }),
        ].map((issue) => [issue.id, issue] as const),
      ),
      epicCoordinationDetailById: new Map([
        ["EPIC-1", makeEpicCoordinationDetail({ epicId: "EPIC-1" })],
      ]),
    });

    expect(result.sections.map((section) => section.kind)).toEqual(["epics", "standalone"]);
    expect(result.sections[0]?.items).toHaveLength(1);
    expect(result.sections[1]?.items).toHaveLength(1);
  });
});
