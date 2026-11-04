import type {
  PreparedVoiceTranscription,
  VoiceTranscribeOptions,
  VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

import type { ParakeetTranscriber } from "./parakeetTranscription";

export type VoiceEngine = "parakeet" | "google";

export const DEFAULT_VOICE_ENGINE: VoiceEngine = "parakeet";

export interface VoiceEngineSettings {
  readonly engine: VoiceEngine;
  /** Also run the other engine on each saved Parakeet clip and record its result there. */
  readonly compare: boolean;
}

type Draft = VoiceTranscribeOptions["draft"];

/**
 * Uses the engine chosen when each dictation starts; with only one engine present, that one.
 * Comparison never changes what is inserted: the chosen engine's text, or its error.
 */
export function selectVoiceEngine(input: {
  readonly parakeet: ParakeetTranscriber | null;
  readonly google: VoiceTranscriber | null;
  readonly settings: () => VoiceEngineSettings;
  readonly annotateClip: (clip: string, comparison: object) => Promise<void>;
}): VoiceTranscriber | null {
  const { parakeet, google, settings, annotateClip } = input;
  if (!parakeet || !google) return parakeet ?? google;
  // Google runs one recognition at a time, so background comparisons queue.
  let comparisons: Promise<unknown> = Promise.resolve();
  const record = (clip: string, comparison: object) =>
    annotateClip(clip, comparison).catch(() => {});

  const runGoogle = async (uri: string, draft: Draft) => {
    const signal = new AbortController().signal;
    const startedAt = Date.now();
    try {
      const prepared = await google.prepare({ signal });
      const preparedAt = Date.now();
      const transcript = await prepared.transcribe(uri, { signal, draft });
      return {
        transcript,
        ...describePrepared(prepared),
        prepareMs: preparedAt - startedAt,
        transcribeMs: Date.now() - preparedAt,
      };
    } catch (error) {
      return { error: describeError(error) };
    }
  };

  return {
    prepare: async (options) => {
      const { engine, compare } = settings();
      if (!compare) return (engine === "google" ? google : parakeet).prepare(options);
      if (engine === "parakeet") {
        const prepared = await parakeet.prepare(options);
        return {
          locale: prepared.locale,
          transcribe: async (uri, transcribeOptions) => {
            const { text, clip } = await prepared.transcribeToClip(uri, transcribeOptions);
            // Runs on the saved copy, since the recording is deleted once this returns.
            if (clip) {
              const draft = transcribeOptions.draft;
              comparisons = comparisons.then(async () =>
                record(clip, { chosenEngine: "parakeet", google: await runGoogle(clip, draft) }),
              );
            }
            return text;
          },
        };
      }
      const [chosen, other] = await Promise.all([
        google.prepare(options),
        parakeet.prepare(options).catch(() => null),
      ]);
      if (!other) return chosen;
      return {
        locale: chosen.locale,
        transcribe: async (uri, transcribeOptions) => {
          const otherRun = other
            .transcribeToClip(uri, { ...transcribeOptions, signal: new AbortController().signal })
            .catch(() => null);
          const startedAt = Date.now();
          let result: { readonly transcript: string } | { readonly error: unknown };
          try {
            result = { transcript: await chosen.transcribe(uri, transcribeOptions) };
          } catch (error) {
            result = { error };
          }
          if (!transcribeOptions.signal.aborted) {
            // Parakeet is faster than Google's real-time pacing, so this rarely waits.
            const clip = (await otherRun)?.clip;
            if (clip) {
              void record(clip, {
                chosenEngine: "google",
                google:
                  "error" in result
                    ? { error: describeError(result.error) }
                    : {
                        transcript: result.transcript,
                        ...describePrepared(chosen),
                        transcribeMs: Date.now() - startedAt,
                      },
              });
            }
          }
          if ("error" in result) throw result.error;
          return result.transcript;
        },
      };
    },
  };
}

function describePrepared(prepared: PreparedVoiceTranscription) {
  return { locale: prepared.locale, mode: "mode" in prepared ? prepared.mode : null };
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = error.cause;
  return {
    message: error.message,
    ...("code" in error ? { code: error.code } : {}),
    ...(typeof cause === "object" && cause !== null && "code" in cause
      ? { nativeCode: cause.code }
      : {}),
  };
}
