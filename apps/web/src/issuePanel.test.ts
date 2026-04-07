import { ProjectId, ThreadId, type BeadsIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  findLatestTrackerRefinementPlan,
  getEpicCoordinatorImplementAction,
  groupIssuesByEpic,
  isEpicIssueType,
  listEpicChildIssues,
  partitionCoordinatorSwarms,
  type TrackerRefinementPlanCandidate,
} from "./issuePanel";

function makeIssue(
  overrides: Partial<BeadsIssueSummary> & Pick<BeadsIssueSummary, "id" | "title">,
) {
  const { id, title, ...rest } = overrides;

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
    ...rest,
  } satisfies BeadsIssueSummary;
}

describe("groupIssuesByEpic", () => {
  it("renders epic sections with the epic issue and keeps ungrouped issues flat", () => {
    const issues = [
      makeIssue({
        id: "epic-b",
        title: "Beta epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-b", title: "Beta epic" },
      }),
      makeIssue({
        id: "task-ungrouped",
        title: "Ungrouped task",
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
    ];

    expect(groupIssuesByEpic(issues)).toEqual([
      {
        key: "epic:epic-b",
        epicId: "epic-b",
        epicTitle: "Beta epic",
        issues: [issues[1]],
        epicIssue: issues[0],
      },
      {
        key: "issue:task-ungrouped",
        epicId: null,
        epicTitle: null,
        issues: [issues[2]],
        epicIssue: null,
      },
      {
        key: "epic:epic-a",
        epicId: "epic-a",
        epicTitle: "Alpha epic",
        issues: [issues[3]],
        epicIssue: null,
      },
    ]);
  });

  it("anchors a group at the first child when the epic row appears later", () => {
    const issues = [
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
      makeIssue({
        id: "epic-a",
        title: "Alpha epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-a", title: "Alpha epic" },
      }),
    ];

    expect(groupIssuesByEpic(issues)).toEqual([
      {
        key: "epic:epic-a",
        epicId: "epic-a",
        epicTitle: "Alpha epic",
        issues: [issues[0], issues[2]],
        epicIssue: issues[1],
      },
    ]);
  });
});

describe("listEpicChildIssues", () => {
  it("returns only children of the selected epic", () => {
    const issues = [
      makeIssue({
        id: "epic-1",
        title: "Epic",
        issueType: "epic",
      }),
      makeIssue({
        id: "task-1",
        title: "Task 1",
        parent: { id: "epic-1", title: "Epic" },
      }),
      makeIssue({
        id: "task-2",
        title: "Task 2",
        parent: { id: "epic-2", title: "Other epic" },
      }),
    ];

    expect(listEpicChildIssues({ issues, epicId: "epic-1" })).toEqual([issues[1]]);
    expect(listEpicChildIssues({ issues, epicId: null })).toEqual([]);
  });
});

describe("isEpicIssueType", () => {
  it("treats epic issue types case-insensitively", () => {
    expect(isEpicIssueType("epic")).toBe(true);
    expect(isEpicIssueType("Epic")).toBe(true);
    expect(isEpicIssueType("task")).toBe(false);
  });
});

