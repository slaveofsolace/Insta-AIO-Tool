# Installation

Pick one:

- [Userscript](#option-1--userscript-one-click) — fastest, no build step, full tools.
- [Browser extension](#option-2--browser-extension) — same tools, plus pairing with the app.
- [Web / desktop app](#option-3--web-or-desktop-app) — the full workspace for imported Instagram exports.

The userscript is **built from the extension's own Instagram engine**, so both
run identical code for scanning, following, unfollowing, and unsending. The
extension additionally pairs with the app for signed, recorded jobs.

---

## Option 1 — Userscript (one click)

This gives you all three tools in a movable, resizable, translucent panel on
Instagram. Live Follow, Unfollow, and Unsend are included but locked on every
page load until you explicitly authorize a short window.

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open the install link:

   **[Install Insta AIO Toolbox](https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js)**

   Tampermonkey recognises the `.user.js` address and opens its install screen.
3. Select **Install**.
4. Open or reload `https://www.instagram.com/`.
5. Use the panel, or press **Alt + Shift + I** to show and hide it.

Tampermonkey is the supported manager for paced account runs. The script asks
for an isolated DOM sandbox and `GM_getTab`/`GM_saveTab` so a confirmed
batch remains owned by one Instagram tab. A different userscript manager may
still provide scanning, local comparison, and no-click checks, but the account
batch controls deliberately stay disabled unless those tab APIs are available.

### Using it

**Follower checker** — open Following and choose **Scan Following**, then open
Followers and choose **Scan Followers**. Each step scrolls only the open list and
reads every rendered row. **Compare** becomes available once both lists exist and
shows mutuals and both not-following-back groups locally.

**Follow / Unfollow** — pick targets, action, and how many, then choose **Review
run**. The exact targets, duplicates, and omissions are frozen for inspection;
**Start** appears only while that review matches the current controls. The script
opens each profile when its turn comes and resolves the exact relationship
control again before acting.

**DM Unsend** — open a conversation and use the primary **Unsend all DMs** card.
The quieter **Check conversation** control refreshes read-only evidence. The
runner loads history and processes only rows proven sent by the current account,
newest to oldest, without repeatedly repositioning a thread already at its
loaded boundary. Each action uses the source-audited menu and confirmation
sequence. This cannot be undone.

**Unlocking live controls** — open the gear menu, select **Enable live actions
for 15 minutes**, and type `ENABLE LIVE ACTIONS`. This only enables the buttons;
it does not click Instagram. Starting a run still requires a separate
confirmation. The authorization is checked before every later item and expiry
stops the run. Scanning, comparison, evidence reading, and no-click checks work
without unlocking.

Pacing lives under the gear icon: per-day caps and the delay range. Runs pause
longer every 20 items, stop on any rate limit or security check, skip targets
that changed, and end immediately on **Stop**. A DM run is discarded on reload.
An already-confirmed account run may continue across the profile navigations it
causes in the same manager tab, but only while its original 15-minute
authorization remains valid. Thread-wide Unsend is bound to the open thread and
accepts only the newly surfaced menu and confirmation controls for each item.

Updates are automatic. Tampermonkey re-checks the same address and offers new
versions as they are published.

Confirm the Tampermonkey dashboard shows **0.10.5 or later**
after updating. A panel that says **Live actions enabled in this tab** is the
legacy 0.9.0 build; reload only after Tampermonkey shows the newer version. The
current build starts with **Userscript mode · live actions locked**.

### Using the exact CI-tested review bundle

Every pull-request CI run publishes a seven-day artifact named
`insta-aio-browser-companions-<head-commit>` after the real unpacked extension
has loaded and paired read-only in disposable Chrome for Testing. Push-triggered
runs use the pushed commit. Download that artifact from the workflow run when
reviewing an unmerged commit. It contains:

- `insta-aio-companion-<version>.zip` for **Load unpacked** after extraction
- `insta-aio-companion.user.js` for Tampermonkey

Use the artifact whose commit matches the reviewed pull-request head. After
installation, reload Instagram and verify **Userscript mode · live actions
locked** or the extension's equivalent live-off state before any read-only
walkthrough. The artifact proves which bytes passed CI; it does not replace the
persistent-profile, authenticated, or human acceptance checks.

Use the [operator acceptance runbook](./OPERATOR_ACCEPTANCE.md) for the
persistent-profile, screen-reader, PWA-pairing, and separately authorized
one-item live checks. A general installation test is not authorization for an
Instagram mutation.

### Installing from the repository page instead

Tampermonkey can also install straight from GitHub's file view:

1. Enable the GitHub integration on the
   [Tampermonkey scripts page](https://www.tampermonkey.net/scripts.php#gh).
2. Browse to `userscripts/insta-aio-companion.user.js` in the repository.
3. Select **Raw**. Tampermonkey intercepts it and offers to install.

### If nothing happens

- Confirm Tampermonkey is enabled and allowed to run in your browser's
  extension settings.
- Some browsers require developer mode for extensions to handle `.user.js`
  addresses. Enable it, then retry the link.
- If you land on a page of source code instead of an install screen, Tampermonkey
  did not intercept it. Select all of that code, then paste it into a new script
  in the Tampermonkey dashboard and save.

---

## Option 2 — Browser extension (full features)

### Build and load it

1. Run `pnpm run build:extension`.
2. Open your browser's extension manager.
3. Turn on developer mode.
4. Choose **Load unpacked** and select the **`dist/extension`** folder.
5. Open or reload `https://www.instagram.com/`.
6. Press **Alt + Shift + I** to open the panel.

Select `dist/extension`, not the `extension/` source folder. The build copies
shared code into `dist/extension/lib/`, and the extension will not start without it.

After rebuilding, reload the extension in the extension manager **and** reload
any open Instagram tabs, or you will keep running the previous version.
The extension manager should show **0.10.5 or later**.

On a fresh install Instagram shows only a small launcher; opening it reveals the
tools. On desktop, drag the header to move the panel and use the marked
lower-right handle to resize it. Surface opacity ranges from 55% to 100%, with a readable 88% default;
the Instagram page remains visible underneath at lower values. Dock side, width,
theme, density, position, size, and opacity stay on your machine. Narrow screens
use a fitted bottom sheet instead of an off-screen floating panel.

### Using the three tools

No pairing is needed for these. Open the panel on Instagram and use:

**Follower checker.** Open Following and choose **Scan Following**, then open
Followers and choose **Scan Followers**. Each scan scrolls the open list and
reads every row, so it is not limited to what is on screen. It reports a complete
scan only when the list truly reaches its end; a partial scan says so rather than
quietly under-counting. Choose **Compare** after both lists are present.

**Follow / Unfollow.** Choose where the targets come from (either checker result
or an imported queue), the action, and how many to run this time. Choose **Review
run** to inspect and freeze the exact targets, duplicates, and omissions. **Start**
appears only while the review remains current. Each account is opened, re-checked,
and acted on individually.

**Mass DM unsend.** Open a conversation. The primary **Unsend all DMs** card is
`live locked` by default; **Check conversation** is a secondary read-only check. Choose
**Unlock Unsend all DMs**, type `UNSEND ALL DMS`, then choose **Unsend all DMs**
again and accept the permanent-action confirmation. The 15-minute authorization
is checked before each message, and only rows proven sent by the current account
are eligible. **Unsending cannot be undone.**

### Batch runs, pacing, and stopping

Batch runs type one confirmation phrase for the whole run instead of one per
item. Every item still gets its own full check before anything happens.

- Delays between items are randomised, with a longer pause every 20 items.
- Daily limits and delays are under **Settings → Batch pacing**. They are capped
  at 400 account actions per day, 300 unsends per day, and a 1.5 second minimum
  gap.
- The run stops on its own at the first rate limit, security checkpoint, block,
  expired session, or screen it does not recognise.
- An account whose relationship changed since the scan is skipped, not forced.
- **Stop** ends the run before the next item.

Bulk activity and automated following go against Instagram's terms and can get an
account restricted. Start with one or two items and increase slowly.

### Pairing with the app (optional)

Pairing is only needed for the signed job workflow described below, where the web
app reviews and records actions:

1. Open the app and create a pairing code in Settings.
2. Open the extension popup on that same app tab and complete pairing.

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
6. Open the exact conversation and keep the exact sent message rendered. In **Field Desk → Messages**, verify the message identity and type the displayed `ARM UNSEND <code>` phrase.
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

---

## Option 3 — Web or desktop app

The app is the workspace for data you have already exported from Instagram:
snapshots, comparisons, message search, and queue history.

To run it locally:

1. Run `corepack enable`.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run assemble`.
4. Run `pnpm run serve` and open the address it prints.
5. Use your browser's install control if you want it as a standalone app.

The server listens only on your own machine. After the first load the app works
offline.

Prefer a packaged desktop build? See [Windows desktop](#windows-desktop) or
[macOS desktop](#macos-desktop) below.

---

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
launches `--smoke-test`, removes the copied app, and verifies the ZIP. The QA
signature uses `build/entitlements.mac.qa.plist` because an ad-hoc identity has
no Apple Team ID. The release entitlement files retain hardened runtime without
that library-validation exception. This is acceptance evidence, not a substitute
for Developer ID signing or notarization.

## Upgrade

1. Export a workspace backup from Settings.
2. Close all running application windows.
3. Install the new release over the existing application.
4. Open the application and inspect the active snapshot, queue, messages, and settings.
5. Run a fresh export after the upgrade is accepted.

The desktop shell creates a bounded startup backup before opening the renderer when local browser storage exists.
