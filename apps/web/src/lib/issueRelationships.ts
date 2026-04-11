import type { BeadsIssueDependency, BeadsIssueRelationSummary } from "@t3tools/contracts";

import { groupDependenciesByType } from "./issueConstants";

export type IssueRelationshipTone =
  | "structure"
  | "blocked"
  | "prerequisite"
  | "downstream"
  | "neutral";

export interface IssueRelationshipItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: number | null;
  readonly issueType: string;
  readonly description: string | null;
}

export interface IssueRelationshipSection {
  readonly key: "blocked_by" | "depends_on" | "blocks" | "related";
  readonly label: string;
  readonly emptyLabel: string;
  readonly tone: IssueRelationshipTone;
  readonly items: readonly IssueRelationshipItem[];
}

export interface IssueRelationshipSummaryItem {
  readonly key: "parent" | "children" | "blocked_by" | "depends_on" | "blocks" | "related";
  readonly label: string;
  readonly count: number;
  readonly tone: IssueRelationshipTone;
}

export interface IssueRelationshipModel {
  readonly parent: BeadsIssueRelationSummary | null;
  readonly summary: readonly IssueRelationshipSummaryItem[];
  readonly sections: readonly IssueRelationshipSection[];
  readonly totalSectionItemCount: number;
}

function toRelationshipItem(
  item: Pick<BeadsIssueDependency, "id" | "title" | "status" | "priority" | "issueType"> & {
    readonly description?: string | null | undefined;
  },
): IssueRelationshipItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    issueType: item.issueType,
    description: item.description ?? null,
  };
}

function toParentFallback(
  item: Pick<BeadsIssueDependency, "id" | "title" | "status" | "priority" | "issueType">,
): BeadsIssueRelationSummary {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    issueType: item.issueType,
    assignee: null,
    owner: null,
    parent: null,
  };
}

function dedupeRelationshipItems(items: readonly IssueRelationshipItem[]): IssueRelationshipItem[] {
  const deduped = new Map<string, IssueRelationshipItem>();
  for (const item of items) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }
  return [...deduped.values()];
}

export function buildIssueRelationshipModel(input: {
  readonly parent: BeadsIssueRelationSummary | null;
  readonly children: readonly BeadsIssueRelationSummary[];
  readonly dependencies: readonly BeadsIssueDependency[];
  readonly dependents?: readonly BeadsIssueRelationSummary[] | null | undefined;
}): IssueRelationshipModel {
  const grouped = groupDependenciesByType(input.dependencies);
  const parent =
    input.parent ?? (grouped.parentChild[0] ? toParentFallback(grouped.parentChild[0]) : null);

  const blockedBy = grouped.blockedBy.map(toRelationshipItem);
  const dependsOn = grouped.dependsOn.map(toRelationshipItem);
  const blocks = dedupeRelationshipItems([
    ...grouped.blocks.map(toRelationshipItem),
    ...(input.dependents ?? []).map((dependent) => toRelationshipItem(dependent)),
  ]);
  const related = grouped.other.map(toRelationshipItem);

  const sections: IssueRelationshipSection[] = [
    {
      key: "blocked_by",
      label: "Blocked by",
      emptyLabel: "Nothing is blocking this issue.",
      tone: "blocked",
      items: blockedBy,
    },
    {
      key: "depends_on",
      label: "Depends on",
      emptyLabel: "This issue has no explicit prerequisites.",
      tone: "prerequisite",
      items: dependsOn,
    },
    {
      key: "blocks",
      label: "Blocks",
      emptyLabel: "No downstream issues are waiting on this issue.",
      tone: "downstream",
      items: blocks,
    },
    {
      key: "related",
      label: "Related",
      emptyLabel: "No additional linked issues.",
      tone: "neutral",
      items: related,
    },
  ];

  const summary = (
    [
      { key: "parent", label: "Parent", count: parent ? 1 : 0, tone: "structure" },
      { key: "children", label: "Sub-issues", count: input.children.length, tone: "structure" },
      { key: "blocked_by", label: "Blocked by", count: blockedBy.length, tone: "blocked" },
      {
        key: "depends_on",
        label: "Depends on",
        count: dependsOn.length,
        tone: "prerequisite",
      },
      { key: "blocks", label: "Blocks", count: blocks.length, tone: "downstream" },
      { key: "related", label: "Related", count: related.length, tone: "neutral" },
    ] satisfies IssueRelationshipSummaryItem[]
  ).filter((item) => item.count > 0);

  const totalSectionItemCount = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );

  return {
    parent,
    summary,
    sections,
    totalSectionItemCount,
  };
}
