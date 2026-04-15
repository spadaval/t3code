import { DEFAULT_MODEL_BY_PROVIDER, type ModelSelection } from "@t3tools/contracts";

export function resolveFallbackModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ModelSelection {
  if (modelSelection) {
    return modelSelection;
  }

  return {
    provider: "codex",
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };
}
