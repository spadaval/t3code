import type { LiveDictation } from "../features/voice-input/liveDictation";
import { canCaptureLivePcm, createLiveVoiceRecorder } from "./voiceTranscription.android";

export const canStreamDictationPcm = canCaptureLivePcm;

/** The live recorder, emitting its PCM into `sink` while it records. */
export function createPcmVoiceRecorder(sink: Pick<LiveDictation, "start" | "push" | "end">) {
  const recorder = createLiveVoiceRecorder(true);
  if (!recorder) return null;
  const subscriptions = [
    recorder.addListener("pcm", (pcm) => sink.push(pcm)),
    recorder.addListener("pcmEnd", () => sink.end()),
  ];
  return {
    get uri() {
      return recorder.uri;
    },
    prepareToRecordAsync: () => recorder.prepareToRecordAsync(),
    record(options: { readonly forDuration: number }) {
      sink.start();
      recorder.record(options);
    },
    stop: () => recorder.stop(),
    getStatus: () => recorder.getStatus(),
    addListener: recorder.addListener.bind(recorder),
    getAvailableInputs: () => recorder.getAvailableInputs(),
    setInput: (uid: string) => recorder.setInput(uid),
    cancelInputSelection: () => recorder.cancelInputSelection?.(),
    release() {
      for (const subscription of subscriptions) subscription.remove();
      recorder.release();
    },
  };
}
