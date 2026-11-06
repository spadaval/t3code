import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useFocusEffect } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { parakeetModule, useVoiceModelState } from "../../native/parakeetModel";
import { DEFAULT_VOICE_ENGINE, type VoiceEngine } from "../../native/voiceEngine";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { googleVoiceTranscriberAtom } from "../voice-input/VoiceInputProvider";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Picks Android's dictation engine and manages the Parakeet model. */
export function SettingsVoiceInputRouteScreen() {
  const insets = useSafeAreaInsets();
  const model = useVoiceModelState();
  const native = parakeetModule;
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const engine = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.voiceEngine ?? DEFAULT_VOICE_ENGINE)
    : null;
  const google = useAtomValue(googleVoiceTranscriberAtom);
  const engines: ReadonlyArray<{
    readonly id: VoiceEngine;
    readonly label: string;
    readonly description: string;
    readonly available: boolean;
  }> = [
    {
      id: "parakeet",
      label: "Parakeet",
      description: "NVIDIA's English model, downloaded below. Works offline on any phone.",
      available: native !== null,
    },
    {
      id: "google",
      label: "Google",
      description:
        google === "checking"
          ? "Checking this phone…"
          : google === null
            ? "Not available on this phone or language."
            : "Android's on-device speech service. Follows the device language.",
      available: google !== null && google !== "checking",
    },
  ];
  const [clips, setClips] = useState(() => native?.getClipState() ?? null);
  // Dictations happen elsewhere, so the count is reread on return to this page.
  useFocusEffect(useCallback(() => setClips(parakeetModule?.getClipState() ?? null), []));

  const confirmDeleteClips = () =>
    Alert.alert("Delete saved dictations?", "This removes their audio and transcripts.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void native?.deleteClips().then(() => setClips(native.getClipState())),
      },
    ]);

  const confirmDelete = () =>
    Alert.alert("Delete voice model?", "Dictation is unavailable until you download it again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void native?.deleteModel() },
    ]);

  return (
    <SettingsScreen title="Voice input">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Engine">
          {engines.map((option, index) => (
            <SettingsChoiceRow
              key={option.id}
              label={option.label}
              description={option.description}
              selected={engine === option.id}
              separated={index > 0}
              disabled={!preferencesReady || !option.available}
              onPress={() => savePreferences({ voiceEngine: option.id })}
            />
          ))}
        </SettingsSection>
        <Text className="px-2 text-sm text-foreground-muted">
          Both transcribe on this phone, so recordings never leave it. If the chosen engine is not
          available here, dictation uses the other.
        </Text>
        <SettingsSection title="Parakeet model">
          {!model || !native ? (
            <SettingsActionRow
              icon="mic"
              label="Not available on this device"
              disabled
              onPress={() => {}}
            />
          ) : model.status === "installed" ? (
            <SettingsActionRow
              icon="trash"
              label={`Delete voice model (${megabytes(model.totalBytes)})`}
              tone="danger"
              onPress={confirmDelete}
            />
          ) : model.status === "downloading" ? (
            <SettingsActionRow
              icon="arrow.down.circle"
              label={`Downloading ${Math.floor((model.receivedBytes / model.totalBytes) * 100)}% · Tap to pause`}
              loading
              onPress={() => native.cancelDownload()}
            />
          ) : (
            <SettingsActionRow
              icon="arrow.down.circle"
              label={
                model.receivedBytes > 0
                  ? `Resume download (${megabytes(model.totalBytes - model.receivedBytes)} left)`
                  : `Download voice model (${megabytes(model.totalBytes)})`
              }
              onPress={() => native.downloadModel()}
            />
          )}
        </SettingsSection>
        {model?.error ? (
          <Text className="px-2 text-sm text-danger-foreground">{model.error}</Text>
        ) : null}
        <Text className="px-2 text-sm text-foreground-muted">
          Parakeet understands English only. Use Wi-Fi for the download; it continues if you leave
          this screen.
        </Text>
        <SettingsSection title="Dictated messages">
          <SettingsSwitchRow
            icon="mic"
            label="Tell the agent a message was dictated"
            value={
              !AsyncResult.isSuccess(preferencesResult) ||
              preferencesResult.value.dictationNoteEnabled !== false
            }
            disabled={!preferencesReady}
            onValueChange={(enabled) => savePreferences({ dictationNoteEnabled: enabled })}
          />
        </SettingsSection>
        <Text className="px-2 text-sm text-foreground-muted">
          Dictation gets words wrong in ways typing doesn't, with words that sound right but aren't.
          This adds a short note to the end of messages you dictated, so the agent reads them with
          that in mind.
        </Text>
        {native ? (
          <>
            <SettingsSection title="Live dictation">
              <SettingsSwitchRow
                icon="text.bubble"
                label="Show text while speaking"
                value={
                  !AsyncResult.isSuccess(preferencesResult) ||
                  preferencesResult.value.liveDictationEnabled !== false
                }
                disabled={!preferencesReady}
                onValueChange={(enabled) => savePreferences({ liveDictationEnabled: enabled })}
              />
            </SettingsSection>
            <Text className="px-2 text-sm text-foreground-muted">
              With Parakeet, each phrase is transcribed when you pause, so finishing is almost
              instant. Turn this off to transcribe the whole recording once you stop, which uses
              less battery.
            </Text>
          </>
        ) : null}
        {clips && native ? (
          <>
            <SettingsSection title="Debugging">
              <SettingsSwitchRow
                icon="mic"
                label="Save dictations"
                value={clips.enabled}
                onValueChange={(enabled) => setClips(native.setClipCaptureEnabled(enabled))}
              />
              {clips.enabled && engines.every((option) => option.available) ? (
                <SettingsSwitchRow
                  icon="arrow.left.arrow.right"
                  label="Compare engines"
                  value={clips.compareEnabled}
                  onValueChange={(enabled) => setClips(native.setClipCompareEnabled(enabled))}
                />
              ) : null}
              {clips.count > 0 ? (
                <SettingsActionRow
                  icon="trash"
                  label={`Delete ${clips.count} saved (${megabytes(clips.bytes)})`}
                  tone="danger"
                  onPress={confirmDeleteClips}
                />
              ) : null}
            </SettingsSection>
            <Text className="px-2 text-sm text-foreground-muted">
              Keeps each recording and its transcript on this phone, in {clips.directory}. They stay
              here until you delete them or uninstall the app. Compare engines also transcribes each
              one with the engine you did not choose and saves that transcript beside it; your
              dictation still uses the chosen engine.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}
