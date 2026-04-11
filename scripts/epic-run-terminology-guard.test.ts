import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  findForbiddenSwarmTerminology,
  formatForbiddenTerminologyFindings,
} from "./epic-run-terminology-guard.ts";

const TEST_FILE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(TEST_FILE_PATH), "..");

const tempDirs: string[] = [];

async function writeRepoFile(rootDir: string, relativePath: string, content: string) {
  const absolutePath = join(rootDir, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("findForbiddenSwarmTerminology", () => {
  it("flags product-code leaks while allowing adapters, migrations, and tests", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "t3code-epic-run-guard-"));
    tempDirs.push(rootDir);

    await writeRepoFile(rootDir, "apps/web/src/leak.ts", 'export const label = "swarm leak";\n');
    await writeRepoFile(
      rootDir,
      "apps/server/src/beads/raw-adapter.ts",
      'export const raw = "swarm status";\n',
    );
    await writeRepoFile(
      rootDir,
      "apps/server/src/persistence/Migrations.ts",
      'export const migration = "ProjectionSwarmRuns";\n',
    );
    await writeRepoFile(
      rootDir,
      "packages/shared/src/epicRun.test.ts",
      'describe("swarm", () => {});\n',
    );

    const findings = await findForbiddenSwarmTerminology(rootDir);

    expect(findings).toEqual([
      {
        filePath: "apps/web/src/leak.ts",
        line: 1,
        column: 23,
        match: "swarm",
        snippet: 'export const label = "swarm leak";',
      },
    ]);
  });

  it("keeps the current repo clean outside allowed paths", async () => {
    await expect(findForbiddenSwarmTerminology(REPO_ROOT)).resolves.toEqual([]);
  });

  it("formats findings with actionable output", () => {
    expect(
      formatForbiddenTerminologyFindings([
        {
          filePath: "apps/web/src/leak.ts",
          line: 2,
          column: 7,
          match: "swarm",
          snippet: 'const label = "swarm";',
        },
      ]),
    ).toContain('apps/web/src/leak.ts:2:7 swarm :: const label = "swarm";');
  });
});
