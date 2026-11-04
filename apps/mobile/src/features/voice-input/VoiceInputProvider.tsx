import * as Haptics from "expo-haptics";
import { useAtomValue } from "@effect/atom-react";
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  type RecordingStatus,
} from "expo-audio";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { Atom, AsyncResult } from "effect/reactivity";
import { makeMutable } from "react-native-reanimated";

import {
  microphoneOrder,
  preferredMicrophoneInput,
  rememberMicrophones,
} from "../../lib/microphonePriority";
import { getLocalVoiceTranscriber } from "../../native/voiceTranscription";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import { voiceInputBlocksSubmission } from "@t3tools/client-runtime/voice-input";
import { createLazyVoiceRecorder } from "./lazyVoiceRecorder";
import { createLiveVoiceRecorder, getLiveVoiceTranscriber } from "../../native/liveDictation";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { VoiceInputSession } from "./voiceInputSession";
import { voiceTranscriptionModule } from "../../native/voiceModel";
import {
  acquireAudioSession,
  activateAudioSession,
  releaseAudioSession,
} from "../../lib/audioSession";

// The native constructor expects platform-flattened options, as built by useAudioRecorder.
const { ios: IOS_RECORDING_OPTIONS, android: ANDROID_RECORDING_OPTIONS } =
  RecordingPresets.HIGH_QUALITY;
const VOICE_RECORDING_OPTIONS = {
  extension: RecordingPresets.HIGH_QUALITY.extension,
  sampleRate: RecordingPresets.HIGH_QUALITY.sampleRate,
  numberOfChannels: RecordingPresets.HIGH_QUALITY.numberOfChannels,
  bitRate: RecordingPresets.HIGH_QUALITY.bitRate,
  isMeteringEnabled: true,
  ...(Platform.OS === "ios"
    ? IOS_RECORDING_OPTIONS
    : {
        ...ANDROID_RECORDING_OPTIONS,
        // The default MIC source skips the noise suppression Android tunes for speech-to-text.
        audioSource: "voice_recognition" as const,
        // Parakeet hears 16 kHz mono; recording only that makes the decode before transcription ~3x cheaper.
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 32000,
      }),
};

function keepScreenAwake(tag: string): () => void {
  const activation = activateKeepAwakeAsync(tag);
  void activation.catch(() => {});
  // Release after activation settles, even if the recording ends immediately.
  return () => void activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
}

/**
 * The app has one microphone and one dictation at a time, so the session
 * lives for the registry's lifetime rather than any screen's.
 */
const voiceInputAtom = Atom.make((get) => {
  const registry = get.registry;
  // Mounted so the recorder can read and remember microphones synchronously.
  get.mount(mobilePreferencesAtom);
  get.mount(updateMobilePreferencesAtom);
  const audioLevels = makeMutable<ReadonlyArray<number>>(
    Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0),
  );
  let keepAwakeSequence = 0;
  let audioToken: ReturnType<typeof acquireAudioSession> | null = null;
  const fileRecorder = createLazyVoiceRecorder({
    create: () => new AudioModule.AudioRecorder(VOICE_RECORDING_OPTIONS),
    onStatus: (status: RecordingStatus) => {
      session.controller.handleRecorderStatus({
        isFinished: status.isFinished,
        hasError: status.hasError || status.mediaServicesDidReset === true,
        error: status.error,
        url: status.url,
      });
    },
    waitForBluetoothRoute: async () => {
      if (await voiceTranscriptionModule?.waitForBluetoothInput()) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
    },
    cancelBluetoothRouteWait: () => voiceTranscriptionModule?.cancelBluetoothInputWait(),
    // Read when recording starts so preference changes do not re-render every composer.
    selectInput: (inputs) => {
      const preferences = registry.get(mobilePreferencesAtom);
      if (!AsyncResult.isSuccess(preferences)) return null;
      const known = microphoneOrder(preferences.value.microphones);
      const order = rememberMicrophones(known, inputs);
      if (order !== known) {
        registry.set(updateMobilePreferencesAtom, {
          transform: (current) => ({
            microphones: rememberMicrophones(microphoneOrder(current.microphones), inputs),
          }),
        });
      }
      return preferredMicrophoneInput(inputs, order);
    },
  });
  const native = voiceTranscriptionModule;
  const liveRecorder = native ? createLiveVoiceRecorder(native) : null;
  // Chosen when a dictation starts; the controller asks for the transcriber before the recorder.
  let live = false;
  const recorder = {
    get uri() {
      return live && liveRecorder ? liveRecorder.uri : fileRecorder.uri;
    },
    prepareToRecordAsync: () =>
      live && liveRecorder
        ? liveRecorder.prepareToRecordAsync()
        : fileRecorder.prepareToRecordAsync(),
    record: (options: { readonly forDuration: number }) =>
      live && liveRecorder ? liveRecorder.record(options) : fileRecorder.record(options),
    stop: () => (live && liveRecorder ? liveRecorder.stop() : fileRecorder.stop()),
  };
  const liveSubscription = native?.addListener("onLiveTranscript", (transcript) =>
    session.setLiveTranscript(transcript),
  );
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    getTranscriber: () => {
      const preferences = registry.get(mobilePreferencesAtom);
      live =
        native !== null &&
        (!AsyncResult.isSuccess(preferences) || preferences.value.liveDictationEnabled !== false);
      return live && native ? getLiveVoiceTranscriber(native) : getLocalVoiceTranscriber();
    },
    requestPermission: async () => {
      const permission = await requestRecordingPermissionsAsync();
      return { granted: permission.granted, canAskAgain: permission.canAskAgain };
    },
    configureRecording: async () => {
      const token = acquireAudioSession("recording");
      audioToken = token;
      try {
        await activateAudioSession(token);
      } catch (error) {
        await releaseAudioSession(token).catch(() => {});
        throw error;
      }
    },
    releaseRecording: async () => {
      voiceTranscriptionModule?.cancelBluetoothInputWait();
      if (audioToken) await releaseAudioSession(audioToken);
      audioToken = null;
    },
    deleteRecording: (uri) => new File(uri).delete(),
    sampleRecording: () => {
      if (live && liveRecorder) {
        const status = liveRecorder.getStatus();
        if (status?.error) void session.controller.interruptRecording(status.error);
        return status?.isRecording
          ? { durationMillis: status.durationMillis, metering: status.metering }
          : null;
      }
      const status = fileRecorder.getStatus();
      return status?.isRecording
        ? { durationMillis: status.durationMillis, metering: status.metering }
        : null;
    },
    publishAudioLevels: (levels) => audioLevels.set(levels),
    keepAwake: () => keepScreenAwake(`voice-input:${++keepAwakeSequence}`),
  });
  // iOS reports `inactive` while its permission dialog is open. Only the real
  // background state cancels preparation; recorder status handles calls and
  // route interruptions during capture.
  const appStateSubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState === "background") void session.controller.appMovedToBackground();
  });
  get.addFinalizer(() => {
    appStateSubscription.remove();
    liveSubscription?.remove();
    session.dispose();
    fileRecorder.release();
  });
  return { session, audioLevels };
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input"));

export function useGlobalVoiceInput() {
  const { session, audioLevels } = useAtomValue(voiceInputAtom);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    isAvailable: getLocalVoiceTranscriber() !== null || getNativeShowcaseScene() !== null,
    audioLevels,
    isBusy: voiceInputBlocksSubmission(snapshot.state),
    session,
    stop: () => session.controller.stop(),
    cancel: () => session.controller.cancel(),
  };
}
