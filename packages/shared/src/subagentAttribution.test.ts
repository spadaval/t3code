import { describe, expect, it } from "vitest";

import {
  buildSubagentRunId,
  extractCodexSubagentLaunch,
  extractOpenCodeSubagentLaunch,
  extractProviderErrorText,
  extractProviderResultText,
} from "./subagentAttribution.ts";

describe("subagentAttribution", () => {
  it("builds stable subagent run ids", () => {
    expect(buildSubagentRunId("thread-1", "turn-2", "item-3")).toBe(
      "subagent:thread-1:turn-2:item-3",
    );
  });

  it("extracts Codex collab agent launch fields from structured tool input", () => {
    expect(
      extractCodexSubagentLaunch({
        toolName: "collab_agent",
        input: {
          title: "Implement bead",
          prompt: "Add the contracts",
          agentType: "implementation",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          config: { sandboxMode: "workspace-write" },
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        title: "Implement bead",
        description: null,
        prompt: "Add the contracts",
        agentType: "implementation",
        model: "gpt-5-codex",
        reasoningEffort: "high",
        config: { sandboxMode: "workspace-write" },
      },
    });
  });

  it("extracts OpenCode task/agent launch fields from structured parts", () => {
    expect(
      extractOpenCodeSubagentLaunch({
        type: "tool",
        tool: "task",
        args: {
          task: {
            description: "Fix projection",
            instructions: "Wire the event",
            agent: "worker",
          },
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        title: null,
        description: "Fix projection",
        prompt: "Wire the event",
        agentType: "worker",
        model: null,
        reasoningEffort: null,
        config: null,
      },
    });
  });

  it("extracts provider result and error text from structured fields", () => {
    expect(extractProviderResultText({ result: { text: "Subagent completed" } })).toEqual({
      ok: true,
      value: "Subagent completed",
    });
    expect(extractProviderErrorText({ error: { message: "Subagent failed" } })).toEqual({
      ok: true,
      value: "Subagent failed",
    });
  });

  it("returns explicit reasons for unavailable structured attribution", () => {
    expect(extractCodexSubagentLaunch({ toolName: "shell", input: { command: "pwd" } })).toEqual({
      ok: false,
      reason: "tool call is not a subagent launch",
    });
    expect(extractOpenCodeSubagentLaunch({ type: "text", text: "hello" })).toEqual({
      ok: false,
      reason: "part is not an OpenCode task or agent tool",
    });
    expect(extractProviderResultText({ result: { items: [] } })).toEqual({
      ok: false,
      reason: "result does not contain structured text",
    });
    expect(extractProviderErrorText({ error: { code: "ENOENT" } })).toEqual({
      ok: false,
      reason: "error does not contain structured text",
    });
  });
});
