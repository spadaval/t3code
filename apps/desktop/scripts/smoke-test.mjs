import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainJs = resolve(desktopDir, "dist-electron/main.cjs");

console.log("\nLaunching Electron smoke test...");

const childEnv = { ...process.env, VITE_DEV_SERVER_URL: "", ELECTRON_ENABLE_LOGGING: "1" };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(resolveElectronPath(), [mainJs], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: desktopDir,
  env: childEnv,
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, 8_000);

child.on("exit", () => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
    "icudtl.dat not found",
    "GPU process isn't usable",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
