# T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, and OpenCode. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build and OpenCode. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

### Try it out (install-free)

The easiest way to test T3 Code is to run the server in your terminal (requires Node.js 22.16+, 23.11+, or 24.10+):

```bash
npx t3@latest
```

This will launch T3 Code's backend on your machine as well as the local web app to control your agents.

Tip: Use `npx t3@latest --help` for the full CLI reference.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Remote iOS development from Windows

This fork has been tested with T3 Code on Windows controlling a private macOS host that runs Xcode, an iOS Simulator, and the coding agent. The simulator is streamed into T3 Code's native Browser panel, so the Windows client can request a build and watch the resulting app without exposing the Mac to the public internet.

The working route is:

```text
T3 Code on Windows
  -> private Tailscale connection
  -> T3 server and serve-sim on macOS
  -> Xcode and iOS Simulator
```

### Requirements

- A Windows machine with T3 Code and Tailscale signed in
- A physical or hosted Mac with Xcode and Node.js installed
- Both machines connected to the same tailnet
- A bootable iOS Simulator runtime
- An authenticated coding provider on the Mac

### 1. Start the simulator stream on the Mac

List the available devices and choose a simulator UDID:

```bash
xcrun simctl list devices available
xcrun simctl boot <SIMULATOR_UDID>
xcrun simctl bootstatus <SIMULATOR_UDID> -b
open -a Simulator
```

Start [`serve-sim`](https://www.npmjs.com/package/serve-sim) in one terminal:

```bash
npx --yes serve-sim@0.1.45 <SIMULATOR_UDID>
```

The simulator stream should now be available at `http://127.0.0.1:3200` on the Mac.

### 2. Start the T3 server on the Mac

In another terminal:

```bash
npx --yes t3@latest serve --host 127.0.0.1 --no-browser
```

The default T3 server address is `http://127.0.0.1:3773`.

### 3. Publish both loopback ports inside the tailnet

T3's remote preview resolver can map environment ports through a private or Tailscale address. A public T3 Connect relay is suitable for agent traffic, but it intentionally does not forward arbitrary preview ports. Use Tailscale Serve for the simulator and T3 server instead:

```bash
tailscale serve --yes --bg --tcp 3200 tcp://127.0.0.1:3200
tailscale serve --yes --bg --tcp 3773 tcp://127.0.0.1:3773
tailscale serve status
```

On a hosted Mac without administrator access, `tailscaled` can run in userspace mode. Use a private state directory and socket, then pass that socket to each CLI command:

```bash
mkdir -p "$HOME/.tailscale"
tailscaled \
  --tun=userspace-networking \
  --state="$HOME/.tailscale/tailscaled.state" \
  --socket="$HOME/.tailscale/tailscaled.sock"

tailscale --socket="$HOME/.tailscale/tailscaled.sock" up
tailscale --socket="$HOME/.tailscale/tailscaled.sock" serve --yes --bg --tcp 3200 tcp://127.0.0.1:3200
tailscale --socket="$HOME/.tailscale/tailscaled.sock" serve --yes --bg --tcp 3773 tcp://127.0.0.1:3773
```

Keep the daemon running. Install Tailscale through its normal supported package whenever administrator access is available.

### 4. Pair the Windows client over the private address

Mint a short-lived pairing code on the Mac:

```bash
npx --yes t3@latest pair --ttl 30m --label "Windows client"
```

In T3 Code on Windows, open **Settings -> Connections -> Add environment**, then enter:

- Host: `http://<MAC_TAILSCALE_IP>:3773`
- Pairing code: the temporary code printed by `t3 pair`

If the same environment was previously connected through T3 Connect, the private pairing replaces its saved route. Close and reopen any existing Browser preview so the destination is resolved again.

Open the remote project, show the right panel, choose **Browser**, and select `localhost:3200` from the discovered servers. The panel should display the live iOS Simulator with its Home, Screenshot, Rotate, volume, power, accessibility, and developer-tool controls.

### 5. Build and launch an app

The complete flow was validated with a dependency-free SwiftUI app. A useful T3 prompt is:

> Create a minimal SwiftUI app in this project, build it for the already-booted iPhone simulator, install it, launch it, and fix any errors before finishing.

The underlying commands are standard Xcode and Simulator commands:

```bash
xcodebuild \
  -project <APP>.xcodeproj \
  -scheme <APP> \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'id=<SIMULATOR_UDID>' \
  -derivedDataPath build \
  build

xcrun simctl install <SIMULATOR_UDID> build/Build/Products/Debug-iphonesimulator/<APP>.app
xcrun simctl launch <SIMULATOR_UDID> <BUNDLE_IDENTIFIER>
```

Simulator builds do not require an Apple signing identity. Physical-device builds still require the normal Apple signing and provisioning setup.

### Windows display scaling

Launch T3 Code normally on a high-DPI display. The Chromium flag `--force-device-scale-factor=1` makes the interface extremely small at 200% Windows scaling. If renderer accessibility is required for UI automation, use the system's scale factor instead, for example:

```powershell
& "T3 Code (Alpha).exe" --force-device-scale-factor=2 --force-renderer-accessibility
```

### Security notes

- Keep ports `3200` and `3773` tailnet-only. Do not use Tailscale Funnel or a public unauthenticated tunnel for this workflow.
- Treat pairing codes as secrets and use short expiry times.
- Never commit RDP profiles, access tokens, authentication state, private IP addresses, usernames, emails, machine-specific logs, or simulator identifiers.
- Remove the hosted Mac from the tailnet when the rental or development session ends.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- Linux: [run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
