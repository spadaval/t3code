import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

export async function getLocalVoiceTranscriber(): Promise<VoiceTranscriber | null> {
  return null;
}

export function addLiveTranscriptListener(
  _listener: (transcript: { readonly committed: string; readonly pending: string }) => void,
): { remove(): void } | null {
  return null;
}
