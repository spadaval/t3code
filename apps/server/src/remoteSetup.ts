import { runProcess, type ProcessRunResult } from "./processRunner.ts";

export interface RemoteSetupOptions {
  readonly sshTarget: string;
  readonly installDir: string;
  readonly packageSpec: string;
  readonly remoteHost: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly workspaceRoot: string | undefined;
}

export interface RemoteSetupResult {
  readonly stdout: string;
  readonly stderr: string;
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;

export const buildRemoteSetupCommand = (options: RemoteSetupOptions): readonly string[] => [
  options.sshTarget,
  [
    "sh",
    "-s",
    "--",
    shellQuote(options.installDir),
    shellQuote(options.packageSpec),
    shellQuote(options.remoteHost),
    shellQuote(String(options.port)),
    shellQuote(options.publicBaseUrl),
    shellQuote(options.workspaceRoot ?? ""),
  ].join(" "),
];

export const REMOTE_SETUP_SCRIPT = `set -eu

INSTALL_DIR=$1
PACKAGE_SPEC=$2
REMOTE_HOST=$3
PORT=$4
PUBLIC_BASE_URL=$5
WORKSPACE_ROOT=$6

expand_home() {
  case "$1" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s\n' "\${HOME}/\${1#~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

INSTALL_DIR=$(expand_home "$INSTALL_DIR")
if [ -n "\${WORKSPACE_ROOT}" ]; then
  WORKSPACE_ROOT=$(expand_home "$WORKSPACE_ROOT")
fi
SERVER_WORKSPACE_ROOT=\${WORKSPACE_ROOT:-$HOME}

DATA_DIR="\${INSTALL_DIR}/data"
LOG_DIR="\${INSTALL_DIR}/logs"
RUN_DIR="\${INSTALL_DIR}/run"
BIN_DIR="\${INSTALL_DIR}/node_modules/.bin"
START_SCRIPT="\${INSTALL_DIR}/start-t3code-server.sh"
SERVICE_DIR="\${HOME}/.config/systemd/user"
SERVICE_FILE="\${SERVICE_DIR}/t3code.service"

mkdir -p "\${INSTALL_DIR}" "\${DATA_DIR}" "\${LOG_DIR}" "\${RUN_DIR}"

if command -v t3 >/dev/null 2>&1; then
  T3_BIN=$(command -v t3)
elif [ -x "\${BIN_DIR}/t3" ]; then
  T3_BIN="\${BIN_DIR}/t3"
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "Remote setup failed: npm is required to install \${PACKAGE_SPEC}." >&2
    exit 127
  fi
  npm install --prefix "\${INSTALL_DIR}" "\${PACKAGE_SPEC}"
  T3_BIN="\${BIN_DIR}/t3"
fi

if [ ! -x "\${T3_BIN}" ]; then
  echo "Remote setup failed: t3 executable was not found at \${T3_BIN}." >&2
  exit 127
fi

cat >"\${START_SCRIPT}" <<EOF
#!/bin/sh
set -eu
export PATH="\${BIN_DIR}:$PATH"
exec "\${T3_BIN}" serve --host "\${REMOTE_HOST}" --port "\${PORT}" --base-dir "\${DATA_DIR}" "\${SERVER_WORKSPACE_ROOT}"
EOF
chmod 700 "\${START_SCRIPT}"

if command -v systemctl >/dev/null 2>&1; then
  mkdir -p "\${SERVICE_DIR}"
  cat >"\${SERVICE_FILE}" <<EOF
[Unit]
Description=T3 Code remote server

[Service]
Type=simple
ExecStart=\${START_SCRIPT}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
  if systemctl --user daemon-reload >/dev/null 2>&1 \
    && systemctl --user enable --now t3code.service >/dev/null 2>&1; then
    echo "Started T3 Code with systemd user service t3code.service."
  else
    echo "systemd user service is unavailable; falling back to nohup." >&2
    nohup "\${START_SCRIPT}" >"\${LOG_DIR}/server.log" 2>&1 &
    echo $! >"\${RUN_DIR}/server.pid"
    echo "Started T3 Code with nohup (pid $(cat "\${RUN_DIR}/server.pid"))."
  fi
else
  nohup "\${START_SCRIPT}" >"\${LOG_DIR}/server.log" 2>&1 &
  echo $! >"\${RUN_DIR}/server.pid"
  echo "Started T3 Code with nohup (pid $(cat "\${RUN_DIR}/server.pid"))."
fi

if [ -n "\${WORKSPACE_ROOT}" ]; then
  "\${T3_BIN}" project add --base-dir "\${DATA_DIR}" "\${WORKSPACE_ROOT}" >/dev/null 2>&1 || true
fi

echo
echo "Pairing link:"
"\${T3_BIN}" auth pairing create --base-dir "\${DATA_DIR}" --base-url "\${PUBLIC_BASE_URL}"
echo
echo "Remote logs:"
echo "  \${LOG_DIR}/server.log"
if command -v systemctl >/dev/null 2>&1; then
  echo "  journalctl --user -u t3code.service -f"
fi
`;

export async function runRemoteSetup(
  options: RemoteSetupOptions,
  run: (
    command: string,
    args: readonly string[],
    processOptions: Parameters<typeof runProcess>[2],
  ) => Promise<ProcessRunResult> = runProcess,
): Promise<RemoteSetupResult> {
  const [sshTarget, remoteCommand] = buildRemoteSetupCommand(options);
  if (sshTarget === undefined || remoteCommand === undefined) {
    throw new Error("Remote setup failed: invalid SSH command.");
  }

  const result = await run("ssh", [sshTarget, remoteCommand], {
    stdin: REMOTE_SETUP_SCRIPT,
    timeoutMs: 120_000,
    outputMode: "truncate",
    maxBufferBytes: 256 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
