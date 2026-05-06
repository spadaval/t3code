import { describe, expect, it } from "vitest";

import {
  extractBeadsIssueRefCandidates,
  linkifyBeadsIssueRefsInMarkdown,
  MAX_BEADS_ISSUE_REF_CANDIDATES,
} from "./beadsIssueRefs";

describe("extractBeadsIssueRefCandidates", () => {
  it("detects project, legacy, and conventional uppercase beads issue ids", () => {
    expect(
      extractBeadsIssueRefCandidates("See t3code-dci, t3code-3ne.12.1, bd-42, and TASK-1.", {
        projectId: "t3code",
      }),
    ).toEqual(["t3code-dci", "t3code-3ne.12.1", "bd-42", "TASK-1"]);
  });

  it("ignores urls, markdown links, inline code, and fenced code", () => {
    expect(
      extractBeadsIssueRefCandidates(
        [
          "https://example.test/t3code-dci",
          "[t3code-dci](https://example.test)",
          "`t3code-3ne`",
          "```",
          "TASK-1",
          "```",
          "real t3code-op2",
        ].join("\n"),
        { projectId: "t3code" },
      ),
    ).toEqual(["t3code-op2"]);
  });

  it("deduplicates candidates and enforces the limit", () => {
    const text = Array.from(
      { length: MAX_BEADS_ISSUE_REF_CANDIDATES + 5 },
      (_, index) => `t3code-${index.toString(36)}`,
    ).join(" ");

    const candidates = extractBeadsIssueRefCandidates(`t3code-a ${text}`, {
      projectId: "t3code",
    });

    expect(candidates).toHaveLength(MAX_BEADS_ISSUE_REF_CANDIDATES);
    expect(candidates[0]).toBe("t3code-a");
    expect(candidates.filter((candidate) => candidate === "t3code-a")).toHaveLength(1);
  });

  it("does not match path-like or ordinary hyphenated text", () => {
    expect(
      extractBeadsIssueRefCandidates("src/t3code-dci file-name package-name t3code-dci.ts", {
        projectId: "t3code",
      }),
    ).toEqual([]);
  });
});

describe("linkifyBeadsIssueRefsInMarkdown", () => {
  it("rewrites plain issue refs without touching ignored markdown ranges", () => {
    expect(
      linkifyBeadsIssueRefsInMarkdown(
        "See t3code-dci, `t3code-dci`, and [t3code-dci](https://example.test).",
        ["t3code-dci"],
      ),
    ).toBe(
      "See [t3code-dci](beads://issue/t3code-dci), `t3code-dci`, and [t3code-dci](https://example.test).",
    );
  });
});
