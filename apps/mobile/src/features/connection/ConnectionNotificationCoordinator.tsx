import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { AppState } from "react-native";

import {
  androidConnectionNotificationEnabled,
  setAndroidConnectionNotificationEnabled,
  showAndroidConnectionNotification,
  stopAndroidConnectionNotification,
  supportsAndroidConnectionNotification,
} from "../agent-awareness/androidNotifications";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadShells } from "../../state/threads";
import { workspaceConnections } from "../../state/workspace";
import {
  type ConnectionNotificationContent,
  connectionNotificationContent,
} from "./connectionNotification";

// Native owns the setting: the notification's Turn off action changes it too.
export const connectionNotificationEnabledAtom = Atom.make(
  androidConnectionNotificationEnabled(),
).pipe(Atom.keepAlive, Atom.withLabel("mobile:connection-notification-enabled"));

export function setConnectionNotificationEnabled(enabled: boolean): void {
  setAndroidConnectionNotificationEnabled(enabled);
  appAtomRegistry.set(connectionNotificationEnabledAtom, enabled);
}

const contentAtom = Atom.make((get) =>
  connectionNotificationContent(
    get(workspaceConnections.environmentsAtom),
    get(environmentThreadShells.threadShellsAtom),
  ),
).pipe(
  Atom.withEquality(
    (a: ConnectionNotificationContent | null, b: ConnectionNotificationContent | null) =>
      a?.title === b?.title && a?.text === b?.text,
  ),
  Atom.withLabel("mobile:connection-notification-content"),
);

export function ConnectionNotificationCoordinator() {
  const enabled = useAtomValue(connectionNotificationEnabledAtom);
  const content = useAtomValue(contentAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors connection and thread activity into the native foreground-service notification
  useEffect(() => {
    if (!supportsAndroidConnectionNotification()) return;
    if (!enabled || content === null) {
      stopAndroidConnectionNotification();
      return;
    }
    showAndroidConnectionNotification(content.title, content.text);
    // Android only lets the service start while the app is in the foreground.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const nativeEnabled = androidConnectionNotificationEnabled();
      appAtomRegistry.set(connectionNotificationEnabledAtom, nativeEnabled);
      if (nativeEnabled) showAndroidConnectionNotification(content.title, content.text);
    });
    return () => subscription.remove();
  }, [enabled, content]);
  return null;
}
