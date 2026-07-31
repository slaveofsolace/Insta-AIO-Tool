# Installation

## PWA

1. Run `corepack enable`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Run `pnpm run serve`.
4. Open `http://127.0.0.1:4173`.
5. Use the browser's install control if an installed PWA is desired.

The application can run offline after the service worker has cached the current release assets.

## Companion extension

1. Run `pnpm run build:extension`.
2. Open the browser extension manager.
3. Enable developer mode.
4. Choose **Load unpacked** and select `dist/extension`.
5. Open the PWA and create a pairing code in Settings.
6. Open the extension popup on the same PWA tab and complete pairing.
7. Open or reload `https://www.instagram.com/`.
8. Use the **Insta AIO Field Desk** sidecar, or press **Alt + Shift + I** to toggle it.

The extension requests access only to the exact paired PWA origin at pairing time.
Instagram host access is declared for the visible sidecar and read-only
inspection. The sidecar can import a PWA manual queue, navigate to the profile
selected by the user, and update its own local completion/skip state. It does
not auto-scroll Instagram or click Follow, Unfollow, message menus, or Unsend.

After updating an unpacked build, reload the extension in the browser extension
manager and reload existing Instagram tabs so both content scripts are current.

## Tampermonkey userscript

1. Install Tampermonkey from its official browser store.
2. Create a new userscript.
3. Replace the editor contents with `userscripts/insta-aio-companion.user.js`.
4. Save and enable the script.
5. Open Instagram and use the companion panel for visible-list capture or a manually exported queue.

## Windows desktop

Build:

```bash
pnpm run dist:win
```

Run the generated NSIS installer under `dist/desktop`. The assisted installer allows an installation directory choice.

The uninstaller removes program files and shortcuts. Workspace data is retained by default so an approved reinstall or upgrade can recover it. Export a workspace backup before removal if the data must be portable.

## macOS desktop

Build on macOS:

```bash
pnpm run dist:mac
```

This creates DMG and ZIP targets under `dist/desktop`. Production distribution requires an Apple signing identity and notarization appropriate to the release channel.

## Upgrade

1. Export a workspace backup from Settings.
2. Close all running application windows.
3. Install the new release over the existing application.
4. Open the application and inspect the active snapshot, queue, messages, and settings.
5. Run a fresh export after the upgrade is accepted.

The desktop shell creates a bounded startup backup before opening the renderer when local browser storage exists.
