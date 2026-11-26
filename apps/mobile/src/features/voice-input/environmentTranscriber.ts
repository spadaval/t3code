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
// The recorder ends its PCM right after it stops; a lost end event sends the recording file instead.
const PCM_END_WAIT_MS = 2_000;
// The environment resets a closed stream's model before it frees its one speech slot, which can
// take seconds; an upload sent sooner is refused as busy.
const STREAM_RELEASE_WAIT_MS = 10_000;
const STREAM_RELEASE_POLL_MS = 250;

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
    /** Whether the environment is still running a speech operation, such as a closing stream. */
    readonly busy: (signal: AbortSignal) => Promise<boolean>;
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
  async function awaitStreamRelease(signal: AbortSignal) {
    // The deadline bounds each status request too, so a stalled response can't hold the upload.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), STREAM_RELEASE_WAIT_MS);
    const cancel = () => deadline.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const bounded = deadline.signal;
    try {
      while (!bounded.aborted) {
        let busy: boolean;
        try {
          busy = await input.stream!.busy(bounded);
        } catch {
          // The upload reports whatever is wrong with the environment.
          busy = false;
        }
        check(signal);
        if (!busy) return;
        await pause(STREAM_RELEASE_POLL_MS, bounded);
        check(signal);
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    }
  }
  return {
    async prepare({ signal }) {
      check(signal);
      const tap = input.stream?.openTap() ?? null;
      let locale = "auto";
      let recordingUri: string | null = null;
      let stream: SpeechStream | null = null;
      let streamOpened = false;
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
        streamOpened = true;
        if (uploading || streamFailed || !tap.attach(opened.feed)) {
          opened.cancel();
          return;
        }
        stream = opened;
      });
      void ready.catch(() => {});
      const upload = async (uri: string, signal: AbortSignal) => {
        if (streamOpened) await awaitStreamRelease(signal);
        return uploadRecording(uri, signal);
      };
      const streaming: VoiceStreamingSession = {
        async finish({ signal }) {
          const current = stream!;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const ended = await Promise.race([
            tap!.ended().then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), PCM_END_WAIT_MS);
            }),
          ]);
          clearTimeout(timer);
          check(signal);
          if (!ended) {
            // The stream may be missing the last words; the recording file has them all.
            streamFailed = true;
            current.cancel();
            tap!.drop();
            if (!recordingUri)
              throw new VoiceTranscriptionError({
                code: "transcription-failed",
                message: m(msg("This recording couldn’t be read. Try recording again.")),
              });
            return upload(recordingUri, signal);
          }
          try {
            const text = await current.finish();
            check(signal);
            return text;
          } catch (error) {
            // The stream is spent; a retry of this recording uploads it.
            streamFailed = true;
            check(signal);
            if (!recordingUri) throw error;
            return upload(recordingUri, signal);
          }
        },
      };
      return {
        get locale() {
          return locale;
        },
        get streaming() {
          // A stream that dropped or failed falls back to uploading the recording.
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
          return upload(uri, signal);
        },
      };
    },
  };
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
