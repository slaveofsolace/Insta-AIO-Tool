# Insta AIO Tool

Three Instagram tools in one place, running entirely on your own machine:

- **Follower checker** — see who doesn't follow you back, who you don't follow back, and who's mutual.
- **Follow / Unfollow** — work through a list of accounts one at a time, or let the batch runner pace it for you.
- **DM Unsend** — find the messages *you* sent in a conversation and remove them, one or many.

Your data never leaves your machine. Nothing is uploaded, and there is no account
or server to sign in to. Instagram exports you import stay in local browser
storage until you choose to export a file.

## Which version should I install?

| | What you get | Best for |
|---|---|---|
| **Userscript** (Tampermonkey) | All three tools, including live Follow, Unfollow, and Unsend with paced batch runs. | Fastest start — one click, no build step. |
| **Browser extension** | The same tools, plus pairing with the app for signed, recorded jobs. | Anyone who also uses the app workspace. |
| **Desktop / web app** | The full workspace: import Instagram ZIP exports, snapshots, message search, queue history. | Working with exported data in bulk. |

The userscript and the extension run the **same inspected Instagram engine** —
the userscript is built from the extension's own target-resolution code. Their
delivery and pairing features differ, but their account/message checks share the
same safe-stop rules.

### Quickest start

Install [Tampermonkey](https://www.tampermonkey.net/), then open this link and
select **Install**:

**[Install Insta AIO Toolbox](https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js)**

Then allow the userscript to run in Chrome:

1. Open `chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo`.
2. Open Tampermonkey's **Details**.
3. Enable **Allow User Scripts**.

Reload Instagram and press **Alt + Shift + I**. Updates arrive automatically.

Full steps and the other options are in [Installation](./docs/INSTALLATION.md).

<details>
<summary>Full feature list</summary>

- An installable progressive web app with offline support
- Direct, local Instagram ZIP import with a reviewed manifest
- Relationship snapshots, comparisons, protections, and queue history
- Message search, sent-message classification, and reviewed unsend jobs
- Migrations for Instagram Helper, SimpleInstaBot, and saved follower-checker results
- A visible Instagram panel for capture, queue work, and message evidence
- A signed, origin-paired Manifest V3 extension bridge
- A self-contained Tampermonkey userscript that injects all three tools on Instagram
- Windows and macOS desktop packaging

</details>

## Safety model

Live account changes and DM removal are disabled by default. Scans, comparisons,
visible evidence, and exact-target dry runs remain available while locked. The
extension batch controls require an exact typed arm phrase. Thread-wide Unsend
requires a separate `UNSEND ALL DMS` arm followed by a second confirmation; its
15-minute authorization is bound to the exact open thread and checked before
every message and page control. The runner accepts only the one newly surfaced
menu and confirmation control for the message it just opened. The
userscript likewise starts with every destructive control disabled and requires
`ENABLE LIVE ACTIONS` for a tab-scoped 15-minute window before any run can be
confirmed. Account batches carry only that expiry across the profile navigation
they cause, using the userscript manager's tab-local storage; an expired window
stops before another action.

The signed PWA path adds stricter one-item controls. A live Follow or Unfollow
requires a fresh signed batch of exactly one item, action permission, an exact
phrase entered on the matching Instagram profile, a 90-second one-use arm, PWA
and extension-side durable reservations, a relationship control inside a
verified profile header, a newly created target-named Unfollow dialog when
needed, and post-action relationship verification. A live Unsend additionally
requires two fresh confirmations for exactly one sent message, exact
thread/message/timestamp/content-digest/ownership binding, an `ARM UNSEND
<code>` phrase in the matching Instagram conversation, independent PWA and
extension reservations, a one-use rendered-message token, structurally bound
interactive menu/dialog controls, and exact-message removal proof while stable
identity coverage remains available. DOM resolution tokens are issued only by
Web Crypto; if neither `randomUUID` nor `getRandomValues` produces entropy,
inspection returns `secure-random-unavailable` and no capability is stored.

The project does not implement proxy rotation, fingerprint spoofing, challenge bypass, CAPTCHA solving, private endpoint reverse engineering, or unreviewed destructive actions.

Insta AIO Tool is an independent project and is not affiliated with or endorsed
by Instagram or Meta. Operators are responsible for protecting imported data
and complying with the rules that apply to their accounts and environment.

## Requirements

- Node.js 20 or newer
- Corepack with pnpm 11.9.0, as pinned in `package.json`
- A modern Chromium-based browser for the PWA
- Windows for producing the NSIS installer
- macOS for producing and validating DMG/ZIP releases

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
pnpm run serve
```

`pnpm run serve` prints the local address to open in your browser. It listens on
your own machine only and is not reachable from your network.

`pnpm run assemble` rebuilds `src/app.js` from the UI fragments in
`src/app.parts/`. That generated file is not committed, so run it after a fresh
clone or you will get a blank app.

## Import workflow

1. Request a JSON export from Instagram Accounts Center.
2. In **Import / Export**, select the original ZIP.
3. Review the detected paths, file types, expanded sizes, and archive warnings.
4. Confirm the local import.
5. Choose the active relationship snapshot and review comparisons.

Extracted JSON files and folders remain supported as a fallback. Recognized data includes:

- `followers_*.json` and `following*.json`
- Meta `message_*.json` conversation exports
- Instagram Helper `allMessagesItemsArray` data
- SimpleInstaBot followed/unfollowed history
- Saved follower-checker result objects
- Insta AIO workspace and snapshot exports

Encrypted archives, unsafe paths, unsupported ZIP variants, integrity errors, and configured size-limit violations are rejected before data is committed.

## Relationship review

The Relationships view identifies mutuals, non-mutual relationships, new followers, detected unfollowers, following changes, and ID-backed username changes.

The queue protects:

- Whitelisted usernames
- Accounts followed before the tool was adopted
- Mutual followers when mutual protection is enabled
- Migration-only history records
- Duplicate or already-completed actions

Follow items enter a configurable waiting period before an unfollow review can become ready.

## Reviewed action jobs

Queue records must be selected explicitly. A preview lists the exact username and action for every item, calculates a digest, and requires the matching confirmation phrase.

Dry runs inspect the current profile without clicking. The adapter safe-stops on the wrong profile, an unverified profile header, ambiguous controls, any pre-existing dialog, an unbound Unfollow dialog, session expiry, challenges, rate limits, action blocks, changed protection state, stale confirmation, or a missing/expired live arm. The PWA ledger and the extension's bounded mirror reserve before the isolated driver call and prevent duplicate or over-limit execution.

Extension 0.10.4 preserves the stricter signed live paths for one reviewed PWA
item. The PWA sends a signed intent; the Instagram overlay requires the matching
profile or exact sent message plus `ARM FOLLOW @username`, `ARM UNFOLLOW
@username`, or `ARM UNSEND <code>`; every arm expires after 90 seconds.
Immediately before page control, the background persists its own reservation
and consumes the arm, then finalizes that mirror as succeeded or uncertain. The
PWA independently checkpoints its transactional ledger. These implemented paths
still require authenticated selector acceptance before issues #3 and #4 can be
closed.

## Reviewed DM jobs

Only messages classified as sent by the configured owner can enter a reviewed unsend job. Each item preserves conversation ID, message ID, timestamp, sender ownership, and a content digest.

Live-mode data structures require:

- Complete batch review
- A second destructive confirmation
- Exact conversation and message resolution
- Immediate sender-ownership revalidation
- A durable reservation before the destructive call
- Post-action removal verification

The browser extension performs a true no-click exact-message dry run when the open thread ID matches and one rendered sent row exposes the reviewed message ID, exact timestamp, matching content digest, and sender ownership. Missing stable attributes, duplicate candidates, wrong threads, changed content, and unknown ownership safe-stop. The controlled live path is isolated from that dry-run route: it accepts one fresh twice-confirmed item, consumes an expiring tab-scoped capability before page control, revalidates the same row before each stage, rejects pre-existing menus or dialogs, requires newly surfaced ARIA-bound interactive Unsend controls, and confirms the same-thread target is gone while another stable message identity remains observable. Wrong-thread navigation, identity loss, unbound surfaces, noninteractive text, and unrelated right-aligned descendants all stop uncertain. Authenticated Instagram DOM and action acceptance remain not run, so this is not a claim that issue #4 is closed.

## Companion extension

Build the extension:

```bash
pnpm run build:extension
```

Load `dist/extension` as an unpacked extension, or install the generated ZIP through the appropriate browser-managed workflow.

Open Instagram after loading the extension. A compact **AIO** launcher appears
on the right by default; the full overlay opens only when the operator requests
it. On desktop, drag its header to move it, drag the lower-right handle to resize it, and
use **Settings → Surface transparency** to choose 55–100% opacity. Reset restores
the bounded default. On narrow screens it becomes a fitted bottom sheet. It
provides:

- Current-page session, profile, relationship, and queue-match inspection
- Guided full-list Following and Followers scans, followed by an explicit local Compare step
- A review-first account queue that freezes the exact targets before Start becomes available
- Sanitized history for signed account/DM dry runs and controlled one-item results received from the PWA
- Instagram-side, 90-second one-use arms for a fresh signed one-item Follow, Unfollow, or exact sent-message Unsend intent
- Read-only visible-message evidence plus conditional exact-identity DM dry runs that never open a menu
- A direct link back to the exact paired PWA origin

Press **Alt + Shift + I** to toggle the sidecar.

### All-in-one tools

The sidecar carries the three tools in one place, each on its own tab.

**Follower checker.** Open your Following dialog and choose **Scan Following**,
then open Followers and choose **Scan Followers**. Each scan auto-scrolls the
open dialog and reads every row it renders, so it is not limited to the first
screen. It reports `complete` only when the list actually reaches its end; a
truncated scan says so instead of silently under-reporting. **Compare** stays
disabled until both lists are present and then shows mutuals,
not-following-me-back, and I-don't-follow-back counts computed locally.

**Follow / Unfollow bot.** In the Follow / Unfollow tab, pick a target source
(either checker result or the manual queue), an action, and how many to run.
Choose **Review run** to freeze and inspect the exact targets, duplicates, and
omissions. **Start** appears only while that review still matches the controls.
Each target is opened, re-verified, and acted on one at a time. **Complete** and
**Skip** remain available under the secondary options disclosure.

**Mass DM unsend.** Open a conversation. The primary **Unsend all DMs** card
starts `live locked`; the quieter **Check conversation** control provides a
read-only evidence refresh. Choose **Unlock Unsend all DMs**, type `UNSEND ALL
DMS`, then select **Unsend all DMs** again and accept the permanent-action
confirmation. The authorization expires after 15 minutes, the runner re-checks
it before every message, and only rows proven sent by the current account are
eligible. The history loader no longer repeatedly repositions a thread that is
already at its loaded boundary. Unsending is permanent.

### Batch pacing and safety

Batch runs reuse the audited one-item path: each item still runs a complete
inspect, exact-resolution, reserve, act, and record cycle. A batch arm replaces
per-item phrase typing; it is consumed by the run it authorises and cannot be
replayed.

- Randomised delays between items, plus a longer rest every 20 items
- Configurable daily caps and delays under **Settings → Batch pacing**, clamped
  to hard ceilings (400 account actions/day, 300 unsends/day, 1.5 s minimum delay)
- The whole run stops on the first rate limit, checkpoint, block, session
  expiry, or unexpected screen
- A target whose relationship no longer matches is skipped, not forced
- **Stop** aborts before the next item

Automated following and bulk activity run against Instagram's terms and can get
an account actioned. Pacing is yours to set; the ceilings only bound the worst case.

See
[Instagram sidecar](./docs/INSTAGRAM_SIDECAR.md)
for the runtime and data boundaries and
[Overlay UI implementation](./docs/OVERLAY_UI_IMPLEMENTATION.md) for the
module and migration status. The dedicated screenshot/state matrix, baseline
workflow, and current nonclaims are documented in
[Overlay QA](./docs/OVERLAY_QA.md).

Pairing is origin-specific:

1. In the PWA Settings view, create a one-time pairing code.
2. Open the extension popup on the exact PWA origin.
3. Choose read-only access or reviewed dry-run transfer.
4. Paste the code and pair the origin.
5. Return to the PWA and complete the handshake.

The handshake rotates the one-time code into a derived session secret. Messages are signed, time-limited, origin-bound, permission-checked, and protected against nonce replay. Payloads containing session or authorization material are rejected.

## Tampermonkey companion

Install `userscripts/insta-aio-companion.user.js` in Tampermonkey.

The generated script injects a movable, lower-right-resizable, translucent
three-tab toolbox directly on `instagram.com`. It includes the full-list follower
scanner and local comparison, queue and checker target sources for paced Follow
or Unfollow runs, and the source-audited thread-wide DM Unsend runner. It uses the
same exact-target Instagram engine as the extension and remains self-contained:
no remote `@require`, network connector, credential access, or cloud storage.
It explicitly requests the userscript manager's isolated DOM sandbox.
Resumable account runs use `GM_getTab`/`GM_saveTab`, so another Instagram tab
cannot inherit a running batch. Tampermonkey is the supported manager; on a
manager without those tab APIs, follower scanning, comparison, and no-click
checks remain available but account batch execution stays disabled.

Live controls are visible but disabled on every page load. Open the gear menu,
select **Enable live actions for 15 minutes**, and type `ENABLE LIVE ACTIONS` to
unlock them. Each destructive run then asks for a separate confirmation. The
authorization expires during a run and is checked before every later item;
account navigation retains only the already-confirmed run and its expiry in the
same manager tab. Thread-wide Unsend separately binds its arm to the current
thread and rejects navigation, expired authority, pre-existing menu decoys, and
ambiguous newly opened controls. The
follower scanner, exported comparisons, visible-message scan, and exact no-click
checks work while live controls are locked. The userscript does not include the
extension's signed PWA bridge or its durable workspace ledgers.

## Desktop builds

Create an unpacked desktop build:

```bash
pnpm run pack:desktop
```

Create a Windows NSIS installer:

```bash
pnpm run dist:win
```

Create macOS DMG and ZIP artifacts on macOS:

```bash
pnpm run dist:mac
```

The Electron renderer runs with context isolation, sandboxing, Node integration disabled, denied permission requests, a confined custom protocol, and a restrictive content policy. Local Chromium data is retained across approved upgrades, and up to five startup backups are kept in an app-specific data directory.

See [Installation](./docs/INSTALLATION.md) and [Rollback](./docs/ROLLBACK.md).

## Verification

```bash
pnpm run assemble
pnpm test
pnpm run qa:extension
pnpm run qa:chrome
pnpm run qa:browser:check
pnpm run qa:overlay:check
pnpm run benchmark:zip
```

The automated suite covers imports, migrations, archive integrity and limits, action/DM reviews, no-click execution, PWA and extension-side transactional ledgers, bridge signing and replay protection, one-item intent/arm expiry and consumption, secure-token fail-closed behavior, reviewed UTF-8 action labels, verified-profile-header Follow/Unfollow fixtures, suggested-account isolation, stale-dialog rejection, extension permissions, sidecar packaging and safety invariants, desktop hardening, state migration, service-worker assets, and large-list windowing. `qa:extension` runs the actual production content script and overlay through bounded local Follow, Unfollow, and one-message Unsend DOM chains in isolated Chromium, then checks keyboard accessibility, the Chromium accessibility tree, PWA installability, and read-only pairing defaults. `qa:chrome` loads and pairs the real unpacked package in a disposable Chrome-for-Testing profile. The browser QA command exercises every PWA view at fixed desktop, tablet, and mobile sizes, verifies that live settings remain off, and compares nine Windows Chromium screenshots with tracked SHA-256 baselines.

Use `pnpm run qa:browser:update` only when intentionally accepting a reviewed
visual change. Baselines are platform-specific and actual run output stays under
ignored `test-results`.

The overlay-specific commands rebuild the production extension before loading
its manifest-ordered content scripts in the deterministic Instagram fixture.
Use `pnpm run qa:overlay:update` only for an intentional, manually reviewed
baseline replacement. The 40-state Windows baseline includes a centered,
resized 62%-opacity proof plus desktop, tablet, mobile, zoom, forced-colors,
collision, locked-action, and review-before-start states. It has been reproduced by
`qa:overlay:check`; CI runs the non-updating check on Windows.
Human screen-reader review, persistent-profile installation, and authenticated
Instagram selector acceptance remain separate operator/release gates.

Windows packaging has been exercised through unpacked launch, packaged-renderer smoke, silent NSIS install, installed-app launch, and silent uninstall. The CI workflow provisions Chrome for Testing for real extension pairing and builds a macOS DMG/ZIP that is mounted, copied, QA-only ad-hoc signed with hardened-runtime Electron entitlements, launched in smoke mode, and removed. Release entitlements do not include the ad-hoc library-validation exception. Apple Developer ID signing/notarization, a human screen-reader review, installation in the operator's intended persistent Chrome profile, and a user-selected real Instagram mutation remain release/operator acceptance rather than automated claims.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Instagram sidecar](./docs/INSTAGRAM_SIDECAR.md)
- [Overlay QA](./docs/OVERLAY_QA.md)
- [Product specification](./docs/PROJECT_SPEC.md)
- [Source audit](./docs/SOURCE_AUDIT.md)
- [Component integration audit](./docs/COMPONENT_INTEGRATION_AUDIT.md)
- [Migration report](./docs/COMPONENT_MIGRATION_REPORT.md)
- [Delivery status](./docs/DELIVERY_STATUS.md)
- [Maintainer guide](./docs/MAINTAINER_GUIDE.md)
- [Performance](./docs/PERFORMANCE.md)
- [Security policy](./SECURITY.md)
- [Third-party notices](./THIRD_PARTY_NOTICES.md)

## License

Insta AIO Tool is available under the [MIT License](./LICENSE). Reviewed third-party sources and their license boundaries are documented in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
