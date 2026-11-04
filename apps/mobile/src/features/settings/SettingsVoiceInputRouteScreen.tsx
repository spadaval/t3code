import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useVoiceModelState, voiceTranscriptionModule } from "../../native/voiceModel";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Downloads and removes Android's on-device dictation model. */
export function SettingsVoiceInputRouteScreen() {
  const insets = useSafeAreaInsets();
  const model = useVoiceModelState();
  const native = voiceTranscriptionModule;
  const [clips, setClips] = useState(() => native?.getClipState() ?? null);
  // Dictations happen elsewhere, so the count is reread on return to this page.
  useFocusEffect(useCallback(() => setClips(voiceTranscriptionModule?.getClipState() ?? null), []));

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
        <SettingsSection title="Voice model">
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
          Dictation transcribes on this device with NVIDIA Parakeet, so recordings never leave your
          phone. It understands English only. Use Wi-Fi for the download; it continues if you leave
          this screen.
        </Text>
        {clips && native ? (
          <>
            <SettingsSection title="Debugging">
              <SettingsSwitchRow
                icon="mic"
                label="Save dictations"
                value={clips.enabled}
                onValueChange={(enabled) => setClips(native.setClipCaptureEnabled(enabled))}
              />
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
              here until you delete them or uninstall the app.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}
