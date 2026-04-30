import { describe, expect, it } from "vitest";

import { buildRemoteSetupCommand, REMOTE_SETUP_SCRIPT, runRemoteSetup } from "./remoteSetup.ts";

describe("buildRemoteSetupCommand", () => {
  it("quotes remote shell arguments", () => {
    const command = buildRemoteSetupCommand({
      sshTarget: "dev@example.com",
      installDir: "~/.t3 code",
      packageSpec: "t3@latest",
      remoteHost: "127.0.0.1",
      port: 3773,
      publicBaseUrl: "http://127.0.0.1:3773",
      workspaceRoot: "/srv/project's repo",
    });

    expect(command[0]).toBe("dev@example.com");
    expect(command[1]).toContain("'~/.t3 code'");
    expect(command[1]).toContain("'/srv/project'\"'\"'s repo'");
  });
});

describe("REMOTE_SETUP_SCRIPT", () => {
  it("starts a headless server and issues a pairing link", () => {
    expect(REMOTE_SETUP_SCRIPT).toContain("serve --host");
    expect(REMOTE_SETUP_SCRIPT).toContain("auth pairing create");
    expect(REMOTE_SETUP_SCRIPT).toContain("systemctl --user enable --now t3code.service");
    expect(REMOTE_SETUP_SCRIPT).toContain("nohup");
  });
});

describe("runRemoteSetup", () => {
  it("runs ssh with the setup script on stdin", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      stdin: string | undefined;
    }> = [];

    const result = await runRemoteSetup(
      {
        sshTarget: "dev@example.com",
        installDir: "~/.t3code-server",
        packageSpec: "t3@latest",
        remoteHost: "127.0.0.1",
        port: 3773,
        publicBaseUrl: "http://127.0.0.1:3773",
        workspaceRoot: undefined,
      },
      async (command, args, options) => {
        calls.push({ command, args, stdin: options?.stdin });
        return {
          stdout: "Pairing link:\nhttp://127.0.0.1:3773/pair#token=secret\n",
          stderr: "",
          code: 0,
          signal: null,
          timedOut: false,
        };
      },
    );

    expect(result.stdout).toContain("/pair#token=");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("ssh");
    expect(calls[0]?.args[0]).toBe("dev@example.com");
    expect(calls[0]?.stdin).toBe(REMOTE_SETUP_SCRIPT);
  });
});
