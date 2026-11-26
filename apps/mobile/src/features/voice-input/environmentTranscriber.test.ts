import { VOICE_RECORDING_LIMIT_SECONDS } from "@t3tools/client-runtime/voice-input";
import { expect, it, vi } from "vite-plus/test";
import { createEnvironmentTranscriber } from "./environmentTranscriber";
import { createLiveDictation } from "./liveDictation";

it("never uploads a recording whose grant changed while the phone decoded it", async () => {
  let grant = 1;
  const decoding = Promise.withResolvers<void>();
  const decoded = Promise.withResolvers<Uint8Array>();
  const upload = vi.fn(async () => "hello");
  const transcriber = createEnvironmentTranscriber({
    canSend: () => grant === 1,
    prepare: async () => ({ locale: "en", streaming: false }),
    decode: () => {
      decoding.resolve();
      return decoded.promise;
    },
    upload,
  });
  const options = { signal: new AbortController().signal };
  const recording = await transcriber.prepare(options);
  const transcription = recording.transcribe("file:///draft.m4a", options);
  await decoding.promise;
  grant++;
  decoded.resolve(new Uint8Array([0, 128, 0, 64]));
  await expect(transcription).rejects.toMatchObject({ code: "cancelled" });
  expect(upload).not.toHaveBeenCalled();
});

it("uploads normalized mono samples only after the recording is finished", async () => {
  const upload = vi.fn(async (bytes: Uint8Array) => {
    expect(Array.from(new Float32Array(Uint8Array.from(bytes).buffer))).toEqual([-1, 0.5]);
    return "hello";
  });
  const ready = Promise.withResolvers<{ locale: string; streaming: boolean }>();
  const transcriber = createEnvironmentTranscriber({
    canSend: () => true,
    prepare: () => ready.promise,
    decode: async () => new Uint8Array([255, 0, 128, 0, 64, 255]).subarray(1, 5),
    upload,
  });
  const options = { signal: new AbortController().signal };
  const recording = await transcriber.prepare(options);
  const starting = recording.start?.("file:///draft.m4a", options);
  expect(upload).not.toHaveBeenCalled();
  ready.resolve({ locale: "en", streaming: false });
  await starting;
  expect(recording.locale).toBe("en");
  expect(upload).not.toHaveBeenCalled();
  await expect(recording.transcribe("file:///draft.m4a", options)).resolves.toBe("hello");
});

it("trims at most one second of recorder padding and rejects longer recordings", async () => {
  const limit = 16_000 * VOICE_RECORDING_LIMIT_SECONDS;
  const padded = new Uint8Array((limit + 16_000 + 1) * 2);
  padded[(limit - 1) * 2 + 1] = 64;
  let bytes = padded.subarray(0, -2);
  const upload = vi.fn(async (body: Uint8Array) => {
    expect(body.byteLength).toBe(limit * 4);
    expect(
      new DataView(body.buffer, body.byteOffset, body.byteLength).getFloat32(
        body.byteLength - 4,
        true,
      ),
    ).toBe(0.5);
    return "hello";
  });
  const options = { signal: new AbortController().signal };
  const recording = await createEnvironmentTranscriber({
    canSend: () => true,
    prepare: async () => ({ locale: "en", streaming: false }),
    decode: async () => bytes,
    upload,
  }).prepare(options);
  await expect(recording.transcribe("file:///padded.m4a", options)).resolves.toBe("hello");
  bytes = padded;
  await expect(recording.transcribe("file:///too-long.m4a", options)).rejects.toThrow(
    "This recording couldn’t be read. Try recording again.",
  );
  expect(upload).toHaveBeenCalledOnce();
});

function streamingHarness(
  options: { streaming?: boolean; openFails?: boolean; busy?: () => Promise<boolean> } = {},
) {
  const dictation = createLiveDictation();
  const ready = Promise.withResolvers<{ locale: string; streaming: boolean }>();
  const final = Promise.withResolvers<string>();
  const fed: number[] = [];
  let failStream: () => void = () => {};
  const stream = {
    feed: vi.fn((pcm: Float32Array) => void fed.push(...pcm)),
    finish: vi.fn(() => final.promise),
    cancel: vi.fn(),
  };
  const open = vi.fn(async (_signal: AbortSignal, onError: () => void) => {
    if (options.openFails) throw new Error("no ticket");
    failStream = onError;
    return stream;
  });
  const upload = vi.fn(async (_pcm: Uint8Array, _signal: AbortSignal) => "uploaded");
  const decode = vi.fn(async () => new Uint8Array([0, 64]));
  const busy = vi.fn(options.busy ?? (async () => false));
  const transcriber = createEnvironmentTranscriber({
    canSend: () => true,
    prepare: () => ready.promise,
    decode,
    upload,
    stream: { openTap: dictation.open, open, busy },
  });
  const settle = () => ready.resolve({ locale: "en", streaming: options.streaming ?? true });
  return {
    dictation,
    transcriber,
    settle,
    final,
    fed,
    stream,
    open,
    upload,
    decode,
    busy,
    failStream: () => failStream(),
  };
}

