import { VOICE_RECORDING_LIMIT_SECONDS } from "@t3tools/client-runtime/voice-input";
import type { SpeechStreamText } from "@t3tools/contracts";

/** A minute of audio waiting for the stream to open; past that, the recording is uploaded after stop. */
const MAX_BUFFERED_SAMPLES = 16_000 * 60;
/** The recorder drains its queue past the limit; the environment refuses a stream longer than it. */
const MAX_RECORDING_SAMPLES = 16_000 * VOICE_RECORDING_LIMIT_SECONDS;

export type LivePcmTap = {
  /** Sends the audio captured so far, then every new chunk, to `feed`; false once dropped. */
  attach(feed: (pcm: Float32Array) => void): boolean;
  /** Stops collecting audio; the recording file still holds all of it. */
  drop(): void;
  /** Settles once the recorder has delivered its last chunk. */
  ended(): Promise<void>;
};

/**
 * Carries one dictation's microphone PCM from the native recorder to the stream that sends it to the
 * environment, and that stream's live text back to the composer.
 */
export function createLiveDictation() {
  let chunks: Float32Array[] = [];
  let buffered = 0;
  let feed: ((pcm: Float32Array) => void) | null = null;
  let dropped = false;
  let recording = false;
  let captured = 0;
  let end = Promise.withResolvers<void>();
  const textListeners = new Set<(text: SpeechStreamText) => void>();
  const drop = () => {
    dropped = true;
    feed = null;
    chunks = [];
    buffered = 0;
  };

  return {
    /** Called when a transcriber prepares a dictation, before the recorder starts. */
    open(): LivePcmTap {
      drop();
      dropped = false;
      return {
        attach(next) {
          if (dropped) return false;
          const pending = chunks;
          chunks = [];
          buffered = 0;
          for (const chunk of pending) {
            next(chunk);
            if (dropped) return false;
          }
          feed = next;
          return true;
        },
        drop,
        ended: () => end.promise,
      };
    },
    /** Called when the recorder starts capturing. */
    start() {
      recording = true;
      captured = 0;
      end = Promise.withResolvers<void>();
    },
    /** 16-bit little-endian mono PCM at 16 kHz, as the recorder captured it. */
    push(bytes: Uint8Array) {
      if (!recording || dropped) return;
      const length = Math.min(bytes.byteLength >> 1, MAX_RECORDING_SAMPLES - captured);
      if (length <= 0) return;
      captured += length;
      const samples =
        bytes.byteOffset % 2 === 0
          ? new Int16Array(bytes.buffer, bytes.byteOffset, length)
          : new Int16Array(Uint8Array.from(bytes).buffer, 0, length);
      const pcm = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) pcm[i] = samples[i]! / 32768;
      if (feed) {
        feed(pcm);
        return;
      }
      buffered += pcm.length;
      if (buffered > MAX_BUFFERED_SAMPLES) drop();
      else chunks.push(pcm);
    },
    end() {
      if (!recording) return;
      recording = false;
      end.resolve();
    },
    publishText(text: SpeechStreamText) {
      for (const listener of textListeners) listener(text);
    },
    onText(listener: (text: SpeechStreamText) => void) {
      textListeners.add(listener);
      return () => void textListeners.delete(listener);
    },
  };
}

export type LiveDictation = ReturnType<typeof createLiveDictation>;

export const liveDictation = createLiveDictation();
