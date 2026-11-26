import type { RecorderState, RecordingStatus } from "expo-audio";
import type { NativeVoiceRecorder } from "../features/voice-input/lazyVoiceRecorder";
import type { LiveDictation } from "../features/voice-input/liveDictation";

/** Whether this device can capture PCM while recording and stream it to an environment. */
export const canStreamDictationPcm = () => false;

export function createPcmVoiceRecorder(
  _sink: Pick<LiveDictation, "start" | "push" | "end">,
): NativeVoiceRecorder<RecordingStatus, RecorderState> | null {
  return null;
}
