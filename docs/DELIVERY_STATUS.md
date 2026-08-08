# Delivery status

## Data integrations

| Scope | Status | Evidence |
|---|---|---|
| Instagram Helper messages | Complete | Source-pinned migration, fixtures, reports, tests |
| SimpleInstaBot history | Complete | Source-pinned migration, fixtures, reports, tests |
| Follower-checker output | Complete as read-only partial report | Independent parser, non-actionable contract, tests |
| instagram-dm-unsender | Complete as safe adapter behavior and stateless report | Supplied artifact hash, exact-candidate tests, documentation |

The historical browser executors are not included. Issues #1 and #2 were
revalidated against their source-specific migration, reconciliation, archive,
integrity, cancellation, and documentation tests on 2026-08-02; no regression
was found.

## Offline import

Direct ZIP import is complete for supported stored/deflated archives. It includes recursive discovery, reviewed manifests, source paths, split files, worker extraction, progress, cancellation, integrity validation, size limits, and extracted-file fallback.

## Reviewed actions

The account-action core is complete:

- Exact preview and confirmation digest
- True no-click driver path
- Protection revalidation
- Transactional reservation and daily limits
- Duplicate prevention
- Durable checkpoints and resume
- Matching-job discard cancellation and stale-checkpoint rejection
- Before/after evidence
- Safe-stop classification

Extension 0.10.4 preserves the production-controlled one-item account boundary:

- Fresh signed live intent with action permission
- Exactly one reviewed account item
- Exact matching Instagram profile header and relationship control ownership
- Exact `ARM FOLLOW @username` or `ARM UNFOLLOW @username` phrase
- A 90-second one-use arm scoped to the Instagram tab
- Authorization revalidation before PWA ledger reservation
- Independent extension-side reservation plus durable arm consumption before the page-control request
- Short-lived exact DOM resolution token, pre-existing-dialog rejection, target-named Unfollow confirmation, and after-state verification
- Web Crypto fail-closed token issuance with no zero-token fallback
- Cross-job duplicate queue-item and same-day action prevention

Automated Follow and Unfollow fixtures pass, including token replay, suggested-account isolation, pre-existing-dialog rejection, extension-side reservation, and ambiguous-control safe stops. The actual production content script also completes both bounded DOM chains in isolated Chromium. A current authenticated Instagram profile exposed one verified header and one owned Follow control during a read-only diagnostic. No real account mutation was selected or executed, so issue #3 remains open only for that operator-selected acceptance and account live execution remains locked by default.

## Reviewed DM removal

The DM core is complete:

- Sent-only selection
- Exact conversation/message/timestamp/content identity
- Review and destructive confirmations
- Transactional reservation
- Duplicate prevention
- Durable checkpoints and resume
- Pre-dispatch cancellation with durable canceled-reservation finalization
- Post-action removal verification
- Source-specific localized Unsend matching

The extension conditionally maps one reviewed message in a true no-click dry
run when the direct-thread ID, stable rendered message ID, exact timestamp,
content digest, and sent ownership all match uniquely. The background rechecks
the returned identity before recording success. Missing stable DOM identity
still stops with `exact-message-identity-unavailable`.

Extension 0.10.4 preserves a separate controlled live boundary for exactly one
twice-confirmed sent message:

- A fresh signed intent whose reviewed preview is unchanged
- Exact `ARM UNSEND <code>` entry in the matching Instagram conversation
- A 90-second one-use arm scoped to that Instagram tab
- Exact thread, message ID, timestamp, content digest, and sent ownership
- Independent extension and PWA reservations before the first page control
- Durable consumption of the arm before dispatch to the isolated content driver
- Rejection of pre-existing dialogs/menus and changed or ambiguous rows
- One source-audited action control plus new, structurally bound interactive
  menu and confirmation surfaces with exact localized Unsend labels
