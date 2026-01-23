<p align="center">
  <a href="https://nikcli.store">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Nikcli logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://nikcli.store/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/nikcli-ai"><img alt="npm" src="https://img.shields.io/npm/v/nikcli-ai?style=flat-square" /></a>
  <a href="https://github.com/nikomatt69/nikcli/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/nikomatt69/nikcli/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![Nikcli Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://nikcli.store)

---

### Installation

```bash
# YOLO
curl -fsSL https://nikcli.store/install | bash

# Package managers
npm i -g nikcli-ai@latest        # or bun/pnpm/yarn
scoop install nikcli             # Windows
choco install nikcli             # Windows
brew install nikomatt69/tap/nikcli # macOS and Linux (recommended, always up to date)
brew install nikcli              # macOS and Linux (official brew formula, updated less)
paru -S nikcli-bin               # Arch Linux
mise use -g nikcli               # Any OS
nix run nixpkgs#nikcli           # or github:nikomatt69/nikcli for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

Nikcli is also available as a desktop application. Download directly from the [releases page](https://github.com/nikomatt69/nikcli/releases) or [nikcli.store/download](https://nikcli.store/download).

| Platform              | Download                            |
| --------------------- | ----------------------------------- |
| macOS (Apple Silicon) | `nikcli-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `nikcli-desktop-darwin-x64.dmg`     |
| Windows               | `nikcli-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage         |

```bash
# macOS (Homebrew)
brew install --cask nikcli-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/nikcli-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$NIKCLI_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if exists or can be created)
4. `$HOME/.nikcli/bin` - Default fallback

```bash
# Examples
NIKCLI_INSTALL_DIR=/usr/local/bin curl -fsSL https://nikcli.store/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://nikcli.store/install | bash
```

### Agents

Nikcli includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also, included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://nikcli.store/docs/agents).

### Documentation

For more info on how to configure Nikcli [**head over to our docs**](https://nikcli.store/docs).

### Contributing

If you're interested in contributing to Nikcli, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Nikcli

If you are working on a project that's related to Nikcli and is using "nikcli" as a part of its name; for example, "nikcli-dashboard" or "nikcli-mobile", please add a note to your README to clarify that it is not built by the Nikcli team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [Nikcli Zen](https://nikcli.store/zen); Nikcli can be used with Claude, OpenAI, Google or even local models. As models evolve the gaps between them will close and pricing will drop so being provider-agnostic is important.
- Out of the box LSP support
- A focus on TUI. Nikcli is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This for example can allow Nikcli to run on your computer, while you can drive it remotely from a mobile app. Meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/nikcli) | [X.com](https://x.com/nikcli)
