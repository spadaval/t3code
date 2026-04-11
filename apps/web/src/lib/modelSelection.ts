import type { ModelSelection } from "@t3tools/contracts";

export function resolveDefaultModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ModelSelection {
  if (modelSelection) {
    return modelSelection;
  }

  return { provider: "codex", model: "codex-mini-latest" };
}
