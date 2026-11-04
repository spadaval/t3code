import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

export type VoiceEngine = "parakeet" | "google";

export const DEFAULT_VOICE_ENGINE: VoiceEngine = "parakeet";

/** Uses the engine chosen when each dictation starts; with only one engine present, that one. */
export function selectVoiceEngine(
  engines: Readonly<Record<VoiceEngine, VoiceTranscriber | null>>,
  chosen: () => VoiceEngine,
): VoiceTranscriber | null {
  const { parakeet, google } = engines;
  if (!parakeet || !google) return parakeet ?? google;
  return { prepare: (options) => (chosen() === "google" ? google : parakeet).prepare(options) };
}
