import type { BeadsEpicIssueSummaries, BeadsIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveDraftQuickLaunchSections,
  deriveReadyEpicRows,
  deriveReadyStandaloneIssueRows,
} from "./draftQuickLaunch";

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

function makeEpicIssueSummaries(
  input: Partial<BeadsEpicIssueSummaries> & Pick<BeadsEpicIssueSummaries, "epicId">,
): BeadsEpicIssueSummaries {
  const { epicId, ...rest } = input;
  return {
    epicId,
    epicTitle: `Epic ${epicId}`,
    progress: {
      totalIssueCount: 4,
      completedIssueCount: 1,
      readyIssueCount: 2,
      activeIssueCount: 0,
      blockedIssueCount: 1,
      internalBlockedIssueCount: 0,
      externalBlockedIssueCount: 0,
      unknownBlockedIssueCount: 0,
      activeWorkerCount: 0,
      isComplete: false,
    },
    issues: [],
    ...rest,
  };
}

describe("deriveReadyEpicRows", () => {
  it("includes only epics with ready work and never returns child issue rows", () => {
    const rows = deriveReadyEpicRows({
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
      epicIssueSummariesById: new Map([
        ["EPIC-1", makeEpicIssueSummaries({ epicId: "EPIC-1" })],
        [
          "EPIC-2",
          makeEpicIssueSummaries({
            epicId: "EPIC-2",
            progress: {
              totalIssueCount: 3,
              completedIssueCount: 3,
              readyIssueCount: 0,
              activeIssueCount: 0,
              blockedIssueCount: 0,
              internalBlockedIssueCount: 0,
              externalBlockedIssueCount: 0,
              unknownBlockedIssueCount: 0,
              activeWorkerCount: 0,
              isComplete: true,
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
      epicIssueSummariesById: new Map([
        ["EPIC-1", makeEpicIssueSummaries({ epicId: "EPIC-1" })],
        ["EPIC-2", makeEpicIssueSummaries({ epicId: "EPIC-2" })],
        [
          "EPIC-3",
          makeEpicIssueSummaries({
            epicId: "EPIC-3",
            progress: {
              totalIssueCount: 3,
              completedIssueCount: 0,
              readyIssueCount: 1,
              activeIssueCount: 0,
              blockedIssueCount: 2,
              internalBlockedIssueCount: 0,
              externalBlockedIssueCount: 0,
              unknownBlockedIssueCount: 0,
              activeWorkerCount: 0,
              isComplete: false,
            },
          }),
        ],
      ]),
    });

    expect(rows.map((row) => row.id)).toEqual(["EPIC-2", "EPIC-3", "EPIC-1"]);
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
      epicIssueSummariesById: new Map([["EPIC-1", makeEpicIssueSummaries({ epicId: "EPIC-1" })]]),
    });

    expect(result.sections.map((section) => section.kind)).toEqual(["epics", "standalone"]);
    expect(result.sections[0]?.items).toHaveLength(1);
    expect(result.sections[1]?.items).toHaveLength(1);
  });
});
