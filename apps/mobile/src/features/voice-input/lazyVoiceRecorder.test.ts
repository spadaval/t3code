import { describe, expect, it, vi } from "vite-plus/test";

import { VoiceInputController } from "@t3tools/client-runtime/voice-input";

import { createLazyVoiceRecorder, type VoiceRecordingInput } from "./lazyVoiceRecorder";

type Status = { readonly isFinished: boolean };
type State = { readonly isRecording: boolean };

function createNativeRecorder(uri: string) {
  const listeners = new Set<(status: Status) => void>();
  return {
    uri: null as string | null,
    prepared: uri,
    prepareToRecordAsync: vi.fn(async function (this: { uri: string | null; prepared: string }) {
      this.uri = this.prepared;
    }),
    record: vi.fn(),
    stop: vi.fn(async (): Promise<void> => undefined),
    getStatus: vi.fn((): State => ({ isRecording: true })),
    addListener: vi.fn((_event: "recordingStatusUpdate", listener: (status: Status) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
    getAvailableInputs: vi.fn((): ReadonlyArray<VoiceRecordingInput> => [
      { uid: "car", name: "CarPlay", type: "CarAudio" },
      { uid: "built-in", name: "iPhone Microphone", type: "MicrophoneBuiltIn" },
    ]),
    setInput: vi.fn((_uid: string) => undefined),
    release: vi.fn(),
    emit: (status: Status) => listeners.forEach((listener) => listener(status)),
  };
}

function createHarness(
  selectInput?: (inputs: ReadonlyArray<VoiceRecordingInput>) => VoiceRecordingInput | null,
) {
  const created: Array<ReturnType<typeof createNativeRecorder>> = [];
  const statuses: Status[] = [];
  const recorder = createLazyVoiceRecorder({
    create: () => {
      const native = createNativeRecorder(`file:///voice-${created.length}.m4a`);
      created.push(native);
      return native;
    },
    onStatus: (status) => statuses.push(status),
    ...(selectInput ? { selectInput } : {}),
  });
  return { recorder, created, statuses };
}

describe("createLazyVoiceRecorder", () => {
  it("keeps the system input when none is preferred or the preferred one disconnects", async () => {
    const unpreferred = createHarness(() => null);
    await unpreferred.recorder.prepareToRecordAsync();
    expect(unpreferred.created[0]!.setInput).not.toHaveBeenCalled();

    const disconnected = createHarness((inputs) => inputs[1] ?? null);
    await disconnected.recorder.prepareToRecordAsync();
    disconnected.created[0]!.setInput.mockImplementationOnce(() => {
      throw new Error("Preferred input not found");
    });
    await expect(disconnected.recorder.prepareToRecordAsync()).resolves.toBeUndefined();
  });

  it("gives up an Android Bluetooth route when recording stops or is abandoned", async () => {
    const earbuds = { uid: "bt", name: "Earbuds", type: "BluetoothSCO" };
    const builtIn = { uid: "mic", name: "Pixel", type: "MicrophoneBuiltIn" };
    const { recorder, created } = createHarness(() => earbuds);

    await recorder.prepareToRecordAsync();
    created[0]!.getAvailableInputs.mockReturnValue([earbuds, builtIn]);
    // Routed before prepare opens the input stream, then set as the recorder's preferred input.
    expect(created[0]!.setInput.mock.calls).toEqual([["bt"], ["bt"]]);
    await recorder.stop();
    expect(created[0]!.setInput.mock.calls).toEqual([["bt"], ["bt"], ["mic"]]);

    await recorder.prepareToRecordAsync();
    recorder.release();
    await vi.waitFor(() => expect(created[0]!.release).toHaveBeenCalled());
    expect(created[0]!.setInput.mock.calls.slice(3)).toEqual([["bt"], ["bt"], ["mic"]]);
  });

  it("holds recording until the Bluetooth link is up, and stops waiting if routing fails", async () => {
    const earbuds = { uid: "bt", name: "Earbuds", type: "BluetoothSCO" };
    let linkUp = () => {};
    const cancelBluetoothRouteWait = vi.fn();
    const native = createNativeRecorder("file:///voice.m4a");
    const recorder = createLazyVoiceRecorder({
      create: () => native,
      onStatus: () => {},
      selectInput: () => earbuds,
      waitForBluetoothRoute: () => new Promise<void>((resolve) => (linkUp = resolve)),
      cancelBluetoothRouteWait,
    });

    let prepared = false;
    const preparing = recorder.prepareToRecordAsync().then(() => (prepared = true));
    await vi.waitFor(() => expect(native.setInput).toHaveBeenCalledWith("bt"));
    expect(prepared).toBe(false);
    expect(native.prepareToRecordAsync).not.toHaveBeenCalled();
    linkUp();
    await preparing;
    expect(prepared).toBe(true);
    expect(native.setInput.mock.calls).toEqual([["bt"], ["bt"]]);
    expect(cancelBluetoothRouteWait).not.toHaveBeenCalled();

    const failing = createNativeRecorder("file:///voice-2.m4a");
    failing.setInput.mockImplementation(() => {
      throw new Error("Preferred input not found");
    });
    const failed = createLazyVoiceRecorder({
      create: () => failing,
      onStatus: () => {},
      selectInput: () => earbuds,
      waitForBluetoothRoute: () => new Promise<void>(() => {}),
      cancelBluetoothRouteWait,
    });
    await expect(failed.prepareToRecordAsync()).resolves.toBeUndefined();
    expect(cancelBluetoothRouteWait).toHaveBeenCalledOnce();
  });

  it("forwards status events until the recorder is released", async () => {
    const { recorder, created, statuses } = createHarness();
    await recorder.prepareToRecordAsync();
    const native = created[0]!;

    native.emit({ isFinished: true });
    recorder.release();
    native.emit({ isFinished: false });

    expect(statuses).toEqual([{ isFinished: true }]);
  });

  describe("with the voice input controller", () => {
    function createController(granted: boolean) {
      const harness = createHarness();
      const deleted: string[] = [];
      const controller = new VoiceInputController({
        recorder: harness.recorder,
        getTranscriber: () => ({
          prepare: async () => ({ locale: "en-US", transcribe: async () => "text" }),
        }),
        requestPermission: async () => ({ granted, canAskAgain: true }),
        configureRecording: async () => undefined,
        releaseRecording: async () => undefined,
        deleteRecording: (uri) => deleted.push(uri),
        readDraft: () => ({
          ownerKey: "thread",
          text: "",
          selection: { start: 0, end: 0 },
          revision: 0,
        }),
        commitDraft: () => undefined,
        onStateChange: () => undefined,
      });
      return { ...harness, controller, deleted };
    }

    it("does not create a native recorder when microphone permission is denied", async () => {
      const { controller, created } = createController(false);

      await controller.start();

      expect(controller.currentState.phase).toBe("error");
      expect(created).toHaveLength(0);
    });
  });
});
