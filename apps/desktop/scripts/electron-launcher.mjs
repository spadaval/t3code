import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);

  // Launch the upstream Electron runtime directly on macOS.
  //
  // A previous launcher copied Electron.app into a renamed local bundle and only
  // rewrote the main app plist. The helper bundles kept the generic
  // `com.github.Electron.helper` identifiers, which can crash very early during
  // startup on newer macOS/Electron combinations before our app code runs.
  return require("electron");
}
