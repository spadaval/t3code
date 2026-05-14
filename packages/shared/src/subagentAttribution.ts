export type SubagentLaunchAttribution = {
  readonly title: string | null;
  readonly description: string | null;
  readonly prompt: string | null;
  readonly agentType: string | null;
  readonly model: string | null;
  readonly reasoningEffort: string | null;
  readonly config: unknown;
};

export type SubagentExtractionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(record: Record<string, unknown>, keys: ReadonlyArray<string>): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function firstRecord(
  record: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstArrayRecord(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map(asRecord).find((entry) => entry !== undefined);
}

function normalizeLaunch(record: Record<string, unknown>): SubagentLaunchAttribution {
  const config = firstRecord(record, ["config", "options", "agentConfig"]) ?? null;
  return {
    title: firstString(record, ["title", "name", "label"]),
    description: firstString(record, ["description", "summary"]),
    prompt: firstString(record, ["prompt", "task", "instructions", "input"]),
    agentType: firstString(record, ["agentType", "agent", "subagentType", "type"]),
    model: firstString(record, ["model", "modelName"]),
    reasoningEffort: firstString(record, ["reasoningEffort", "effort"]),
    config,
  };
}

function hasLaunchSignal(value: SubagentLaunchAttribution): boolean {
  return (
    value.title !== null ||
    value.description !== null ||
    value.prompt !== null ||
    value.agentType !== null ||
    value.model !== null ||
    value.reasoningEffort !== null ||
    value.config !== null
  );
}

export function buildSubagentRunId(threadId: string, turnId: string, parentItemId: string): string {
  return `subagent:${threadId}:${turnId}:${parentItemId}`;
}

export function extractCodexSubagentLaunch(
  payload: unknown,
): SubagentExtractionResult<SubagentLaunchAttribution> {
  const root = asRecord(payload);
  if (!root) {
    return { ok: false, reason: "payload is not an object" };
  }

  const toolName = firstString(root, ["name", "toolName", "tool"]);
  const input = firstRecord(root, ["input", "arguments", "args", "rawInput"]) ?? root;
  const inputToolName = firstString(input, ["name", "toolName", "tool"]);
  const normalizedToolName = (toolName ?? inputToolName ?? "").toLowerCase();
  if (
    normalizedToolName &&
    !normalizedToolName.includes("agent") &&
    !normalizedToolName.includes("subagent")
  ) {
    return { ok: false, reason: "tool call is not a subagent launch" };
  }

  const candidate = firstRecord(input, ["subagent", "agent", "task", "launch", "request"]) ?? input;
  const launch = normalizeLaunch(candidate);
  if (!hasLaunchSignal(launch)) {
    return { ok: false, reason: "payload does not contain structured launch fields" };
  }
  return { ok: true, value: launch };
}

export function extractOpenCodeSubagentLaunch(
  part: unknown,
): SubagentExtractionResult<SubagentLaunchAttribution> {
  const root = asRecord(part);
  if (!root) {
    return { ok: false, reason: "part is not an object" };
  }

  const type = firstString(root, ["type", "kind"]);
  const tool = firstString(root, ["tool", "name", "toolName"]);
  const normalized = `${type ?? ""} ${tool ?? ""}`.toLowerCase();
  if (normalized && !normalized.includes("task") && !normalized.includes("agent")) {
    return { ok: false, reason: "part is not an OpenCode task or agent tool" };
  }

  const input = firstRecord(root, ["input", "args", "arguments", "params"]) ?? root;
  const candidate = firstRecord(input, ["task", "agent", "subagent"]) ?? input;
  const launch = normalizeLaunch(candidate);
  if (!hasLaunchSignal(launch)) {
    return { ok: false, reason: "part does not contain structured launch fields" };
  }
  return { ok: true, value: launch };
}

export function extractProviderResultText(payload: unknown): SubagentExtractionResult<string> {
  const root = asRecord(payload);
  if (!root) {
    const direct = asString(payload);
    return direct ? { ok: true, value: direct } : { ok: false, reason: "result is not textual" };
  }

  const result = firstRecord(root, ["result", "output", "data"]) ?? root;
  const direct = firstString(result, ["text", "content", "message", "summary", "output"]);
  if (direct) {
    return { ok: true, value: direct };
  }

  const firstContent = firstArrayRecord(result.content);
  const contentText = firstContent ? firstString(firstContent, ["text", "content"]) : null;
  return contentText
    ? { ok: true, value: contentText }
    : { ok: false, reason: "result does not contain structured text" };
}

export function extractProviderErrorText(payload: unknown): SubagentExtractionResult<string> {
  const root = asRecord(payload);
  if (!root) {
    const direct = asString(payload);
    return direct ? { ok: true, value: direct } : { ok: false, reason: "error is not textual" };
  }

  const error = firstRecord(root, ["error", "failure"]) ?? root;
  const direct = firstString(error, ["message", "reason", "error", "text", "detail"]);
  return direct
    ? { ok: true, value: direct }
    : { ok: false, reason: "error does not contain structured text" };
}
