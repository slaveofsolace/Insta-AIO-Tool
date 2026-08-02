# Installation

## PWA

1. Run `corepack enable`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Run `pnpm run serve`.
4. Open `http://127.0.0.1:4173`.
5. Use the browser's install control if an installed PWA is desired.

The application can run offline after the service worker has cached the current release assets.

Maintainers can validate Chrome installability and a real read-only extension
pairing in a disposable Chrome-for-Testing profile with `pnpm run qa:chrome`.
This does not install anything into the operator's normal profile.

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
Instagram host access is declared for the visible sidecar, no-click inspection,
and separately gated one-item drivers. The sidecar can import a PWA manual
queue, navigate to the profile selected by the user, and update its own local
completion/skip state. It does not auto-scroll Instagram. Dry runs never use an
Instagram page control. Controlled live Follow, Unfollow, and exact
sent-message Unsend are available only through the separate one-item workflows
below and remain locked by default.

Reviewed DM dry runs can report `resolved-no-click` only while the exact thread
is open and one visible sent row exposes every stable identity field required by
the reviewed job. Current Instagram DOMs that omit any field will stop safely;
this is expected.

After updating an unpacked build, reload the extension in the browser extension
manager and reload existing Instagram tabs so both content scripts are current.

### Controlled account action

This workflow changes the selected Instagram relationship. Use it only for one
account the operator has explicitly reviewed:

1. Pair the extension with **action** permission.
2. In PWA Settings, enable reviewed live account actions and keep the live batch limit at one.
3. Select exactly one queue record, create its reviewed preview, and complete the no-click dry run first.
4. Create a new preview if needed, choose live mode, and type its exact review phrase.
5. Select **Continue controlled live action**. The first selection sends only a signed intent; it does not click Instagram.
6. Open the exact target profile. In **Field Desk → Queue**, verify the username, action, and relationship, then type the displayed `ARM FOLLOW @username` or `ARM UNFOLLOW @username` phrase.
7. Return to the PWA within 90 seconds and select **Continue controlled live action** again.
8. Review the job checkpoint, queue result, activity entry, and action-ledger record before doing anything else.
9. Disable reviewed live account actions when the controlled check is finished.

The arm is scoped to one job item, username, action, Instagram tab, and short
expiry. It is consumed before the page-control request, including on uncertain
outcomes. A new review and arm are required for any later attempt.

### Controlled one-message Unsend

This workflow removes one exact sent message. Do not use it until the operator
has reviewed that specific message and accepts that Unsend is destructive:

1. Pair the extension with **action** permission.
2. In PWA Settings, enable reviewed live DM Unsend. The extension path accepts exactly one message even if exported core jobs use another reviewed limit.
3. Select one sent message, create its reviewed preview, and complete the no-click dry run first.
4. Create a new preview if needed, choose live mode, type the review phrase, then type the separate destructive phrase.
5. Select **Continue controlled live Unsend**. The first selection sends only a signed intent; it does not open an Instagram menu.
6. Open the exact conversation and keep the exact sent message rendered. In **Field Desk â†’ Messages**, verify the message identity and type the displayed `ARM UNSEND <code>` phrase.
7. Return to the PWA within 90 seconds and select **Continue controlled live Unsend** again.
8. Stop immediately if the PWA reports any ambiguity or uncertain outcome. Review the DM job checkpoint plus both ledger records before any later attempt.
9. Disable reviewed live DM Unsend when the controlled check is finished.

The arm is scoped to one job, item, conversation, message, and Instagram tab.
The extension reserves and consumes it before the first page control. The PWA
separately reserves its durable ledger, and the row token is one-use. A new
twice-confirmed review and arm are required for any later attempt. Deterministic
fixtures do not replace authenticated selector and action acceptance.
If Instagram does not expose explicit control/surface relationships or another
stable message identity for post-removal proof, the driver stops uncertain. Do
not retry or weaken those checks; record the DOM acceptance blocker instead.

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

After building on macOS, run `pnpm run qa:mac-package`. It mounts the DMG,
copies the app to a disposable install root, applies an ad-hoc test signature,
launches `--smoke-test`, removes the copied app, and verifies the ZIP. The ad-hoc
signature is acceptance evidence, not a substitute for Developer ID signing or
notarization.

## Upgrade

1. Export a workspace backup from Settings.
2. Close all running application windows.
3. Install the new release over the existing application.
4. Open the application and inspect the active snapshot, queue, messages, and settings.
5. Run a fresh export after the upgrade is accepted.

The desktop shell creates a bounded startup backup before opening the renderer when local browser storage exists.
