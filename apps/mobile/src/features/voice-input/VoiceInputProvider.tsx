import * as Haptics from "expo-haptics";
import { useAtomValue } from "@effect/atom-react";
import { RecordingPresets, type RecordingStatus } from "expo-audio";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { Atom, AsyncResult } from "effect/reactivity";
import { makeMutable } from "react-native-reanimated";

import {
  type MicrophoneEntry,
  microphoneOrder,
  preferredMicrophoneInput,
  rememberMicrophones,
} from "../../lib/microphonePriority";
import { getLocalVoiceTranscriber } from "../../native/voiceTranscription";
import { createVoiceRecorder } from "../../native/voiceRecorder";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import {
  voiceInputBlocksSubmission,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import { createLazyVoiceRecorder } from "./lazyVoiceRecorder";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { VoiceInputSession } from "./voiceInputSession";
import { createVoiceRecordingPermission } from "./voiceRecordingPermission";
import { makePermissionStatusAtom } from "../../lib/permissionStatusAtom";
import { parakeetModule } from "../../native/parakeetModel";
import { getParakeetTranscriber } from "../../native/parakeetTranscription";
import { DEFAULT_VOICE_ENGINE, selectVoiceEngine } from "../../native/voiceEngine";
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
        // Both engines hear 16 kHz mono; recording only that makes decoding ~3x cheaper.
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

export const deviceMicrophoneOrder = (saved?: ReadonlyArray<MicrophoneEntry>) =>
  microphoneOrder(saved, Platform.OS === "android" ? "android" : "ios");

/** Google's on-device engine. "checking" until the first probe settles; re-probed on foreground. */
export const googleVoiceTranscriberAtom = makePermissionStatusAtom<
  VoiceTranscriber | null | "checking"
>({
  label: "mobile:voice-input:google-transcriber",
  initial: "checking",
  read: () => getLocalVoiceTranscriber().catch(() => null),
}).pipe(Atom.keepAlive);

const parakeetTranscriber = getParakeetTranscriber();

export const localVoiceTranscriberAtom = Atom.make((get) => {
  const google = get(googleVoiceTranscriberAtom);
  if (google === "checking") return "checking" as const;
  const registry = get.registry;
  // Read when dictation starts so changing the engine does not re-render every composer.
  return selectVoiceEngine({
    parakeet: parakeetTranscriber,
    google,
    settings: () => {
      const preferences = registry.get(mobilePreferencesAtom);
      const clips = parakeetModule?.getClipState();
      return {
        engine: AsyncResult.isSuccess(preferences)
          ? (preferences.value.voiceEngine ?? DEFAULT_VOICE_ENGINE)
          : DEFAULT_VOICE_ENGINE,
        compare: clips?.enabled === true && clips.compareEnabled,
      };
    },
    annotateClip: async (clip, comparison) =>
      parakeetModule?.annotateClip(clip, "comparison", JSON.stringify(comparison)),
  });
}).pipe(Atom.keepAlive);

// Each foreground re-probe yields a new transcriber; composers re-render only when availability flips.
const localVoiceInputAvailableAtom = Atom.make((get) => {
  const transcriber = get(localVoiceTranscriberAtom);
  return transcriber !== null && transcriber !== "checking";
});

/**
 * The app has one microphone and one dictation at a time, so the session
 * lives for the registry's lifetime rather than any screen's.
 */
const voiceInputAtom = Atom.make((get) => {
  const registry = get.registry;
  // Mounted so the recorder can read and remember microphones synchronously.
  get.mount(mobilePreferencesAtom);
  get.mount(updateMobilePreferencesAtom);
  get.mount(localVoiceTranscriberAtom);
  const audioLevels = makeMutable<ReadonlyArray<number>>(
    Array<number>(VOICE_WAVEFORM_SAMPLE_COUNT).fill(0),
  );
  let keepAwakeSequence = 0;
  let audioToken: ReturnType<typeof acquireAudioSession> | null = null;
  const permission = createVoiceRecordingPermission(() => {
    void session.controller.appMovedToBackground();
  });
  const recorder = createLazyVoiceRecorder({
    create: () => createVoiceRecorder(VOICE_RECORDING_OPTIONS),
    onStatus: (status: RecordingStatus) => {
      session.controller.handleRecorderStatus({
        isFinished: status.isFinished,
        hasError: status.hasError || status.mediaServicesDidReset === true,
        error: status.error,
        url: status.url,
      });
    },
    waitForBluetoothRoute: async () => {
      if (await parakeetModule?.waitForBluetoothInput()) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
    },
    cancelBluetoothRouteWait: () => parakeetModule?.cancelBluetoothInputWait(),
    // Read when recording starts so preference changes do not re-render every composer.
    selectInput: (inputs) => {
      const preferences = registry.get(mobilePreferencesAtom);
      if (!AsyncResult.isSuccess(preferences)) return null;
      const known = deviceMicrophoneOrder(preferences.value.microphones);
      const order = rememberMicrophones(known, inputs);
      if (order !== known) {
        registry.set(updateMobilePreferencesAtom, {
          transform: (current) => ({
            microphones: rememberMicrophones(deviceMicrophoneOrder(current.microphones), inputs),
          }),
        });
      }
      return preferredMicrophoneInput(inputs, order);
    },
  });
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    getTranscriber: () => {
      const transcriber = registry.get(localVoiceTranscriberAtom);
      return transcriber === "checking" ? null : transcriber;
    },
    requestPermission: permission.requestPermission,
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
      parakeetModule?.cancelBluetoothInputWait();
      if (audioToken) await releaseAudioSession(audioToken);
      audioToken = null;
    },
    deleteRecording: (uri) => new File(uri).delete(),
    sampleRecording: () => {
      const status = recorder.getStatus();
      return status?.isRecording
        ? { durationMillis: status.durationMillis, metering: status.metering }
        : null;
    },
    publishAudioLevels: (levels) => audioLevels.set(levels),
    keepAwake: () => keepScreenAwake(`voice-input:${++keepAwakeSequence}`),
  });
  get.addFinalizer(() => {
    permission.dispose();
    session.dispose();
    recorder.release();
  });
  return { session, audioLevels };
}).pipe(Atom.keepAlive, Atom.withLabel("mobile:voice-input"));

export function useGlobalVoiceInput() {
  const { session, audioLevels } = useAtomValue(voiceInputAtom);
  const isTranscriberAvailable = useAtomValue(localVoiceInputAvailableAtom);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return {
    ...snapshot,
    isAvailable: isTranscriberAvailable || getNativeShowcaseScene() !== null,
    audioLevels,
    isBusy: voiceInputBlocksSubmission(snapshot.state),
    session,
    stop: () => session.controller.stop(),
    cancel: () => session.controller.cancel(),
  };
}
