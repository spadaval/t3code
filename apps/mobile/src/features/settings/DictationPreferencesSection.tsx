/* oxlint-disable t3code/no-untranslated-copy -- Fork-only English settings. */
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

export function DictationPreferencesSection() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const ready = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  return (
    <SettingsSection title="Dictated messages">
      <SettingsSwitchRow
        icon="mic"
        label="Tell the agent a message was dictated"
        subtitle="Adds a short note to messages you dictated, so the agent allows for words that sound right but aren't."
        disabled={!ready}
        value={preferences?.dictationNoteEnabled !== false}
        onValueChange={(enabled) => void savePreferences({ dictationNoteEnabled: enabled })}
      />
    </SettingsSection>
  );
}
