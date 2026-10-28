import { requireOptionalNativeModule, type EventSubscription } from "expo";
import { useSyncExternalStore } from "react";

export type VoiceModelState = {
  readonly status: "missing" | "downloading" | "installed";
  readonly receivedBytes: number;
  readonly totalBytes: number;
  /** The last download's failure, cleared when another starts. */
  readonly error: string | null;
};

type VoiceTranscriptionModule = {
  getModelState(): VoiceModelState;
  downloadModel(): void;
  cancelDownload(): void;
  deleteModel(): Promise<void>;
  prepare(): Promise<void>;
  transcribe(uri: string): Promise<string>;
  cancelTranscription(): void;
  addListener(
    eventName: "onModelStateChange",
    listener: (state: VoiceModelState) => void,
  ): EventSubscription;
};

/** Android's on-device Parakeet model. Null on platforms without the native module. */
export const voiceTranscriptionModule =
  requireOptionalNativeModule<VoiceTranscriptionModule>("T3VoiceTranscription");

let modelState: VoiceModelState | null = null;

function subscribeToModelState(onChange: () => void): () => void {
  if (!voiceTranscriptionModule) return () => {};
  const subscription = voiceTranscriptionModule.addListener("onModelStateChange", (state) => {
    modelState = state;
    onChange();
  });
  // Catch up on changes made while nothing was listening.
  modelState = voiceTranscriptionModule.getModelState();
  return () => subscription.remove();
}

function readModelState(): VoiceModelState | null {
  if (!modelState && voiceTranscriptionModule)
    modelState = voiceTranscriptionModule.getModelState();
  return modelState;
}

/** The downloaded model's state, following downloads that outlive the screen that started them. */
export function useVoiceModelState(): VoiceModelState | null {
  return useSyncExternalStore(subscribeToModelState, readModelState);
}