- Frozen UTF-8 label allowlist with executable German `zurücknehmen` coverage
- Same-thread retained-node disconnection, stable-identity exact-absence proof,
  uncertain-outcome finalization, duplicate prevention, a finite extension
  daily ceiling, and token replay rejection

The actual production content script executes the successful three-control
chain in isolated Chromium. Deterministic coverage also includes authorization
ordering, duplicate/replay blocking, wrong-thread and identity-loss uncertainty,
unbound/noninteractive surface rejection, ownership confusion, and zero-control
pre-existing-dialog stop.
Authenticated rendered-message inspection and one-message mutation have not been run,
so issue #4 remains open and live settings remain disabled by default.

Visible message evidence is confined to an exact `/direct/t/<id>` route. Inbox,
nested direct routes, feed/profile pages, and a changed SPA route reject the
scan; leaving the thread also clears thread-derived evidence and dry-run state.

The visible thread-wide Unsend tool is a separate local workflow, not a way
around that one-message acceptance gate. It starts locked, requires the exact
`UNSEND ALL DMS` phrase to create a 15-minute tab arm, requires a second
permanent-action confirmation, and passes the expiry into the source-audited
runner. The arm also records the exact thread ID. The runner refuses a missing,
expired, or wrong-thread authorization, checks again before every control, and
accepts only one newly surfaced menu and confirmation candidate. The history
loader performs at most one bounded wake-up nudge per newly loaded page instead
of repeatedly repositioning a conversation that is already settled. The
successful local fixture proves a stale visible Unsend decoy receives zero
clicks and uses
only synthetic rows; no
authenticated message was removed.

## Extension

Complete:

- Manifest V3 package
- Exact-origin optional permission request
- One-time pairing with session-secret rotation
- Signed, time-limited requests
- Persistent nonce replay protection
- Separate read/action permissions
- Session-material payload rejection
- Read-only Instagram inspection
- Visible Instagram sidecar with isolated styling and keyboard toggle
- Draggable/lower-right-resizable desktop panel, fitted mobile sheet, reset, and
  persisted 55–100% translucency
- Guided Following and Followers scans with an explicit local Compare step
- Review-before-start Follow / Unfollow with a frozen exact-target draft
- Primary DM Unsend card with secondary read-only conversation evidence
- Visible follower/following capture with deduplication and import-compatible JSON
- Imported manual queue navigation and extension-local Complete/Skip state
- Sanitized signed dry-run history
- Sanitized pending live intent, one-use arm, and controlled account-action history
- Signed one-item Follow/Unfollow execution boundary, locked by default
- Read-only visible-DM evidence and conditional exact-identity no-click dry runs
- JSON exchange fallback
- Unpacked and ZIP build artifacts
- Executable production-script Follow, Unfollow, and one-message DOM acceptance
- Self-contained Tampermonkey build with the same Instagram engine, explicit
  DOM sandbox, tab-owned resumable account runs, default live lock,
  thread-bound 15-minute phrase authorization, and no-click fixture acceptance
- Disposable Chrome-for-Testing installation and signed read-only pairing gate in CI
- Seven-day, commit-named CI review artifact containing the exact tested
  extension ZIP and Tampermonkey file

## Desktop

Complete and verified on Windows:

- Hardened Electron shell
- App-specific data directory
- Bounded startup backups
- Additive state migration
- Unpacked package
- NSIS installer
- Installed-app launch
- Silent uninstall
- Retained local data policy

The macOS CI job builds DMG and ZIP artifacts, mounts the DMG, copies the app to
a disposable Applications directory, applies an ad-hoc hardened-runtime
signature with a QA-only entitlement file, launches the packaged renderer smoke
mode, removes the app, and uploads the verified artifacts. Release entitlements
omit the ad-hoc library-validation exception. Developer ID signing and
notarization remain a release-credential step.

## UI and browser quality

Implemented:

