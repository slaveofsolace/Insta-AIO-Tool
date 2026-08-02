# Delivery status

## Data integrations

| Scope | Status | Evidence |
|---|---|---|
| Instagram Helper messages | Complete | Source-pinned migration, fixtures, reports, tests |
| SimpleInstaBot history | Complete | Source-pinned migration, fixtures, reports, tests |
| Follower-checker output | Complete as read-only partial report | Independent parser, non-actionable contract, tests |
| instagram-dm-unsender | Complete as safe adapter behavior and stateless report | Supplied artifact hash, exact-candidate tests, documentation |

The historical browser executors are not included.

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
- Before/after evidence
- Safe-stop classification

Extension 0.3.0 now implements the production-controlled account boundary:

- Fresh signed live intent with action permission
- Exactly one reviewed account item
- Exact matching Instagram profile header and relationship control ownership
- Exact `ARM FOLLOW @username` or `ARM UNFOLLOW @username` phrase
- A 90-second one-use arm scoped to the Instagram tab
- Authorization revalidation before PWA ledger reservation
- Independent extension-side reservation plus durable arm consumption before the page-control request
- Short-lived exact DOM resolution token, pre-existing-dialog rejection, target-named Unfollow confirmation, and after-state verification
- Cross-job duplicate queue-item and same-day action prevention

Automated Follow and Unfollow fixtures pass, including token replay, suggested-account isolation, pre-existing-dialog rejection, extension-side reservation, and ambiguous-control safe stops. A real authenticated batch of one has not yet been accepted, so issue #3 remains open and account live execution remains locked by default.

## Reviewed DM removal

The DM core is complete:

- Sent-only selection
- Exact conversation/message/timestamp/content identity
- Review and destructive confirmations
- Transactional reservation
- Duplicate prevention
- Durable checkpoints and resume
- Post-action removal verification
- Source-specific localized Unsend matching

The extension now conditionally maps one reviewed message in a true no-click dry
run when the direct-thread ID, stable rendered message ID, exact timestamp,
content digest, and sent ownership all match uniquely. The background rechecks
the returned identity before recording success. Missing stable DOM identity still
stops with `exact-message-identity-unavailable`; current authenticated Instagram
DOM acceptance and a controlled live batch of one have not been completed. Live
Unsend remains absent.

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
- Visible follower/following capture with deduplication and import-compatible JSON
- Imported manual queue navigation and extension-local Complete/Skip state
- Sanitized signed dry-run history
- Sanitized pending live intent, one-use arm, and controlled account-action history
- Signed one-item Follow/Unfollow execution boundary, locked by default
- Read-only visible-DM evidence and conditional exact-identity no-click dry runs
- JSON exchange fallback
- Unpacked and ZIP build artifacts

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

macOS DMG/ZIP configuration is present. Artifact production, signing, installation, and removal require validation on macOS.

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

The dated walkthrough matrix and screenshots are in
[`docs/BROWSER_QA.md`](./BROWSER_QA.md).

Pending acceptance:

- Authenticated Instagram walkthrough with the unpacked extension loaded
- Human screen-reader walkthrough
- PWA installation confirmation in Chrome
- Native screenshot baselines for any additional release platform where they will be gated

These pending checks prevent a claim of complete browser visual acceptance.

## Security review

The production dependency audit is clean. The development dependency review,
including the documented Electron Builder advisory exception and its
repeatable verification gate, is in `docs/SECURITY_REVIEW.md`.

The controlled-action local-patch scan found four low-severity defects and all
four are remediated with focused regressions. The follow-up exact-message DM
local-patch scan found no reportable security issue. Deterministic assembly, the
full 103-test suite, companion source validation, the unpacked/ZIP extension
build, and the nine-image Windows browser baseline check pass. Authenticated
account and DM DOM acceptance remain explicitly not run.
