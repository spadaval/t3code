import * as Haptics from "expo-haptics";
import { useAtomValue } from "@effect/atom-react";
import { AudioModule, RecordingPresets, type RecordingStatus } from "expo-audio";
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
import {
  addLiveTranscriptListener,
  getLocalVoiceTranscriber,
} from "../../native/voiceTranscription";
import { createVoiceRecorder } from "../../native/voiceRecorder";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { getNativeShowcaseScene } from "../showcase/nativeShowcaseScene";
import {
  voiceInputBlocksSubmission,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import { createLazyVoiceRecorder, type VoiceRecordingInput } from "./lazyVoiceRecorder";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";
import { VoiceInputSession } from "./voiceInputSession";
import { createVoiceRecordingPermission } from "./voiceRecordingPermission";
import { makePermissionStatusAtom } from "../../lib/permissionStatusAtom";
import { parakeetModule } from "../../native/parakeetModel";
import {
  getParakeetTranscriber,
  type ParakeetTranscriber,
} from "../../native/parakeetTranscription";
import {
  createLiveDictationRecorder,
  getLiveDictationTranscriber,
} from "../../native/liveDictation";
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

const fileParakeetTranscriber = getParakeetTranscriber();
const liveParakeetTranscriber = getLiveDictationTranscriber();

export const localVoiceTranscriberAtom = Atom.make((get) => {
  const google = get(googleVoiceTranscriberAtom);
  if (google === "checking") return "checking" as const;
  const registry = get.registry;
  const settings = () => {
    const preferences = registry.get(mobilePreferencesAtom);
    const clips = parakeetModule?.getClipState();
    return {
      engine: AsyncResult.isSuccess(preferences)
        ? (preferences.value.voiceEngine ?? DEFAULT_VOICE_ENGINE)
        : DEFAULT_VOICE_ENGINE,
      compare: clips?.enabled === true && clips.compareEnabled,
      live: !AsyncResult.isSuccess(preferences) || preferences.value.liveDictationEnabled !== false,
    };
  };
  // Live dictation records itself, so it only serves dictations Parakeet was chosen for; a
  // comparison run behind Google's transcribes Google's recording instead.
  const parakeet: ParakeetTranscriber | null = fileParakeetTranscriber && {
    prepare: (options) => {
      const { engine, live } = settings();
      const useLive = live && liveParakeetTranscriber && (engine === "parakeet" || !google);
      return (useLive ? liveParakeetTranscriber : fileParakeetTranscriber).prepare(options);
    },
  };
  // Read when dictation starts so changing the engine does not re-render every composer.
  return selectVoiceEngine({
    parakeet,
    google,
    settings,
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
  const recorderOptions = {
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
    selectInput: (inputs: ReadonlyArray<VoiceRecordingInput>) => {
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
  };
  // Upstream's Android recorder streams into Google's recognizer and fails when nothing reads
  // it, so it only records for a transcription that starts during recording.
  const streamingRecorder = createLazyVoiceRecorder({
    ...recorderOptions,
    create: () => createVoiceRecorder(VOICE_RECORDING_OPTIONS),
  });
  const fileRecorder = createLazyVoiceRecorder({
    ...recorderOptions,
    create: () => new AudioModule.AudioRecorder(VOICE_RECORDING_OPTIONS),
  });
  const liveRecorder = parakeetModule ? createLiveDictationRecorder(parakeetModule) : null;
  const liveSubscription = parakeetModule?.addListener("onLiveTranscript", (transcript) =>
    session.setLiveTranscript(transcript),
  );
  const googleLiveSubscription = addLiveTranscriptListener((transcript) => {
    // Google recognizes during recording either way; the setting only hides its words.
    const preferences = registry.get(mobilePreferencesAtom);
    if (AsyncResult.isSuccess(preferences) && preferences.value.liveDictationEnabled === false)
      return;
    session.setLiveTranscript(transcript);
  });
  // The controller prepares the transcription before the recorder, so its kind picks the recorder.
  let recorderKind: "live" | "streaming" | "file" = "file";
  const activeRecorder = () =>
    recorderKind === "live" && liveRecorder
      ? liveRecorder
      : recorderKind === "streaming"
        ? streamingRecorder
        : fileRecorder;
  const recorder = {
    get uri() {
      return activeRecorder().uri;
    },
    prepareToRecordAsync: (signal?: AbortSignal) => activeRecorder().prepareToRecordAsync(signal),
    record: (options: { readonly forDuration: number }) => activeRecorder().record(options),
    stop: () => activeRecorder().stop(),
  };
  const session: VoiceInputSession = new VoiceInputSession({
    recorder,
    getTranscriber: () => {
      const transcriber = registry.get(localVoiceTranscriberAtom);
      if (transcriber === "checking" || transcriber === null) return null;
      return {
        prepare: async (options) => {
          const prepared = await transcriber.prepare(options);
          recorderKind =
            "liveDictation" in prepared ? "live" : prepared.start ? "streaming" : "file";
          return prepared;
        },
      };
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
      if (recorderKind === "live" && liveRecorder) {
        const status = liveRecorder.getStatus();
        if (status?.error) void session.controller.interruptRecording(status.error);
        return status?.isRecording
          ? { durationMillis: status.durationMillis, metering: status.metering }
          : null;
      }
      const status = (recorderKind === "streaming" ? streamingRecorder : fileRecorder).getStatus();
      return status?.isRecording
        ? { durationMillis: status.durationMillis, metering: status.metering }
        : null;
    },
    publishAudioLevels: (levels) => audioLevels.set(levels),
    keepAwake: () => keepScreenAwake(`voice-input:${++keepAwakeSequence}`),
  });
  get.addFinalizer(() => {
    permission.dispose();
    liveSubscription?.remove();
    googleLiveSubscription?.remove();
    session.dispose();
    streamingRecorder.release();
    fileRecorder.release();
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