const pcm = (...samples: number[]) => new Uint8Array(Int16Array.from(samples).buffer);

it("streams audio captured before and after the stream opens, then returns its transcript", async () => {
  const harness = streamingHarness();
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  harness.dictation.push(pcm(16384));
  const started = recording.start?.("file:///live.pcm", options);
  harness.settle();
  await started;
  harness.dictation.push(pcm(-32768));
  expect(harness.fed).toEqual([0.5, -1]);

  const finishing = recording.streaming!.finish(options);
  harness.dictation.push(pcm(8192));
  harness.dictation.end();
  harness.final.resolve("hello world");
  await expect(finishing).resolves.toBe("hello world");
  expect(harness.fed).toEqual([0.5, -1, 0.25]);
  expect(harness.upload).not.toHaveBeenCalled();
});

it("uploads after stop when the environment's model does not stream", async () => {
  const harness = streamingHarness({ streaming: false });
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  harness.settle();
  await recording.start?.("file:///live.pcm", options);
  harness.dictation.push(pcm(1));
  expect(harness.open).not.toHaveBeenCalled();
  expect(recording.streaming).toBeUndefined();
  await expect(recording.transcribe("file:///live.pcm", options)).resolves.toBe("uploaded");
});

it("uploads after stop when the stream cannot open", async () => {
  const harness = streamingHarness({ openFails: true });
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.settle();
  await recording.start?.("file:///live.pcm", options);
  expect(recording.streaming).toBeUndefined();
  await expect(recording.transcribe("file:///live.pcm", options)).resolves.toBe("uploaded");
});

it("uploads the recording when the stream drops while recording", async () => {
  const harness = streamingHarness();
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  harness.settle();
  await recording.start?.("file:///live.pcm", options);
  expect(recording.streaming).toBeDefined();
  harness.failStream();
  harness.dictation.push(pcm(1));
  expect(harness.fed).toEqual([]);
  expect(recording.streaming).toBeUndefined();
  await expect(recording.transcribe("file:///live.pcm", options)).resolves.toBe("uploaded");
  expect(harness.stream.cancel).toHaveBeenCalled();
});

it("uploads the recording when the stream fails to finish", async () => {
  const harness = streamingHarness();
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  harness.settle();
  await recording.start?.("file:///live.pcm", options);
  const finishing = recording.streaming!.finish(options);
  harness.dictation.end();
  harness.final.reject(new Error("The voice connection closed. Please record again."));
  await expect(finishing).resolves.toBe("uploaded");
  expect(harness.decode).toHaveBeenCalledWith("file:///live.pcm");
});

it("never opens a stream once a quick stop chose the upload", async () => {
  const harness = streamingHarness();
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  const transcription = recording.transcribe("file:///live.pcm", options);
  harness.settle();
  await expect(transcription).resolves.toBe("uploaded");
  expect(harness.open).not.toHaveBeenCalled();
});

it("uploads the fallback only once the environment has released the closed stream", async () => {
  vi.useFakeTimers();
  try {
    const states = [true, true, false];
    const harness = streamingHarness({ busy: async () => states.shift() ?? false });
    harness.upload.mockImplementation(async () => {
      expect(states).toEqual([]);
      return "uploaded";
    });
    const options = { signal: new AbortController().signal };
    const recording = await harness.transcriber.prepare(options);
    harness.dictation.start();
    harness.settle();
    await recording.start?.("file:///live.pcm", options);
    const finishing = recording.streaming!.finish(options);
    harness.dictation.end();
    harness.final.reject(new Error("The voice connection closed. Please record again."));
    await vi.runAllTimersAsync();
    await expect(finishing).resolves.toBe("uploaded");
    expect(harness.busy).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it("a failed fallback leaves the recording to a retry that uploads it again", async () => {
  const harness = streamingHarness();
  harness.upload.mockRejectedValueOnce(new Error("speech_busy"));
  const options = { signal: new AbortController().signal };
  const recording = await harness.transcriber.prepare(options);
  harness.dictation.start();
  harness.settle();
  await recording.start?.("file:///live.pcm", options);
  const finishing = recording.streaming!.finish(options);
  harness.dictation.end();
  harness.final.reject(new Error("The voice connection closed. Please record again."));
  await expect(finishing).rejects.toThrow("speech_busy");
  expect(recording.streaming).toBeUndefined();
  await expect(recording.transcribe("file:///live.pcm", options)).resolves.toBe("uploaded");
  expect(harness.stream.finish).toHaveBeenCalledOnce();
});
