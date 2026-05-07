import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { DEFAULT_PORT } from "../config.ts";
import { runRemoteSetup } from "../remoteSetup.ts";
import { portFlag } from "./config.ts";

const remoteSetupInstallDirFlag = Flag.string("install-dir").pipe(
  Flag.withDescription("Remote install/state directory."),
  Flag.withDefault("~/.t3code-server"),
);

const remoteSetupPackageFlag = Flag.string("package").pipe(
  Flag.withDescription("npm package spec to install on the remote host."),
  Flag.withDefault("t3@latest"),
);

const remoteSetupRemoteHostFlag = Flag.string("remote-host").pipe(
  Flag.withDescription("Host/interface the remote server should bind on."),
  Flag.withDefault("127.0.0.1"),
);

const remoteSetupPublicBaseUrlFlag = Flag.string("public-base-url").pipe(
  Flag.withDescription(
    "Base URL clients will use for pairing links. Defaults to http://127.0.0.1:<port> for SSH tunnel use.",
  ),
  Flag.optional,
);

const remoteSetupWorkspaceFlag = Flag.string("workspace").pipe(
  Flag.withDescription("Remote workspace path to register as a project."),
  Flag.optional,
);

const remoteSetupCommand = Command.make("setup", {
  target: Argument.string("ssh-target").pipe(
    Argument.withDescription("SSH target accepted by ssh, for example user@example.com."),
  ),
  installDir: remoteSetupInstallDirFlag,
  packageSpec: remoteSetupPackageFlag,
  remoteHost: remoteSetupRemoteHostFlag,
  port: portFlag.pipe(Flag.withDefault(DEFAULT_PORT)),
  publicBaseUrl: remoteSetupPublicBaseUrlFlag,
  workspaceRoot: remoteSetupWorkspaceFlag,
}).pipe(
  Command.withDescription("Install and start a T3 Code server on a remote host over SSH."),
  Command.withHandler((flags) => {
    const port =
      typeof flags.port === "number"
        ? flags.port
        : Option.getOrElse(flags.port, () => DEFAULT_PORT);
    return Effect.promise(() =>
      runRemoteSetup({
        sshTarget: flags.target,
        installDir: flags.installDir,
        packageSpec: flags.packageSpec,
        remoteHost: flags.remoteHost,
        port,
        publicBaseUrl: Option.getOrUndefined(flags.publicBaseUrl) ?? `http://127.0.0.1:${port}`,
        workspaceRoot: Option.getOrUndefined(flags.workspaceRoot),
      }),
    ).pipe(
      Effect.flatMap((result) =>
        Console.log(
          [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join("\n"),
        ),
      ),
    );
  }),
);

export const remoteCommand = Command.make("remote").pipe(
  Command.withDescription("Manage remote T3 Code servers."),
  Command.withSubcommands([remoteSetupCommand]),
);
