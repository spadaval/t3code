import { DEFAULT_MODEL, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

export function resolveFallbackModelSelection(
  modelSelection: ModelSelection | null | undefined,
): ModelSelection {
  if (modelSelection) {
    return modelSelection;
  }

  return {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  };
}
