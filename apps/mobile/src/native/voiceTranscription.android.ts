import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
  type VoiceTranscribeOptions,
} from "@t3tools/client-runtime/voice-input";

import { voiceTranscriptionModule } from "./voiceModel";

// The on-device model is English-only, so this only informs how the transcript
// is joined to the draft.
function getDeviceLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  const native = voiceTranscriptionModule;
  if (!native) return null;
  return {
    prepare: async ({ signal }): Promise<PreparedVoiceTranscription> => {
      throwIfVoiceTranscriptionAborted(signal);
      if (native.getModelState().status !== "installed") {
        throw new VoiceTranscriptionError(
          "unavailable",
          "Download the voice model in Settings > Voice input to use dictation.",
        );
      }
      try {
        await native.prepare();
      } catch (error) {
        throw new VoiceTranscriptionError(
          "preparation-failed",
          "Voice transcription could not load its model.",
          { cause: error },
        );
      }
      throwIfVoiceTranscriptionAborted(signal);
      return {
        locale: getDeviceLocale(),
        transcribe: (uri, options) => transcribe(native, uri, options),
      };
    },
  };
}

async function transcribe(
  native: NonNullable<typeof voiceTranscriptionModule>,
  uri: string,
  { signal, draft }: VoiceTranscribeOptions,
): Promise<string> {
  throwIfVoiceTranscriptionAborted(signal);
  // Native work stops between audio pieces; the promise settles once it has.
  const onAbort = () => native.cancelTranscription();
  signal.addEventListener("abort", onAbort);
  try {
    const text = await native.transcribe(uri, draft.ownerKey, draft.text, Date.now());
    throwIfVoiceTranscriptionAborted(signal);
    return text.trim();
  } catch (error) {
    throwIfVoiceTranscriptionAborted(signal);
    throw new VoiceTranscriptionError("transcription-failed", "Voice transcription failed.", {
      cause: error,
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
