import type {
  BeadsIssueDependency,
  BeadsIssueDetail,
  BeadsIssueRelationSummary,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IssueDetail } from "./IssueDetail";
import { IssueParentLink, IssueRelationshipsSection } from "./IssueRelationships";
import { SubIssuesSection } from "./SubIssuesSection";

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
    dependencyRefs: [],
    dependencies: [],
    comments: [],
    ...rest,
  } satisfies BeadsIssueDetail;
}

function makeDependency(
  input: Partial<BeadsIssueDependency> &
    Pick<BeadsIssueDependency, "id" | "title" | "dependencyType">,
): BeadsIssueDependency {
  const { id, title, dependencyType, ...rest } = input;
  return {
    id,
    title,
    dependencyType,
    description: null,
    status: "open",
    priority: null,
    issueType: "task",
    owner: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...rest,
  } satisfies BeadsIssueDependency;
}

describe("issue title rendering", () => {
  it("strikes through closed issue detail titles", () => {
    const markup = renderToStaticMarkup(
      <IssueDetail
        issue={makeDetail({ id: "TASK-1", title: "Closed detail", status: "closed" })}
      />,
    );

    expect(markup).toMatch(/<h1 class="[^"]*line-through[^"]*">Closed detail<\/h1>/);
  });

  it("strikes through closed relationship titles without affecting open ones", () => {
    const markup = renderToStaticMarkup(
      <div>
        <IssueParentLink
          parent={makeRelation({ id: "EPIC-1", title: "Closed parent", status: "closed" })}
        />
        <IssueRelationshipsSection
          parent={null}
          subIssues={[]}
          dependencies={[]}
          dependents={[
            makeRelation({ id: "TASK-1", title: "Closed dependent", status: "closed" }),
            makeRelation({ id: "TASK-2", title: "Open dependent", status: "open" }),
          ]}
        />
      </div>,
    );

    expect(markup).toMatch(/<span class="[^"]*line-through[^"]*">Closed parent<\/span>/);
    expect(markup).toMatch(/<span class="[^"]*line-through[^"]*">Closed dependent<\/span>/);
    expect(markup).not.toMatch(/<span class="[^"]*line-through[^"]*">Open dependent<\/span>/);
  });

  it("strikes through closed child issue titles without affecting open ones", () => {
    const markup = renderToStaticMarkup(
      <SubIssuesSection
        subIssues={[
          makeRelation({ id: "TASK-1", title: "Closed child", status: "closed" }),
          makeRelation({ id: "TASK-2", title: "Open child", status: "open" }),
        ]}
      />,
    );

    expect(markup).toMatch(/<span class="[^"]*line-through[^"]*">Closed child<\/span>/);
    expect(markup).not.toMatch(/<span class="[^"]*line-through[^"]*">Open child<\/span>/);
  });

  it("renders a blocked badge for blocked child issues only", () => {
    const markup = renderToStaticMarkup(
      <SubIssuesSection
        subIssues={[
          makeRelation({ id: "TASK-1", title: "Blocked child", status: "blocked" }),
          makeRelation({ id: "TASK-2", title: "Open child", status: "open" }),
        ]}
      />,
    );

    expect(markup.match(/border-destructive\/30[^"]*">Blocked<\/span>/g)).toHaveLength(1);
  });

  it("renders the clearer incoming blocks label in issue detail relationships", () => {
    const markup = renderToStaticMarkup(
      <IssueDetail
        issue={makeDetail({
          id: "TASK-1",
          title: "Needs prerequisites",
          dependencies: [
            makeDependency({ id: "TASK-0", title: "Upstream blocker", dependencyType: "blocks" }),
          ],
        })}
      />,
    );

    expect(markup).toContain("Must resolve first");
    expect(markup).not.toContain("Blocks this issue");
  });
});