- Keyboard-reachable controls
- Visible focus styles
- View-navigation and relationship-tab focus restoration after whole-view rerenders
- Accessible selection labels
- Live status regions
- Responsive breakpoints
- Reduced-motion handling
- Instagram sidecar runtime fixture for profile, capture, queue, and message states
- Windowed queue and message lists
- Import progress and cancellation
- Confirmation and error states
- Interactive Chrome walkthrough of all seven primary PWA views using empty or synthetic local data
- Representative desktop screenshots for Overview, Action Queue, Messages, and Activity
- Deterministic Windows Chromium checks of all seven views at desktop, tablet, and mobile widths
- Nine visually reviewed, SHA-256-gated Windows baselines for Overview, Messages, and Settings
- Browser-delivered framing policy via loopback response headers with a console-clean meta CSP
- Truthful empty-message copy and assembled-markup regression coverage
- Production sidecar keyboard/accessibility-tree acceptance in isolated Chromium
- Real unpacked-extension read-only pairing in disposable Chrome for Testing
- Modular quiet-operator overlay source, V1/V2-to-V3 preferences, bounded SPA
  observation, target-aware collision handling, and a reviewed 40-scenario
  Windows overlay baseline with a non-updating CI gate

The dated walkthrough matrix and screenshots are in
[`docs/BROWSER_QA.md`](./BROWSER_QA.md).
The separate post-redesign overlay matrix and its evidence boundary are
in [`docs/OVERLAY_QA.md`](./OVERLAY_QA.md).

On 2026-08-08 the workflow update passed deterministic assembly, all 215
repository tests, production extension fixture acceptance, real disposable-
Chrome pairing, all nine PWA baselines, the 40-state overlay update/check, the
10,000-message ZIP benchmark, and the production dependency audit. The changed
Windows captures were inspected at full resolution. PR #14 CI run 67 then passed
the test, Windows-overlay, Windows-package, and macOS-package jobs and produced
all three artifact families before the change was merged to `main`.

A later read-only walkthrough in the operator's authenticated persistent Chrome
profile confirmed Tampermonkey injection, the default live lock, home/profile
context, and the rendered Followers dialog. It also exposed two userscript
context defects now corrected in the 0.10.4 candidate. The sanitized evidence
boundary is recorded in
[`docs/evidence/persistent-profile-2026-08-08/README.md`](./evidence/persistent-profile-2026-08-08/README.md).
No authenticated Instagram mutation was part of either matrix.

Pending acceptance:

- Install or update userscript/extension 0.10.4 in the operator's intended
  persistent Chrome profile and confirm that live actions start locked
- Repeat the non-armed Followers/Following and conversation-route walkthrough
  after the persistent profile has updated to 0.10.4
- Human screen-reader walkthrough
- PWA installation/pairing confirmation in the operator's persistent Chrome profile
- Native screenshot baselines for any additional release platform where they will be gated
- Apple Developer ID signing and notarization for a distributable macOS release

These pending checks prevent a claim of complete target-environment visual,
accessibility, or authenticated-selector acceptance.

## Security review

The production dependency audit is clean. The development dependency review,
including the documented Electron Builder advisory exception and its
repeatable verification gate, is in `docs/SECURITY_REVIEW.md`.

The controlled-action reviews reproduced bounded defects in target ownership,
dialog freshness, durable reservation, restored limits, exact-message live
control, packaging, discard-time cancellation, and secure capability issuance.
All are remediated with focused regressions; `docs/SECURITY_REVIEW.md` records no
surviving candidate in the 2026-08-08 diff-focused discovery review. Companion
source validation, all 215 repository tests, extension fixture acceptance, real
disposable-Chrome pairing, nine PWA baselines, the 40-image Windows overlay
check, the ZIP benchmark, and the production dependency audit pass. A coherent
commit and native installer/CI gates remain pending. Authenticated profile DOM was
inspected read-only in an earlier diagnostic; no authenticated account or DM
mutation has been run.
