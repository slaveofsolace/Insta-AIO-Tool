# Security review

Last reviewed: 2026-08-02

## Application boundaries

The application is local-first and does not request Instagram credentials or
browser-session values. The PWA and desktop shell process user-selected data
locally. The optional extension uses exact-origin permissions, signed
short-lived requests, nonce replay protection, separate read/action
permissions, and explicit rejection of credential-like payload fields.

Live execution is locked by default. Reviewed account and message jobs use
no-click dry runs by default, exact confirmation material, transactional
reservations, durable checkpoints, and safe stops for ambiguous state.
Execution adapters revalidate the confirmed preview, current enable setting,
and current batch limit before entering a live path.

Each running PWA account or DM execution owns a matching `AbortController` and
an immutable reviewed-job identity. Discard aborts only that matching execution.
The adapters recheck cancellation after every awaited pre-dispatch inspection,
authorization, and reservation boundary. A cancellation after reservation but
before the page driver is durably finalized as `canceled`; the driver is not
called. Atomic checkpoint writers reject a job that no longer exists, so a late
callback cannot resurrect a discarded preview. Once a browser mutation has
already been dispatched it cannot be rolled back: the adapter completes its
postcondition check and records the observed durable outcome instead of
mislabeling it as canceled.

The distributed extension exposes controlled paths for exactly one reviewed
account action or sent-message Unsend. Both require signed action permission, a
fresh reviewed item, matching Instagram context, an exact Instagram-side
phrase, and a tab-scoped 90-second arm. The PWA revalidates the arm before
reserving its ledger. The background worker persists an independent
reservation, then consumes the one-use arm and signed intent before sending the
page-control request.

The account content driver requires a short-lived exact DOM token and one
relationship control owned by a verified profile header. It stops before any
click when a dialog is already visible and accepts only a newly surfaced
Unfollow dialog that names the reviewed username.

The separate reviewed-DM dry-run route requires the matching open direct
thread, one allowlisted
stable rendered message ID, exact timestamp and content digest, a unique
candidate, and sent ownership before recording `resolved-no-click`. Missing,
changed, duplicate, received, wrong-thread, and unknown-ownership states stop
without opening a menu. The route returns no raw message text and cannot reach
the live control activator. The controlled live consumer additionally requires
two fresh confirmations, exactly one item, exact arm-code entry on the matching
thread, an independent finite extension ledger, and a one-use row token. It
rejects pre-existing menus or dialogs, revalidates the same row before each
stage, accepts only new ARIA-bound interactive menu/dialog controls with exact
localized Unsend labels, and reports success only when the same thread remains
open, both retained exact nodes disconnect, the exact message is absent, and
other stable identity evidence remains available. Wrong-thread, identity-loss,
unbound-surface, noninteractive-text, and descendant-toolbar ownership fixtures
all fail closed.

Restored daily limits are finite and bounded. Capability replay, stale
confirmation, changed controls, wrong profiles or messages, duplicate attempts,
and ambiguous UI fail closed for both controlled paths.

The extension background derives the requesting origin from Chrome's sender
metadata and rejects a mismatched page claim. The loopback development server
accepts only loopback Host headers and an explicit application-asset allowlist;
repository metadata, tests, documentation, and Git internals are not served.
It sends framing protection as response headers. The PWA meta policy intentionally
omits `frame-ancestors` because browsers ignore that directive in meta-delivered
policies; deployed hosting must likewise supply framing policy as an HTTP header.

Workspace exports can contain imported private data and bridge pairing
secrets. They are explicit user-created backups, not sanitized sharing
artifacts. Pairings should be revoked before a backup is shared.

## Local-patch review closure

The 2026-08-01 controlled-action review found and remediated four low-severity
issues before release: profile controls were not structurally bound to the
reviewed header, an existing Unfollow dialog could be mistaken for a newly
opened target dialog, the extension lacked its own durable reservation, and
malformed restored daily limits could fail open. Regression tests exercise each
fixed boundary. The 2026-08-02 exact-message DM local-patch review reproduced
three bounded live-path defects and one packaging-gate hardening gap. All four
were remediated during the scan, every changed source file received a full-file
receipt, and no reportable finding survives in the current patch. The complete
routing recovery review also reproduced a low-severity discard race across the
PWA handler, asynchronous authorization/reservation, and checkpoint store. The
current patch closes all three layers and adds pre-dispatch, post-reservation,
post-dispatch, non-resurrection, and legitimate-control regressions. The complete
repository suite now passes 132 of 132 tests; extension packaging independently
runs the executable controlled-live safety subset before creating artifacts.

An authenticated Instagram Follow, Unfollow, or DM action has deliberately not
been run. It remains a separate operator acceptance gate requiring an exact
target, action, and explicit approval. The actual production content script now
passes bounded Follow, Unfollow, and one-message Unsend DOM chains in isolated
Chromium, including accessibility-tree and replay checks. A current authenticated
Instagram diagnostic found one verified `@instagram` profile header and one owned
Follow control without injecting the extension or clicking. Authenticated
rendered-message identity and user-selected mutation acceptance remain open.

## Dependency review

`pnpm audit --prod --audit-level high` reports no known vulnerabilities.
Runtime application code has no third-party production dependencies.

The full development audit reports
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
through Electron Builder's packaging graph. The advisory range is expressed as
`<=5.0.7`, so it also classifies the separately maintained 1.x and 2.x release
lines as affected.

The lockfile uses the latest major-compatible backports:

- `brace-expansion` 1.1.18
- `brace-expansion` 2.1.4
- `brace-expansion` 5.0.9

All three installed releases contain the aggregate expansion-length bound for
CVE-2026-14257 and enforce it at runtime. Replacing older-major consumers with
5.x would break their CommonJS API contract, so the repository keeps the
major-compatible releases. `pnpm run verify:dependencies`, which is also part of
`pnpm test`, verifies the exact lockfile resolutions, source markers, exported
API, and length-bound behavior. The full-audit alert remains documented until
the advisory metadata recognizes the backports.

## License review

The application is MIT licensed. Migrated source provenance and applicable
notices are recorded in `THIRD_PARTY_NOTICES.md`. Development dependencies use
permissive licenses, including MIT, ISC, BSD, Apache-2.0, Python-2.0, BlueOak,
0BSD, and dual-license variants.

## Release checks

Before publishing a release:

1. Install from the committed lockfile with `pnpm install --frozen-lockfile`.
2. Run `pnpm run assemble` and `pnpm test`.
3. Run `pnpm run qa:browser:check` on a platform with a committed baseline.
4. Run `pnpm audit --prod --audit-level high`.
5. Run the ZIP-import benchmark.
6. Build and smoke-test the target installer on its native operating system.
7. Review the generated artifacts and release notes for private data.
