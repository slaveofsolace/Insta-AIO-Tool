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

The distributed extension exposes a controlled account-action path only. It
requires a signed action-permission request, one fresh reviewed item, a matching
Instagram profile and relationship, an exact action/username phrase, and a
tab-scoped 90-second arm. The PWA revalidates the arm before reserving its
ledger. The background worker persists an independent reservation, then
consumes the one-use arm and signed intent before sending the page-control
request. The content script requires a short-lived exact DOM token and one
relationship control owned by a verified profile header. It stops before any
click when a dialog is already visible and accepts only a newly surfaced
Unfollow dialog that names the reviewed username. Restored daily limits are
finite and bounded. Capability replay, stale confirmation, changed controls,
wrong profiles, duplicate attempts, and ambiguous UI fail closed. Live DM
removal remains unavailable.

The extension also exposes a separate reviewed-DM inspection route that is
dry-run-only. It requires the matching open direct thread, one allowlisted
stable rendered message ID, exact timestamp and content digest, a unique
candidate, and sent ownership before recording `resolved-no-click`. Missing,
changed, duplicate, received, wrong-thread, and unknown-ownership states stop
without opening a menu. The route returns no raw message text and has no live
DM action consumer.

The extension background derives the requesting origin from Chrome's sender
metadata and rejects a mismatched page claim. The loopback development server
accepts only loopback Host headers and an explicit application-asset allowlist;
repository metadata, tests, documentation, and Git internals are not served.

Workspace exports can contain imported private data and bridge pairing
secrets. They are explicit user-created backups, not sanitized sharing
artifacts. Pairings should be revoked before a backup is shared.

## Local-patch review closure

The 2026-08-01 controlled-action review found and remediated four low-severity
issues before release: profile controls were not structurally bound to the
reviewed header, an existing Unfollow dialog could be mistaken for a newly
opened target dialog, the extension lacked its own durable reservation, and
malformed restored daily limits could fail open. Regression tests exercise each
fixed boundary. The 2026-08-02 exact-message DM local-patch review completed with
full diff coverage and no reportable finding. The complete repository suite now
passes 96 of 96 tests.

An authenticated Instagram Follow, Unfollow, or DM action has deliberately not
been run. It remains a separate operator acceptance gate requiring an exact
target, action, and explicit approval. The production overlay passed desktop,
mobile, messages, keyboard, and focus-restoration checks against the local
synthetic fixture in Chrome. The real Instagram profile checked during this
review was logged out and did not have the unpacked extension installed, so
authenticated selector and rendered-message identity acceptance remain open.

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
3. Run `pnpm audit --prod --audit-level high`.
4. Run the ZIP-import benchmark.
5. Build and smoke-test the target installer on its native operating system.
6. Review the generated artifacts and release notes for private data.
