import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceRecorder,
} from "@t3tools/client-runtime/voice-input";

import { parakeetModule, type LiveDictationStatus } from "./parakeetModel";
import type { ParakeetTranscriber } from "./parakeetTranscription";

type Native = NonNullable<typeof parakeetModule>;

export type LiveVoiceRecorder = VoiceRecorder & {
  getStatus(): LiveDictationStatus | null;
};

/**
 * The native module captures and transcribes together, so a take is started in
 * prepare and its audio only starts counting once `record` is called.
 */
export function createLiveDictationRecorder(native: Native): LiveVoiceRecorder {
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

/** Parakeet transcribing as the user speaks; finishing only waits for the last phrase. */
export function getLiveDictationTranscriber(): ParakeetTranscriber | null {
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
      // Abort covers cancels before and after recording; native discard is idempotent.
      signal.addEventListener("abort", () => native.cancelLiveDictation(), { once: true });
      const finish = async ({
        signal,
        draft,
      }: {
        readonly signal: AbortSignal;
        readonly draft: { ownerKey: string; text: string };
      }) => {
        throwIfVoiceTranscriptionAborted(signal);
        try {
          const { text, clip } = await native.finishLiveDictation(
            draft.ownerKey,
            draft.text,
            Date.now(),
          );
          throwIfVoiceTranscriptionAborted(signal);
          return { text: text.trim(), clip };
        } catch (error) {
          throwIfVoiceTranscriptionAborted(signal);
          throw new VoiceTranscriptionError({
            code: "transcription-failed",
            message: "Voice transcription failed.",
            cause: error,
          });
        }
      };
      return {
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        liveDictation: true,
        transcribe: (_uri, options) => finish(options).then(({ text }) => text),
        transcribeToClip: (_uri, options) => finish(options),
      };
    },
  };
}
