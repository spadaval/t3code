import { expect, it, vi } from "vite-plus/test";
import { VOICE_RECORDING_LIMIT_SECONDS } from "@t3tools/client-runtime/voice-input";
import { createLiveDictation } from "./liveDictation";

const pcm = (...samples: number[]) => new Uint8Array(Int16Array.from(samples).buffer);

it("ignores audio outside a recording and ends only the recording in progress", async () => {
  const dictation = createLiveDictation();
  const tap = dictation.open();
  const feed = vi.fn();
  dictation.push(pcm(1));
  dictation.end();
  expect(tap.attach(feed)).toBe(true);
  expect(feed).not.toHaveBeenCalled();

  dictation.start();
  const ended = vi.fn();
  void tap.ended().then(ended);
  dictation.push(pcm(16384));
  expect(feed).toHaveBeenCalledWith(Float32Array.of(0.5));
  dictation.end();
  await Promise.resolve();
  expect(ended).toHaveBeenCalled();
});

it("drops buffered audio past a minute so a slow environment falls back to the upload", () => {
  const dictation = createLiveDictation();
  const tap = dictation.open();
  dictation.start();
  const second = new Uint8Array(32_000);
  for (let i = 0; i < 61; i++) dictation.push(second);
  expect(tap.attach(vi.fn())).toBe(false);
});

it("a new dictation starts with no audio from the previous one", () => {
  const dictation = createLiveDictation();
  dictation.open();
  dictation.start();
  dictation.push(pcm(1));
  const tap = dictation.open();
  const feed = vi.fn();
  tap.attach(feed);
  expect(feed).not.toHaveBeenCalled();
});

it("sends live text to every listener until it unsubscribes", () => {
  const dictation = createLiveDictation();
  const listener = vi.fn();
  const stop = dictation.onText(listener);
  dictation.publishText({ committed: "Hello", tentative: "wor" });
  stop();
  dictation.publishText({ committed: "Hello world", tentative: "" });
  expect(listener).toHaveBeenCalledOnce();
});

it("streams no audio past the recording limit, even what the recorder drains after it", () => {
  const dictation = createLiveDictation();
  const tap = dictation.open();
  let fed = 0;
  tap.attach((pcm) => void (fed += pcm.length));
  dictation.start();
  const second = new Uint8Array(32_000);
  for (let i = 0; i < VOICE_RECORDING_LIMIT_SECONDS; i++) dictation.push(second);
  dictation.push(new Uint8Array(6_400));
  expect(fed).toBe(16_000 * VOICE_RECORDING_LIMIT_SECONDS);

  dictation.end();
  dictation.start();
  dictation.push(pcm(1, 2));
  expect(fed).toBe(16_000 * VOICE_RECORDING_LIMIT_SECONDS + 2);
});
