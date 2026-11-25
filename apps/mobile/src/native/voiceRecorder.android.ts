import { AudioModule } from "expo-audio";
import {
  cancelBluetoothInputWait,
  createLiveVoiceRecorder,
  waitForBluetoothInput,
} from "./voiceTranscription.android";

export function createVoiceRecorder(
  options: ConstructorParameters<typeof AudioModule.AudioRecorder>[0],
) {
  return createLiveVoiceRecorder() ?? new AudioModule.AudioRecorder(options);
}

export const bluetoothRouteWait = {
  wait: waitForBluetoothInput,
  cancel: cancelBluetoothInputWait,
};
