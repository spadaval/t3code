import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_SCAN_ROOTS = [
  "apps/server/src",
  "apps/web/src",
  "packages/shared/src",
  "packages/contracts/src",
  "scripts",
] as const;
const ALLOWED_PATH_PREFIXES = ["apps/server/src/beads/", "apps/server/src/persistence/"] as const;
const IGNORED_DIRECTORY_NAMES = new Set(["dist", "dist-electron", "node_modules", ".turbo"]);
const IGNORED_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".testHarness.ts",
  ".testHarness.tsx",
] as const;
const IGNORED_FILE_NAMES = new Set(["routeTree.gen.ts"]);
const IGNORED_FILE_PATHS = new Set([
  "scripts/epic-run-terminology-guard.ts",
  "scripts/epic-run-terminology-guard.test.ts",
]);
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".tsx"]);
const FORBIDDEN_TERM = /swarm/gi;

export interface ForbiddenTerminologyFinding {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
  readonly snippet: string;
}

function toRepoRelativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split("\\").join("/");
}

function hasSourceExtension(filePath: string): boolean {
  return [...SOURCE_FILE_EXTENSIONS].some((extension) => filePath.endsWith(extension));
}

function shouldIgnoreFile(relativePath: string): boolean {
  if (IGNORED_FILE_PATHS.has(relativePath)) {
    return true;
  }

  if (IGNORED_FILE_NAMES.has(relativePath.split("/").at(-1) ?? "")) {
    return true;
  }

  return IGNORED_FILE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

function isAllowedPath(relativePath: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function collectScanFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  const visit = async (absolutePath: string): Promise<void> => {
    const entries = await readdir(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(absolutePath, entry.name);
      const relativePath = toRepoRelativePath(rootDir, entryPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        await visit(entryPath);
        continue;
      }

      if (!entry.isFile() || !hasSourceExtension(entry.name) || shouldIgnoreFile(relativePath)) {
        continue;
      }

      files.push(entryPath);
    }
  };

  for (const scanRoot of DEFAULT_SCAN_ROOTS) {
    const absoluteScanRoot = resolve(rootDir, scanRoot);
    try {
      await visit(absoluteScanRoot);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }

  return files.toSorted();
}

function scanFileText(relativePath: string, text: string): ForbiddenTerminologyFinding[] {
  const findings: ForbiddenTerminologyFinding[] = [];
  const lines = text.split(/\r?\n/u);

  lines.forEach((lineText, lineIndex) => {
    FORBIDDEN_TERM.lastIndex = 0;

    let match: RegExpExecArray | null = null;
    while ((match = FORBIDDEN_TERM.exec(lineText)) !== null) {
      findings.push({
        filePath: relativePath,
        line: lineIndex + 1,
        column: match.index + 1,
        match: match[0],
        snippet: lineText.trim(),
      });
    }
  });

  return findings;
}

export async function findForbiddenSwarmTerminology(
  rootDir: string = DEFAULT_REPO_ROOT,
): Promise<ForbiddenTerminologyFinding[]> {
  const findings: ForbiddenTerminologyFinding[] = [];
  const files = await collectScanFiles(rootDir);

  for (const absolutePath of files) {
    const relativePath = toRepoRelativePath(rootDir, absolutePath);
    if (isAllowedPath(relativePath)) {
      continue;
    }

    const text = await readFile(absolutePath, "utf8");
    findings.push(...scanFileText(relativePath, text));
  }

  return findings;
}

export function formatForbiddenTerminologyFindings(
  findings: readonly ForbiddenTerminologyFinding[],
): string {
  const lines = [
    "Forbidden swarm terminology found outside allowed adapter paths.",
    "Allowed paths: apps/server/src/beads/** and apps/server/src/persistence/**.",
  ];

  for (const finding of findings) {
    lines.push(
      `- ${finding.filePath}:${finding.line.toString()}:${finding.column.toString()} ${finding.match} :: ${finding.snippet}`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const findings = await findForbiddenSwarmTerminology();
  if (findings.length === 0) {
    return;
  }

  throw new Error(formatForbiddenTerminologyFindings(findings));
}

if (resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  await main();
}
