import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceRecorder,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

import { voiceTranscriptionModule, type LiveDictationStatus } from "./voiceModel";

type Native = NonNullable<typeof voiceTranscriptionModule>;

export type LiveVoiceRecorder = VoiceRecorder & {
  getStatus(): LiveDictationStatus | null;
};

/**
 * The native module captures and transcribes together, so a take is started in
 * prepare and its audio only starts counting once `record` is called.
 */
export function createLiveVoiceRecorder(native: Native): LiveVoiceRecorder {
  let uri: string | null = null;
  let active = false;
  return {
    get uri() {
      return uri;
    },
    async prepareToRecordAsync() {
      uri = await native.startLiveDictation();
      active = true;
    },
    record() {},
    async stop() {
      if (!active) return;
      active = false;
      await native.stopLiveDictation();
    },
    getStatus() {
      return active ? native.getLiveDictationStatus() : null;
    },
  };
}

/** Transcribes as the user speaks; finishing only waits for the last phrase. */
export function getLiveVoiceTranscriber(native: Native): VoiceTranscriber {
  return {
    prepare: async ({ signal }) => {
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
      // Abort covers cancels before and after recording; native discard is idempotent.
      signal.addEventListener("abort", () => native.cancelLiveDictation(), { once: true });
      return {
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        transcribe: async (_uri, { signal, draft }) => {
          throwIfVoiceTranscriptionAborted(signal);
          try {
            const text = await native.finishLiveDictation(draft.ownerKey, draft.text, Date.now());
            throwIfVoiceTranscriptionAborted(signal);
            return text.trim();
          } catch (error) {
            throwIfVoiceTranscriptionAborted(signal);
            throw new VoiceTranscriptionError(
              "transcription-failed",
              "Voice transcription failed.",
              {
                cause: error,
              },
            );
          }
        },
      };
    },
  };
}
