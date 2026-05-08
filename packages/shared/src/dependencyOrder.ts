export interface DependencyOrderOptions<T> {
  readonly items: readonly T[];
  readonly getId: (item: T) => string;
  readonly getCreatedAt: (item: T) => string | null | undefined;
  readonly getTitle?: (item: T) => string | null | undefined;
  readonly getPredecessorIds: (item: T, siblingIds: ReadonlySet<string>) => readonly string[];
}

export function compareItemsByCreatedAt<T>(
  left: T,
  right: T,
  input: Pick<DependencyOrderOptions<T>, "getId" | "getCreatedAt" | "getTitle">,
): number {
  const leftCreatedAt = input.getCreatedAt(left) ?? null;
  const rightCreatedAt = input.getCreatedAt(right) ?? null;

  if (leftCreatedAt !== null && rightCreatedAt !== null) {
    const createdAtDelta = leftCreatedAt.localeCompare(rightCreatedAt);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
  } else if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt === null ? 1 : -1;
  }

  const leftTitle = input.getTitle?.(left)?.trim() ?? null;
  const rightTitle = input.getTitle?.(right)?.trim() ?? null;
  if (leftTitle !== null && rightTitle !== null) {
    const titleDelta = leftTitle.localeCompare(rightTitle, undefined, { sensitivity: "base" });
    if (titleDelta !== 0) {
      return titleDelta;
    }
  } else if (leftTitle !== rightTitle) {
    return leftTitle === null ? 1 : -1;
  }

  return input.getId(left).localeCompare(input.getId(right));
}

function insertSorted<T>(items: T[], candidate: T, compare: (left: T, right: T) => number): void {
  const insertAt = items.findIndex((entry) => compare(candidate, entry) < 0);
  if (insertAt === -1) {
    items.push(candidate);
    return;
  }

  items.splice(insertAt, 0, candidate);
}

export function topologicallySortByDependencies<T>(input: DependencyOrderOptions<T>): T[] {
  if (input.items.length <= 1) {
    return [...input.items];
  }

  const siblingIds = new Set(input.items.map((item) => input.getId(item)));
  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const item of input.items) {
    const itemId = input.getId(item);
    adjacency.set(itemId, new Set());
    indegree.set(itemId, 0);
  }

  const addEdge = (fromId: string, toId: string) => {
    if (fromId === toId) {
      return;
    }

    const neighbors = adjacency.get(fromId);
    if (!neighbors || neighbors.has(toId)) {
      return;
    }

    neighbors.add(toId);
    indegree.set(toId, (indegree.get(toId) ?? 0) + 1);
  };

  for (const item of input.items) {
    const itemId = input.getId(item);
    for (const predecessorId of input.getPredecessorIds(item, siblingIds)) {
      if (!siblingIds.has(predecessorId)) {
        continue;
      }
      addEdge(predecessorId, itemId);
    }
  }

  const compare = (left: T, right: T) => compareItemsByCreatedAt(left, right, input);
  const remainingById = new Map(input.items.map((item) => [input.getId(item), item] as const));
  const ready = input.items.filter((item) => (indegree.get(input.getId(item)) ?? 0) === 0);
  ready.sort(compare);

  const result: T[] = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) {
      continue;
    }

    const nextId = input.getId(next);
    if (!remainingById.has(nextId)) {
      continue;
    }

    remainingById.delete(nextId);
    result.push(next);

    for (const dependentId of adjacency.get(nextId) ?? []) {
      const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        const dependent = remainingById.get(dependentId);
        if (dependent) {
          insertSorted(ready, dependent, compare);
        }
      }
    }
  }

  if (remainingById.size > 0) {
    result.push(...[...remainingById.values()].toSorted(compare));
  }

  return result;
}
