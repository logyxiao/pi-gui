# Desktop App

Codex-style Electron shell for `pi`.

macOS remains the primary target for desktop UI behavior. Linux is supported for packaging and manual validation, with packaging checks available to catch AppImage regressions.

## Setup

Install workspace dependencies once:

```bash
corepack enable
pnpm install
```

Build the desktop app:

```bash
pnpm --filter @pi-gui/desktop build
```

Run the app in development:

```bash
pnpm --filter @pi-gui/desktop dev
```

`dev` runs through `electron-vite`, so renderer edits hot-update in place and Electron `main` / `preload` changes trigger the appropriate reload or restart behavior automatically. The desktop dev launcher also rebuilds the shared workspace packages up front and keeps them in watch mode so Node-side package changes can be picked up without manual rebuilds.

Run the built app locally without packaging:

```bash
pnpm --filter @pi-gui/desktop preview
```

Package the app:

```bash
pnpm --filter @pi-gui/desktop run package:mac
pnpm --filter @pi-gui/desktop run package:win
pnpm --filter @pi-gui/desktop run package:linux
```

Run type checking:

```bash
pnpm --filter @pi-gui/desktop run typecheck
```

## Packaging Verification

The remaining verification scripts are packaging/runtime dependency checks rather than test suites:

```bash
pnpm --filter @pi-gui/desktop run verify:runtime-model-registry
pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps
pnpm --filter @pi-gui/desktop run verify:packaged-runtime-deps:linux
```

## Manual Smoke Checklist

The automated Playwright/Vitest test suites have been removed from this fork. For UI changes, use a manual smoke pass on the real Electron app:

- Launch the desktop app.
- Open or add a workspace folder.
- Create a new thread.
- Send a prompt and confirm the transcript updates.
- Switch workspaces/sessions if the change touched navigation.
- Reopen the app if the change touched persistence.
- Package or preview the app before release-oriented changes.
