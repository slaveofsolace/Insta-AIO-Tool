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

The extension performs read-only profile inspection and rejects live jobs. A controlled live batch of one has not been accepted and live execution remains disabled.

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

The extension cannot safely map export message IDs to rendered Instagram messages and therefore stops with `exact-message-identity-unavailable`. A controlled live batch of one has not been accepted.

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
- Read-only visible-DM evidence with exact-identity safe stop
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
- Accessible selection labels
- Live status regions
- Responsive breakpoints
- Reduced-motion handling
- Instagram sidecar runtime fixture for profile, capture, queue, and message states
- Windowed queue and message lists
- Import progress and cancellation
- Confirmation and error states

Pending acceptance:

- Interactive Chrome walkthrough of all primary views
- Authenticated Instagram walkthrough with the unpacked extension loaded
- Representative viewport screenshots
- Screenshot regression baselines
- Screen-reader walkthrough
- PWA installation confirmation in Chrome

These pending checks prevent a claim of complete browser visual acceptance.

## Security review

The production dependency audit is clean. The development dependency review,
including the documented Electron Builder advisory exception and its
repeatable verification gate, is in `docs/SECURITY_REVIEW.md`.
