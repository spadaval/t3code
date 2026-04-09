import type { BeadsIssueSummary } from "@t3tools/contracts";

export interface IssueTreeNode {
  readonly issue: BeadsIssueSummary;
  readonly children: readonly IssueTreeNode[];
  readonly depth: number;
  readonly hasVisibleChildren: boolean;
  readonly isEpic: boolean;
  readonly isRoot: boolean;
}

export interface IssueTreeForest {
  readonly roots: readonly IssueTreeNode[];
  readonly visibleOrder: readonly BeadsIssueSummary[];
}

export interface IssueTreeRow {
  readonly issue: BeadsIssueSummary;
  readonly node: IssueTreeNode;
  readonly depth: number;
  readonly hasVisibleChildren: boolean;
  readonly isEpic: boolean;
  readonly isRoot: boolean;
  readonly isCollapsed: boolean;
}

export interface IssueTreeDescendantStatusCounts {
  readonly closed: number;
  readonly inProgress: number;
  readonly blocked: number;
  readonly total: number;
}

interface MutableIssueTreeNode {
  readonly issue: BeadsIssueSummary;
  readonly children: MutableIssueTreeNode[];
  readonly orderIndex: number;
  readonly isEpic: boolean;
}

function isEpicIssueType(issueType: string | null | undefined): boolean {
  return issueType?.trim().toLowerCase() === "epic";
}

function wouldIntroduceCycle(
  candidateParent: MutableIssueTreeNode,
  childIssueId: string,
  nodesById: ReadonlyMap<string, MutableIssueTreeNode>,
): boolean {
  let currentParentId = candidateParent.issue.parent?.id ?? null;

  while (currentParentId !== null) {
    if (currentParentId === childIssueId) {
      return true;
    }
    currentParentId = nodesById.get(currentParentId)?.issue.parent?.id ?? null;
  }

  return false;
}

function decorateIssueTreeNode(
  node: MutableIssueTreeNode,
  depth: number,
  isRoot: boolean,
): { readonly anchorIndex: number; readonly node: IssueTreeNode } {
  const decoratedChildren = node.children
    .map((child) => decorateIssueTreeNode(child, depth + 1, false))
    .toSorted((left, right) => left.anchorIndex - right.anchorIndex);

  const anchorIndex = decoratedChildren.reduce(
    (minimum, child) => Math.min(minimum, child.anchorIndex),
    node.orderIndex,
  );

  return {
    anchorIndex,
    node: {
      issue: node.issue,
      children: decoratedChildren.map((child) => child.node),
      depth,
      hasVisibleChildren: decoratedChildren.length > 0,
      isEpic: node.isEpic,
      isRoot,
    },
  };
}

export function hasVisibleChildren(node: IssueTreeNode): boolean {
  return node.hasVisibleChildren;
}

export function buildIssueTree(issues: readonly BeadsIssueSummary[]): IssueTreeForest {
  const nodesById = new Map<string, MutableIssueTreeNode>(
    issues.map((issue, index) => [
      issue.id,
      {
        issue,
        children: [],
        orderIndex: index,
        isEpic: isEpicIssueType(issue.issueType),
      },
    ]),
  );

  const roots: MutableIssueTreeNode[] = [];

  for (const issue of issues) {
    const node = nodesById.get(issue.id);
    if (!node) {
      continue;
    }

    const parentId = issue.parent?.id ?? null;
    const parent = parentId === null ? undefined : nodesById.get(parentId);

    if (
      parent === undefined ||
      parent.issue.id === issue.id ||
      wouldIntroduceCycle(parent, issue.id, nodesById)
    ) {
      roots.push(node);
      continue;
    }

    parent.children.push(node);
  }

  const decoratedRoots = roots
    .map((root) => decorateIssueTreeNode(root, 0, true))
    .toSorted((left, right) => left.anchorIndex - right.anchorIndex);

  return {
    roots: decoratedRoots.map((root) => root.node),
    visibleOrder: issues,
  };
}

export function flattenVisibleIssueTree(
  roots: readonly IssueTreeNode[],
  collapsedById: Readonly<Record<string, boolean>>,
): IssueTreeRow[] {
  const rows: IssueTreeRow[] = [];

  const visitNode = (node: IssueTreeNode) => {
    const isCollapsed = node.hasVisibleChildren ? (collapsedById[node.issue.id] ?? true) : false;

    rows.push({
      issue: node.issue,
      node,
      depth: node.depth,
      hasVisibleChildren: node.hasVisibleChildren,
      isEpic: node.isEpic,
      isRoot: node.isRoot,
      isCollapsed,
    });

    if (isCollapsed) {
      return;
    }

    for (const child of node.children) {
      visitNode(child);
    }
  };

  for (const root of roots) {
    visitNode(root);
  }

  return rows;
}

export function collectIssueTreeBranchIds(roots: readonly IssueTreeNode[]): string[] {
  const branchIds: string[] = [];

  const visitNode = (node: IssueTreeNode) => {
    if (node.hasVisibleChildren) {
      branchIds.push(node.issue.id);
    }

    for (const child of node.children) {
      visitNode(child);
    }
  };

  for (const root of roots) {
    visitNode(root);
  }

  return branchIds;
}

export function countIssueTreeDescendantStatuses(
  node: IssueTreeNode,
): IssueTreeDescendantStatusCounts {
  let closed = 0;
  let inProgress = 0;
  let blocked = 0;
  let total = 0;

  const visitNode = (current: IssueTreeNode) => {
    for (const child of current.children) {
      total += 1;
      if (child.issue.status === "closed") {
        closed += 1;
      } else if (child.issue.status === "in_progress" || child.issue.status === "hooked") {
        inProgress += 1;
      } else if (child.issue.status === "blocked") {
        blocked += 1;
      }

      visitNode(child);
    }
  };

  visitNode(node);

  return {
    closed,
    inProgress,
    blocked,
    total,
  };
}
