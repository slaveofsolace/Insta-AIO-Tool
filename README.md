# Insta AIO Tool

Insta AIO Tool is a local-first workspace for reviewing Instagram relationship exports, maintaining follow/unfollow queues, and examining message exports. Imported data stays in the browser or desktop app unless the user explicitly exports a file.

The project includes:

- An installable progressive web app with offline support
- Direct, local Instagram ZIP import with a reviewed manifest
- Relationship snapshots, comparisons, protections, and queue history
- Message search, sent-message classification, and reviewed unsend jobs
- Source-specific migrations for Instagram Helper, SimpleInstaBot, and saved follower-checker results
- A visible Instagram sidecar for capture, manual queue work, and read-only message evidence
- A signed, origin-paired Manifest V3 extension bridge for reviewed no-click jobs and one-item controlled account actions
- A preserved read-only Tampermonkey fallback
- Windows and macOS Electron packaging configuration

## Safety model

Live account changes and DM removal are disabled by default. The PWA requires exact previews and confirmation phrases. Dry runs never invoke the extension's page-control path. A live Follow or Unfollow requires a fresh signed batch of exactly one item, action permission, an exact phrase entered on the matching Instagram profile, a 90-second one-use arm, PWA and extension-side durable reservations, a relationship control inside a verified profile header, a newly created target-named Unfollow dialog when needed, and post-action relationship verification. A live Unsend additionally requires two fresh confirmations for exactly one sent message, exact thread/message/timestamp/content-digest/ownership binding, an `ARM UNSEND <code>` phrase in the matching Instagram conversation, independent PWA and extension reservations, a one-use rendered-message token, structurally bound interactive menu/dialog controls, and exact-message removal proof while stable identity coverage remains available. DOM resolution tokens are issued only by Web Crypto; if neither `randomUUID` nor `getRandomValues` produces entropy, inspection returns `secure-random-unavailable` and no capability is stored.

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

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

`pnpm run assemble` materializes the deterministic UI fragments as the ignored `src/app.js` development file.

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

Extension 0.4.0 exposes controlled live paths only for one reviewed item. The PWA sends a signed intent; the Instagram Field Desk requires the matching profile or exact sent message plus `ARM FOLLOW @username`, `ARM UNFOLLOW @username`, or `ARM UNSEND <code>`; every arm expires after 90 seconds. Immediately before page control, the background persists its own reservation and consumes the arm, then finalizes that mirror as succeeded or uncertain. The PWA independently checkpoints its transactional ledger. These implemented paths still require authenticated selector acceptance before issues #3 and #4 can be closed.

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

Open Instagram after loading the extension. A compact **Insta AIO Field Desk**
launcher appears on the right by default; the full sidecar opens only when the
operator requests it. It provides:

- Current-page session, profile, relationship, and queue-match inspection
- Repeated visible-row capture that merges follower or following usernames
- The existing manual queue JSON workflow with Open, Complete, and Skip controls
- Sanitized history for signed account/DM dry runs and controlled one-item results received from the PWA
- Instagram-side, 90-second one-use arms for a fresh signed one-item Follow, Unfollow, or exact sent-message Unsend intent
- Read-only visible-message evidence plus conditional exact-identity DM dry runs that never open a menu
- A direct link back to the exact paired PWA origin

Press **Alt + Shift + I** to toggle the sidecar. Follow, Unfollow, and Unsend
remain locked until their controlled one-item workflows are completed. See
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

It can capture usernames already rendered in a follower/following dialog, import a manual queue, open the next profile, record manual completion or skip decisions, and export its local state. It does not auto-scroll or click Follow, Unfollow, or Unsend.

The userscript is the preserved limited fallback. The complete five-tool
overlay, signed PWA bridge, exact one-item arm gates, theme/dock preferences,
and collision-safe execution strip are provided by the Manifest V3 extension.

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
baseline replacement. The 38-state Windows baseline has been agent-reviewed and
reproduced by `qa:overlay:check`; CI runs the non-updating check on Windows.
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
