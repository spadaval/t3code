# Remote Access

Use this when you want to connect to a T3 Code server from another device such as a phone, tablet, or separate desktop app.

## Recommended Setup

Use a trusted private network that meshes your devices together, such as a tailnet.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## Enabling Network Access

There are two ways to expose your server for remote connections: from the desktop app or from the CLI.

### Option 1: Desktop App

If you are already running the desktop app and want to make it reachable from other devices:

1. Open **Settings** → **Connections**.
2. Under **Manage Local Backend**, toggle **Network access** on. This will restart the app and run the backend on all network interfaces.
3. The settings panel will show the address the server is reachable at (e.g. `http://192.168.x.y:3773`).
4. Use **Create Link** to generate a pairing link you can share with another device.

### Option 2: Headless Server (CLI)

Use this when you want to run the server without a GUI, for example on a remote machine over SSH.

Run the server with `t3 serve`.

```bash
npx t3 serve --host "$(tailscale ip -4)"
```

`t3 serve` starts the server without opening a browser and prints:

- a connection string
- a pairing token
- a pairing URL
- a QR code for the pairing URL

From there, connect from another device in either of these ways:

- scan the QR code on your phone
- in the desktop app, enter the full pairing URL
- in the desktop app, enter the host and token separately

Use `t3 serve --help` for the full flag reference. It supports the same general startup options as the normal server command, including an optional `cwd` argument.

> Note
> The GUIs do not currently support adding projects on remote environments.
> For now, use `t3 project ...` on the server machine instead.
> Full GUI support for remote project management is coming soon.

## Remote Host Setup

A remote T3 Code server needs:

- Node.js and npm on the remote host.
- The `t3` server package installed or installable with npm.
- The agent CLIs you plan to use, such as `codex`, installed and authenticated on that host.
- A persistent state directory for T3 Code auth, projects, logs, attachments, and worktrees.
- A process supervisor so the server survives SSH disconnects. Prefer a user `systemd` service when available.
- A reachable network path from your client to the server. The safest default is an SSH tunnel or private mesh network instead of a public listener.

Recommended secure shape:

```bash
ssh -L 3773:127.0.0.1:3773 user@remote.example.com
```

Then run the server on the remote host bound to loopback:

```bash
t3 serve --host 127.0.0.1 --port 3773 --base-dir ~/.t3code-server/data ~/repo
```

If you use a private network address such as a Tailnet IP instead, bind to that address and use that same address in the pairing URL.

## Automatic SSH Setup

You can bootstrap the remote host from a local machine that already has SSH access:

```bash
t3 remote setup user@remote.example.com --workspace ~/repo
```

By default this:

- connects with `ssh`
- installs `t3@latest` under `~/.t3code-server` when `t3` is not already on `PATH`
- starts `t3 serve --host 127.0.0.1 --port 3773`
- creates a user `systemd` service named `t3code.service` when possible
- falls back to `nohup` when user `systemd` is unavailable
- registers `--workspace` as a project
- prints a pairing link for `http://127.0.0.1:3773`, intended to be used with an SSH tunnel

For private-network exposure instead of SSH tunneling:

```bash
REMOTE_TAILNET_IP=100.x.y.z
t3 remote setup user@remote.example.com \
  --remote-host "$REMOTE_TAILNET_IP" \
  --public-base-url "http://$REMOTE_TAILNET_IP:3773" \
  --workspace ~/repo
```

Useful flags:

- `--install-dir ~/.t3code-server` controls remote install/state location.
- `--package t3@latest` controls the npm package spec installed remotely.
- `--remote-host 127.0.0.1` controls the remote bind host.
- `--port 3773` controls the remote HTTP/WebSocket port.
- `--public-base-url http://127.0.0.1:3773` controls the pairing link host.
- `--workspace ~/repo` registers a remote project.

## How Pairing Works

The remote device does not need a long-lived secret up front.

Instead:

1. `t3 serve` issues a one-time owner pairing token.
2. The remote device exchanges that token with the server.
3. The server creates an authenticated session for that device.

After pairing, future access is session-based. You do not need to keep reusing the original token unless you are pairing a new device.

## Managing Access Later

Use `t3 auth` to manage access after the initial pairing flow.

Typical uses:

- issue additional pairing credentials
- inspect active sessions
- revoke old pairing links or sessions

Use `t3 auth --help` and the nested subcommand help pages for the full reference.

## Security Notes

- Treat pairing URLs and pairing tokens like passwords.
- Prefer binding `--host` to a trusted private address, such as a Tailnet IP, instead of exposing the server broadly.
- Anyone with a valid pairing credential can create a session until that credential expires or is revoked.
- Use `t3 auth` to revoke credentials or sessions you no longer trust.
