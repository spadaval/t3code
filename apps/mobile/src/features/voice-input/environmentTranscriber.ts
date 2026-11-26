import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";
import {
  VoiceTranscriptionError,
  VOICE_RECORDING_LIMIT_SECONDS,
  throwIfVoiceTranscriptionAborted,
  type VoiceStreamingSession,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import type { LivePcmTap } from "./liveDictation";

const pcmBytesPerSecond = 16_000 * 2;
const maxPcmBytes = pcmBytesPerSecond * VOICE_RECORDING_LIMIT_SECONDS;
// The recorder ends its PCM right after it stops; never let a lost end event hold the transcript.
const PCM_END_WAIT_MS = 2_000;

/** What `openSpeechStream` returns. */
export type SpeechStream = {
  readonly feed: (pcm: Float32Array) => void;
  readonly finish: () => Promise<string>;
  readonly cancel: () => void;
};

export function createEnvironmentTranscriber(input: {
  readonly canSend: () => boolean;
  /** `streaming` is whether the environment's model accepts audio while the user speaks. */
  readonly prepare: (
    signal: AbortSignal,
  ) => Promise<{ readonly locale: string; readonly streaming: boolean }>;
  readonly decode: (uri: string) => Promise<Uint8Array>;
  readonly upload: (pcm: Uint8Array, signal: AbortSignal) => Promise<string>;
  /** Present when the recorder captures PCM during recording. */
  readonly stream?: {
    readonly openTap: () => LivePcmTap;
    readonly open: (signal: AbortSignal, onError: () => void) => Promise<SpeechStream>;
  };
}): VoiceTranscriber {
  function check(signal: AbortSignal) {
    throwIfVoiceTranscriptionAborted(signal);
    if (!input.canSend()) {
      throw new VoiceTranscriptionError({
        code: "cancelled",
        message: m(msg("Your transcription choice changed.")),
      });
    }
  }
  async function uploadRecording(uri: string, signal: AbortSignal) {
    const decoded = await input.decode(uri);
    check(signal);
    if (!decoded.length || decoded.length % 2 || decoded.length > maxPcmBytes + pcmBytesPerSecond) {
      throw new VoiceTranscriptionError({
        code: "transcription-failed",
        message: m(msg("This recording couldn’t be read. Try recording again.")),
      });
    }
    // A timed native stop can include a final encoder packet beyond the recording limit.
    const bytes = decoded.subarray(0, maxPcmBytes);
    const samples =
      bytes.byteOffset % 2 === 0
        ? new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
        : new Int16Array(Uint8Array.from(bytes).buffer);
    const pcm = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) pcm[i] = samples[i]! / 32768;
    const text = await input.upload(new Uint8Array(pcm.buffer), signal);
    check(signal);
    return text;
  }
  return {
    async prepare({ signal }) {
      check(signal);
      const tap = input.stream?.openTap() ?? null;
      let locale = "auto";
      let recordingUri: string | null = null;
      let stream: SpeechStream | null = null;
      let streamFailed = false;
      let uploading = false;
      const onStreamError = () => {
        streamFailed = true;
        tap?.drop();
      };
      const ready = input.prepare(signal).then(async (resolved) => {
        check(signal);
        locale = resolved.locale;
        if (!tap || !input.stream || !resolved.streaming || uploading) {
          tap?.drop();
          return;
        }
        let opened: SpeechStream;
        try {
          opened = await input.stream.open(signal, onStreamError);
        } catch {
          // The recording file still holds every word; it uploads after stop instead.
          check(signal);
          tap.drop();
          return;
        }
        if (uploading || streamFailed || !tap.attach(opened.feed)) {
          opened.cancel();
          return;
        }
        stream = opened;
      });
      void ready.catch(() => {});
      const streaming: VoiceStreamingSession = {
        async finish({ signal }) {
          const current = stream!;
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            tap!.ended(),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, PCM_END_WAIT_MS);
            }),
          ]);
          clearTimeout(timer);
          check(signal);
          try {
            const text = await current.finish();
            check(signal);
            return text;
          } catch (error) {
            check(signal);
            if (!recordingUri) throw error;
            return uploadRecording(recordingUri, signal);
          }
        },
      };
      return {
        get locale() {
          return locale;
        },
        get streaming() {
          // A stream that dropped mid-recording falls back to uploading the recording.
          return stream && !streamFailed ? streaming : undefined;
        },
        async start(uri, { signal }) {
          recordingUri = uri;
          await ready;
          check(signal);
          return null;
        },
        async transcribe(uri, { signal }) {
          uploading = true;
          await ready;
          stream?.cancel();
          tap?.drop();
          check(signal);
          return uploadRecording(uri, signal);
        },
      };
    },
  };
}
