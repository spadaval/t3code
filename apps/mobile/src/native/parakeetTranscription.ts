import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceTranscriptionOptions,
  type VoiceTranscribeOptions,
} from "@t3tools/client-runtime/voice-input";

import { parakeetModule } from "./parakeetModel";

// The on-device model is English-only, so this only informs how the transcript
// is joined to the draft.
function getDeviceLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

export type ParakeetPrepared = PreparedVoiceTranscription & {
  /** Also returns the saved debug clip's audio path, or null when capture is off. */
  readonly transcribeToClip: (
    uri: string,
    options: VoiceTranscribeOptions,
  ) => Promise<{ readonly text: string; readonly clip: string | null }>;
};

export type ParakeetTranscriber = {
  readonly prepare: (options: VoiceTranscriptionOptions) => Promise<ParakeetPrepared>;
};

export function getParakeetTranscriber(): ParakeetTranscriber | null {
  const native = parakeetModule;
  if (!native) return null;
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      if (native.getModelState().status !== "installed") {
        throw new VoiceTranscriptionError({
          code: "unavailable",
          message: "Download the voice model in Settings > Voice input to use dictation.",
        });
      }
      try {
        await native.prepare();
      } catch (error) {
        throw new VoiceTranscriptionError({
          code: "preparation-failed",
          message: "Voice transcription could not load its model.",
          cause: error,
        });
      }
      throwIfVoiceTranscriptionAborted(signal);
      return {
        locale: getDeviceLocale(),
        transcribe: (uri, options) => transcribe(native, uri, options).then(({ text }) => text),
        transcribeToClip: (uri, options) => transcribe(native, uri, options),
      };
    },
  };
}

async function transcribe(
  native: NonNullable<typeof parakeetModule>,
  uri: string,
  { signal, draft }: VoiceTranscribeOptions,
): Promise<{ readonly text: string; readonly clip: string | null }> {
  throwIfVoiceTranscriptionAborted(signal);
  // Native work stops between audio pieces; the promise settles once it has.
  const onAbort = () => native.cancelTranscription();
  signal.addEventListener("abort", onAbort);
  try {
    const { text, clip } = await native.transcribe(uri, draft.ownerKey, draft.text, Date.now());
    throwIfVoiceTranscriptionAborted(signal);
    return { text: text.trim(), clip };
  } catch (error) {
    throwIfVoiceTranscriptionAborted(signal);
    throw new VoiceTranscriptionError({
      code: "transcription-failed",
      message: "Voice transcription failed.",
      cause: error,
    });
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
