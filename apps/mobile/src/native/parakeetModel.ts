import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { useSyncExternalStore } from "react";

export type VoiceModelState = {
  readonly status: "missing" | "downloading" | "installed";
  readonly receivedBytes: number;
  readonly totalBytes: number;
  /** The last download's failure, cleared when another starts. */
  readonly error: string | null;
};

export type VoiceClipState = {
  readonly enabled: boolean;
  readonly count: number;
  readonly bytes: number;
  readonly directory: string;
};

type ParakeetTranscriptionModule = {
  getModelState(): VoiceModelState;
  downloadModel(): void;
  cancelDownload(): void;
  deleteModel(): Promise<void>;
  prepare(): Promise<void>;
  transcribe(
    uri: string,
    draftOwnerKey: string,
    draftText: string,
    requestedAtMs: number,
  ): Promise<string>;
  cancelTranscription(): void;
  /** Resolves true after cueing the user that the Bluetooth mic is live, false if cancelled. */
  waitForBluetoothInput(): Promise<boolean>;
  cancelBluetoothInputWait(): void;
  getClipState(): VoiceClipState;
  setClipCaptureEnabled(enabled: boolean): VoiceClipState;
  deleteClips(): Promise<void>;
  addListener(
    eventName: "onModelStateChange",
    listener: (state: VoiceModelState) => void,
  ): EventSubscription;
};

/** Android's on-device Parakeet model. Null on platforms without the native module. */
export const parakeetModule =
  requireOptionalNativeModule<ParakeetTranscriptionModule>("T3ParakeetTranscription");

let modelState: VoiceModelState | null = null;

function subscribeToModelState(onChange: () => void): () => void {
  if (!parakeetModule) return () => {};
  const subscription = parakeetModule.addListener("onModelStateChange", (state) => {
    modelState = state;
    onChange();
  });
  // Catch up on changes made while nothing was listening.
  modelState = parakeetModule.getModelState();
  return () => subscription.remove();
}

function readModelState(): VoiceModelState | null {
  if (!modelState && parakeetModule) modelState = parakeetModule.getModelState();
  return modelState;
}

/** The downloaded model's state, following downloads that outlive the screen that started them. */
export function useVoiceModelState(): VoiceModelState | null {
  return useSyncExternalStore(subscribeToModelState, readModelState);
}
