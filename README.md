# pi-gui

[简体中文](./README.zh-CN.md)

`pi-gui` is a Codex-style Electron desktop app for local [`pi`](https://github.com/earendil-works/pi) coding sessions.

This repository is a modified version of [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui). The upstream project provides the base desktop shell around `@earendil-works/pi-coding-agent`; this fork keeps that direction and adds product, packaging, Git, model-management, and UI refinements for a more complete local desktop workflow.

## What It Is

`pi-gui` is not a separate agent runtime. It is a desktop interface for the upstream `pi` runtime and uses `@earendil-works/pi-coding-agent` for sessions, model/provider authentication, tool execution, skills, extensions, and transcript data.

The app is intended for developers who use `pi` locally and want a focused desktop surface for:

- opening local workspaces
- starting and resuming agent sessions
- viewing transcript and tool activity
- composing messages with file/image attachments
- inspecting Git changes and diffs
- committing and syncing changes
- managing providers, models, skills, and extensions
- using an integrated terminal alongside the agent workflow

## Main Features

- **Workspace and session management**: add local folders, switch workspaces, create and resume sessions, and preserve desktop UI state.
- **Conversation-first layout**: transcript, tool timeline, composer, and session state are the primary UI surfaces.
- **Composer workflow**: model selector, thinking-level selector, slash-command support, queued messages, attachment previews, and context usage display.
- **Git panel**: staged/unstaged lists, inline diffs, stage/unstage controls, discard changes, AI commit-message generation, commit history, push/sync state, and resizable panel layout.
- **Model management**: provider/model settings backed by `~/.pi/agent/models.json`, model fetching/testing, usage query settings, enabled model sync, and API type selection.
- **Provider configuration**: OAuth/API-key provider setup through the desktop settings UI.
- **Skills and extensions**: inspect and toggle discovered `pi` skills/extensions, including extension commands/tools/diagnostics.
- **Notifications**: macOS notification onboarding and background completion/failure/attention-needed preferences.
- **Packaging scripts**: macOS, Windows, Linux, and all-platform package commands are exposed from the root `package.json`.

## Current Status

- Primary desktop target: macOS.
- Linux AppImage packaging is supported for local builds and CI-style checks.
- Windows packaging scripts exist, but platform-specific validation may require a Windows environment.
- Live runtime behavior depends on your local `pi` configuration and model credentials.

## Prerequisites

- Node.js compatible with this workspace. Current local development uses Node `v24.15.0`.
- `pnpm` via Corepack.
- Valid `pi` provider/model authentication.
- For live agent work, your local `pi` CLI should be able to run successfully.

Install dependencies:

```bash
corepack enable
pnpm install
```

## Development

Run the desktop app in development mode:

```bash
pnpm dev
```

Equivalent package-scoped command:

```bash
pnpm --filter @pi-gui/desktop dev
```

Build all packages:

```bash
pnpm build
```

Run type checks:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Desktop-specific test lanes and verification guidance are documented in [`apps/desktop/README.md`](./apps/desktop/README.md).

## Packaging

Root package scripts:

```bash
pnpm build:desktop:mac
pnpm build:desktop:win
pnpm build:desktop:linux
pnpm build:desktop:all
```

Desktop package scripts:

```bash
pnpm --filter @pi-gui/desktop package:mac
pnpm --filter @pi-gui/desktop package:win
pnpm --filter @pi-gui/desktop package:linux
pnpm --filter @pi-gui/desktop package:all
```

Directory-only package builds are also available:

```bash
pnpm --filter @pi-gui/desktop package:mac:dir
pnpm --filter @pi-gui/desktop package:win:dir
pnpm --filter @pi-gui/desktop package:linux:dir
```

Release output is written under `apps/desktop/release`.

## Repository Layout

- `apps/desktop`: Electron main/preload/renderer app, desktop tests, packaging config, native helper build scripts.
- `apps/website`: website app scaffold.
- `packages/session-driver`: shared session driver types and runtime-facing contracts.
- `packages/catalogs`: workspace/session/worktree catalog storage types.
- `packages/pi-sdk-driver`: adapter layer over `@earendil-works/pi-coding-agent`.
- `docs`: README media and project documentation.
- `scripts`: release and install verification helpers.

## Model And Image-Generation Notes

The advanced model manager can preserve and edit `compat.openaiProviderTools` metadata in `~/.pi/agent/models.json`, including model-level `imageGeneration` flags. This is configuration support only. Actual provider-native image generation still depends on a compatible `pi` runtime/plugin/provider combination.

At the time of this README update, `omp-openai-provider-tools` npm versions `0.1.0` through `0.1.4` were tested against local `pi 0.74.1` and failed during extension loading, so this fork does not automatically install that plugin.

## Known Limitations

- The desktop app relies on upstream `pi` behavior and local auth/session state.
- Automated Playwright/Vitest test suites have been removed from this fork; use manual desktop smoke checks for UI changes.
- Development mode may show Electron CSP warnings that are not shown in packaged builds.

## Upstream And Attribution

This project is based on [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui).

It also depends on:

- [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- [`earendil-works/pi`](https://github.com/earendil-works/pi)

## License

MIT. See [LICENSE](./LICENSE).
