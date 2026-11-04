import { describe, expect, it, vi } from "vite-plus/test";

import type { VoiceTranscriber } from "@t3tools/client-runtime/voice-input";

import type { ParakeetTranscriber } from "./parakeetTranscription";
import { selectVoiceEngine, type VoiceEngine } from "./voiceEngine";

const draft = { ownerKey: "thread", text: "" };

function engines(google: (uri: string) => Promise<string>) {
  const parakeetCalls: string[] = [];
  const googleCalls: string[] = [];
  const parakeet: ParakeetTranscriber = {
    prepare: async () => ({
      locale: "en-US",
      transcribe: async () => "parakeet text",
      transcribeToClip: async (uri) => {
        parakeetCalls.push(uri);
        return { text: "parakeet text", clip: "/clips/1.m4a" };
      },
    }),
  };
  const googleTranscriber: VoiceTranscriber = {
    prepare: async () =>
      Object.assign(
        {
          locale: "en-US",
          transcribe: (uri: string) => {
            googleCalls.push(uri);
            return google(uri);
          },
        },
        { mode: 1 },
      ),
  };
  return { parakeet, google: googleTranscriber, parakeetCalls, googleCalls };
}

async function dictate(engine: VoiceEngine, google: (uri: string) => Promise<string>) {
  const fixture = engines(google);
  const annotateClip = vi.fn(async (_clip: string, _comparison: object) => {});
  const transcriber = selectVoiceEngine({
    parakeet: fixture.parakeet,
    google: fixture.google,
    settings: () => ({ engine, compare: true }),
    annotateClip,
  })!;
  const signal = new AbortController().signal;
  const prepared = await transcriber.prepare({ signal });
  const result = await prepared
    .transcribe("file:///recording.m4a", { signal, draft })
    .catch((error: unknown) => error);
  await vi.waitFor(() => expect(annotateClip).toHaveBeenCalledOnce());
  return { ...fixture, result, comparison: annotateClip.mock.calls[0]! };
}

describe("selectVoiceEngine comparison", () => {
  it("inserts Parakeet's text and runs Google on the saved clip, not the deleted recording", async () => {
    const run = await dictate("parakeet", async () => "google text");
    expect(run.result).toBe("parakeet text");
    expect(run.googleCalls).toEqual(["/clips/1.m4a"]);
    expect(run.comparison[0]).toBe("/clips/1.m4a");
    expect(run.comparison[1]).toMatchObject({
      chosenEngine: "parakeet",
      google: { transcript: "google text", locale: "en-US", mode: 1 },
    });
  });

  it("inserts Google's text and still saves Parakeet's clip of the same recording", async () => {
    const run = await dictate("google", async () => "google text");
    expect(run.result).toBe("google text");
    expect(run.parakeetCalls).toEqual(["file:///recording.m4a"]);
    expect(run.comparison[1]).toMatchObject({
      chosenEngine: "google",
      google: { transcript: "google text", mode: 1 },
    });
  });

  it("records a failing comparison engine without failing the dictation, and vice versa", async () => {
    const background = await dictate("parakeet", async () => {
      throw new Error("quota");
    });
    expect(background.result).toBe("parakeet text");
    expect(background.comparison[1]).toMatchObject({ google: { error: { message: "quota" } } });

    const chosen = await dictate("google", async () => {
      throw new Error("busy");
    });
    expect(chosen.result).toBeInstanceOf(Error);
    expect(chosen.comparison[1]).toMatchObject({ google: { error: { message: "busy" } } });
  });
});
