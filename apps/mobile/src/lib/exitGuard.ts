import { BackHandler, Platform, ToastAndroid } from "react-native";

export const EXIT_CONFIRM_WINDOW_MS = 2000;

/** Takes a Back that would leave the app unless it follows another within the window. */
export function createExitGuard(now: () => number, warn: () => void) {
  let armedAt: number | undefined;
  return () => {
    const at = now();
    if (armedAt !== undefined && at - armedAt < EXIT_CONFIRM_WINDOW_MS) {
      armedAt = undefined;
      return false;
    }
    armedAt = at;
    warn();
    return true;
  };
}

/**
 * BackHandler calls the newest listener first, so one added at startup runs only when no
 * screen, sheet or navigator took Back, which is exactly when Android would leave the app.
 */
export function installAndroidExitGuard() {
  if (Platform.OS !== "android") return;
  BackHandler.addEventListener(
    "hardwareBackPress",
    createExitGuard(Date.now, () =>
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT),
    ),
  );
}