describe("getEpicCoordinatorImplementAction", () => {
  it("disables implement while support or validation is loading", () => {
    expect(
      getEpicCoordinatorImplementAction({
        swarmSupport: null,
        validation: null,
        isSupportPending: true,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "implement",
      label: "Checking swarm...",
      disabled: true,
    });
  });

  it("disables implement when swarm support is unavailable", () => {
    expect(
      getEpicCoordinatorImplementAction({
        swarmSupport: { supported: false },
        validation: null,
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "implement",
      label: "Implement",
      disabled: true,
    });
  });

  it("enables implement only for valid existing swarms", () => {
    expect(
      getEpicCoordinatorImplementAction({
        swarmSupport: { supported: true },
        validation: {
          valid: true,
          swarm: {
            swarmId: "swarm-1",
            epicId: "epic-1",
            epicTitle: "Epic",
            totalIssueCount: 3,
            completedIssueCount: 1,
            activeIssueCount: 1,
            readyIssueCount: 1,
            blockedIssueCount: 0,
            activeWorkerCount: 1,
          },
        },
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "implement",
      label: "Implement",
      disabled: false,
    });
  });

  it("shows plan implementation when the swarm is missing or invalid", () => {
    expect(
      getEpicCoordinatorImplementAction({
        swarmSupport: { supported: true },
        validation: { valid: false, swarm: null },
        isSupportPending: false,
        isValidationPending: false,
      }),
    ).toEqual({
      kind: "plan_implementation",
      label: "Plan implementation",
      disabled: false,
    });
  });
});

describe("partitionCoordinatorSwarms", () => {
  it("partitions and sorts running and ready swarms", () => {
    const swarms = [
      {
        swarmId: "swarm-ready-a",
        epicId: "EPIC-3",
        epicTitle: "Alpha ready",
        totalIssueCount: 5,
        completedIssueCount: 1,
        activeIssueCount: 0,
        readyIssueCount: 3,
        blockedIssueCount: 1,
        activeWorkerCount: 0,
      },
      {
        swarmId: "swarm-running-b",
        epicId: "EPIC-2",
        epicTitle: "Bravo running",
        totalIssueCount: 7,
        completedIssueCount: 2,
        activeIssueCount: 2,
        readyIssueCount: 2,
        blockedIssueCount: 1,
        activeWorkerCount: 1,
      },
      {
        swarmId: "swarm-running-a",
        epicId: "EPIC-1",
        epicTitle: "Alpha running",
        totalIssueCount: 9,
        completedIssueCount: 4,
        activeIssueCount: 3,
        readyIssueCount: 1,
        blockedIssueCount: 1,
        activeWorkerCount: 2,
      },
      {
        swarmId: "swarm-ready-b",
        epicId: "EPIC-4",
        epicTitle: "Zulu ready",
        totalIssueCount: 4,
        completedIssueCount: 0,
        activeIssueCount: 0,
        readyIssueCount: 1,
        blockedIssueCount: 0,
        activeWorkerCount: 0,
      },
      {
        swarmId: "swarm-idle",
        epicId: "EPIC-5",
        epicTitle: "Idle",
        totalIssueCount: 4,
        completedIssueCount: 4,
        activeIssueCount: 0,
        readyIssueCount: 0,
        blockedIssueCount: 0,
        activeWorkerCount: 0,
      },
    ];

    expect(partitionCoordinatorSwarms(swarms)).toEqual({
      runningSwarms: [swarms[2], swarms[1]],
      readyToRunSwarms: [swarms[0], swarms[3]],
    });
  });
});

function makeTrackerThread(
  overrides: Partial<TrackerRefinementPlanCandidate>,
): TrackerRefinementPlanCandidate {
  return {
    id: ThreadId.makeUnsafe("thread-default"),
    projectId: ProjectId.makeUnsafe("project-default"),
    title: "Thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    issueLink: null,
    proposedPlans: [],
    ...overrides,
  };
}

describe("findLatestTrackerRefinementPlan", () => {
  it("returns the latest tracker refinement plan for the selected epic", () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const olderThread = makeTrackerThread({
      id: ThreadId.makeUnsafe("thread-1"),
      projectId,
      title: "Older planned refine",
      issueLink: { issueId: "EPIC-1" },
      proposedPlans: [
        {
          id: "plan-1",
          planMarkdown: "Older plan",
          planIntent: "tracker-refinement",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    const newerThread = makeTrackerThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId,
      title: "Newer planned refine",
      issueLink: { issueId: "EPIC-1" },
      proposedPlans: [
        {
          id: "plan-2",
          planMarkdown: "Newer plan",
          planIntent: "tracker-refinement",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });

    expect(
      findLatestTrackerRefinementPlan({
        threads: [olderThread, newerThread],
        projectId,
        issueId: "EPIC-1",
      }),
    ).toEqual({
      threadId: ThreadId.makeUnsafe("thread-2"),
      threadTitle: "Newer planned refine",
      planId: "plan-2",
      planMarkdown: "Newer plan",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
  });

  it("ignores non-matching issues and non-tracker plans", () => {
    const projectId = ProjectId.makeUnsafe("project-1");

    expect(
      findLatestTrackerRefinementPlan({
        threads: [
          makeTrackerThread({
            projectId,
            issueLink: { issueId: "EPIC-1" },
            proposedPlans: [
              {
                id: "plan-code",
                planMarkdown: "Implementation plan",
                planIntent: "code-implementation",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          makeTrackerThread({
            projectId,
            issueLink: { issueId: "EPIC-2" },
            proposedPlans: [
              {
                id: "plan-other-epic",
                planMarkdown: "Other epic",
                planIntent: "tracker-refinement",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          }),
        ],
        projectId,
        issueId: "EPIC-1",
      }),
    ).toBeNull();
  });
});
