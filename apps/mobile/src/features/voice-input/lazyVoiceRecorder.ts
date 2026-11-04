import type { VoiceRecorder } from "@t3tools/client-runtime/voice-input";

type Subscription = { remove(): void };

export interface VoiceRecordingInput {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

export interface NativeVoiceRecorder<TStatus, TRecorderState> {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(options: { readonly forDuration: number }): void;
  stop(): Promise<void>;
  getStatus(): TRecorderState;
  addListener(
    eventName: "recordingStatusUpdate",
    listener: (status: TStatus) => void,
  ): Subscription;
  getAvailableInputs(): ReadonlyArray<VoiceRecordingInput>;
  setInput(uid: string): void;
  release(): void;
}

export interface LazyVoiceRecorder<TRecorderState> extends VoiceRecorder {
  getStatus(): TRecorderState | null;
  release(): void;
}

/** Construct lazily: cold startup blocks JS for tens of milliseconds and most composers never record. */
export function createLazyVoiceRecorder<TStatus, TRecorderState>(input: {
  readonly create: () => NativeVoiceRecorder<TStatus, TRecorderState>;
  readonly onStatus: (status: TStatus) => void;
  readonly selectInput?: (inputs: ReadonlyArray<VoiceRecordingInput>) => VoiceRecordingInput | null;
  /** Settles once a requested Bluetooth link carries audio. Started before the route request. */
  readonly waitForBluetoothRoute?: () => Promise<unknown>;
  readonly cancelBluetoothRouteWait?: () => void;
}): LazyVoiceRecorder<TRecorderState> {
  let recorder: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let subscription: Subscription | null = null;
  let retired: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let retiredUri: string | null = null;
  let holdsBluetoothRoute = false;
  let pending: Promise<unknown> = Promise.resolve();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending = Promise.allSettled([pending, promise]).then(() => undefined);
    return promise;
  };

  // expo-audio only clears Android's communication device when another input is selected.
  // Left set, it keeps the headset in call mode and call quality after dictation.
  const releaseBluetoothRoute = (native: NativeVoiceRecorder<TStatus, TRecorderState>) => {
    if (!holdsBluetoothRoute) return;
    holdsBluetoothRoute = false;
    try {
      const builtIn = native
        .getAvailableInputs()
        .find((candidate) => candidate.type === "MicrophoneBuiltIn");
      if (builtIn) native.setInput(builtIn.uid);
    } catch {}
  };

  return {
    get uri() {
      if (recorder) return recorder.uri;
      return retired ? retired.uri : retiredUri;
    },
    prepareToRecordAsync() {
      if (!recorder) {
        recorder = input.create();
        subscription = recorder.addListener("recordingStatusUpdate", input.onStatus);
      }
      const prepared = recorder;
      const applyInput = (onlyBluetooth: boolean): Promise<unknown> | undefined => {
        if (!input.selectInput) return;
        let routeReady: Promise<unknown> | undefined;
        try {
          const selected = input.selectInput(prepared.getAvailableInputs());
          if (!selected) return;
          const bluetooth = selected.type === "BluetoothSCO";
          if (onlyBluetooth && !bluetooth) return;
          if (bluetooth && !holdsBluetoothRoute) routeReady = input.waitForBluetoothRoute?.();
          holdsBluetoothRoute = bluetooth;
          prepared.setInput(selected.uid);
        } catch {
          if (routeReady) input.cancelBluetoothRouteWait?.();
          return;
        }
        return routeReady;
      };
      return track(
        (async () => {
          // Android opens the input stream in prepare. Opened before the Bluetooth link
          // is up, it can record nothing but zeros for the whole take.
          await applyInput(true);
          await prepared.prepareToRecordAsync();
          await applyInput(false);
        })(),
      );
    },
    record(options) {
      if (!recorder) throw new Error("Voice recorder is not prepared.");
      recorder.record(options);
    },
    stop() {
      const stopping = recorder;
      if (!stopping) return Promise.resolve();
      return track(stopping.stop().finally(() => releaseBluetoothRoute(stopping)));
    },
    getStatus() {
      return recorder ? recorder.getStatus() : null;
    },
    release() {
      const released = recorder;
      if (!released) return;
      recorder = null;
      subscription?.remove();
      subscription = null;
      retired = released;
      void pending.then(() => {
        if (retired === released) {
          retiredUri = released.uri;
          retired = null;
        }
        releaseBluetoothRoute(released);
        released.release();
      });
    },
  };
}
