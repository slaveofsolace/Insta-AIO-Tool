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

Extension 0.9.0 preserves the production-controlled one-item account boundary:

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

Extension 0.9.0 preserves a separate controlled live boundary for exactly one
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

The visible thread-wide Unsend tool is a separate local workflow, not a way
around that one-message acceptance gate. It starts locked, requires the exact
`UNSEND ALL DMS` phrase to create a 15-minute tab arm, requires a second
permanent-action confirmation, and passes the expiry into the source-audited
runner. The arm also records the exact thread ID. The runner refuses a missing,
expired, or wrong-thread authorization, checks again before every control, and
accepts only one newly surfaced menu and confirmation candidate. Its successful
local fixture proves a stale visible Unsend decoy receives zero clicks and uses
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
- Draggable/two-corner-resizable desktop panel, fitted mobile sheet, reset, and
  persisted 55–100% translucency
- Explicit Follower checker, Follow / Unfollow, and DM Unsend surfaces
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
  observation, target-aware collision handling, and a reviewed 39-scenario
  Windows overlay baseline with a non-updating CI gate

The dated walkthrough matrix and screenshots are in
[`docs/BROWSER_QA.md`](./BROWSER_QA.md).
The separate post-redesign overlay matrix and its evidence boundary are
in [`docs/OVERLAY_QA.md`](./OVERLAY_QA.md).

On 2026-08-05 assembly, the 186-test repository suite, production extension
fixture acceptance, real Chrome pairing, the nine-state PWA baseline check, the
39-state overlay update/check, and the ZIP benchmark passed in the guarded
recovery worktree. No authenticated Instagram mutation was part of that matrix.

Pending acceptance:

- Authenticated Instagram walkthrough with the unpacked extension loaded
- Human screen-reader walkthrough
- PWA installation/pairing confirmation in the operator's persistent Chrome profile
- Native screenshot baselines for any additional release platform where they will be gated

These pending checks prevent a claim of complete target-environment visual,
accessibility, or authenticated-selector acceptance.

## Security review

The production dependency audit is clean. The development dependency review,
including the documented Electron Builder advisory exception and its
repeatable verification gate, is in `docs/SECURITY_REVIEW.md`.

The controlled-action local-patch scan found four low-severity defects and all
four are remediated with focused regressions. The follow-up exact-message DM
local-patch scan reproduced three bounded live-path defects plus one packaging
hardening gap; all were remediated and no reportable finding survived.
The follow-up recovery patch also closes discard-time execution races, fails
closed when secure capability entropy is unavailable, and covers the reviewed
localized labels as valid UTF-8. Deterministic assembly, the full 138-test
suite, companion source validation,
the unpacked/ZIP extension build, and the nine-image Windows browser baseline
check pass. Authenticated account-profile DOM structure has been inspected
read-only; no authenticated account or DM mutation has been run.

Those recorded green results predate the uncommitted overlay recovery QA work.
They remain valid historical evidence for their original revision, but do not
verify the redesigned overlay or its new screenshot matrix.
