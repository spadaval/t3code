import { AudioModule } from "expo-audio";

export function createVoiceRecorder(
  options: ConstructorParameters<typeof AudioModule.AudioRecorder>[0],
) {
  return new AudioModule.AudioRecorder(options);
}

export const bluetoothRouteWait: {
  readonly wait: () => Promise<boolean>;
  readonly cancel: () => void;
} | null = null;
