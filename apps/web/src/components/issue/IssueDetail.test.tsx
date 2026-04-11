import type { BeadsIssueDetail, BeadsIssueRelationSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedSubIssuesSectionProps: Array<Record<string, unknown>> = [];

vi.mock("./SubIssuesSection", () => ({
  SubIssuesSection: (props: Record<string, unknown>) => {
    capturedSubIssuesSectionProps.push(props);
    return <div>Mock SubIssuesSection</div>;
  },
}));

import { IssueDetail } from "./IssueDetail";

function makeRelation(
  input: Partial<BeadsIssueRelationSummary> & Pick<BeadsIssueRelationSummary, "id" | "title">,
): BeadsIssueRelationSummary {
  const { id, title, ...rest } = input;
  return {
    id,
    title,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
    ...rest,
  } satisfies BeadsIssueRelationSummary;
}

function makeDetail(
  input: Partial<BeadsIssueDetail> & Pick<BeadsIssueDetail, "id" | "title">,
): BeadsIssueDetail {
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
    dependencies: [],
    comments: [],
    ...rest,
  } satisfies BeadsIssueDetail;
}

describe("IssueDetail", () => {
  beforeEach(() => {
    capturedSubIssuesSectionProps.length = 0;
  });

  it("passes sub-issue context actions through to SubIssuesSection", () => {
    const onSubIssueContextAction = vi.fn();

    renderToStaticMarkup(
      <IssueDetail
        issue={makeDetail({ id: "EPIC-1", title: "Epic 1", issueType: "epic" })}
        subIssues={[makeRelation({ id: "TASK-1", title: "Task 1" })]}
        onSubIssueContextAction={onSubIssueContextAction}
      />,
    );

    expect(capturedSubIssuesSectionProps).toHaveLength(1);
    expect(capturedSubIssuesSectionProps[0]?.onIssueContextAction).toBe(onSubIssueContextAction);
  });
});
