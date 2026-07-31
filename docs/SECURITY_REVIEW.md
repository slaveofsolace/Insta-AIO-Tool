# Security review

Last reviewed: 2026-07-30

## Application boundaries

The application is local-first and does not request Instagram credentials or
browser-session values. The PWA and desktop shell process user-selected data
locally. The optional extension uses exact-origin permissions, signed
short-lived requests, nonce replay protection, separate read/action
permissions, and explicit rejection of credential-like payload fields.

Live execution is disabled in the distributed extension. Reviewed account and
message jobs use no-click dry runs by default, exact confirmation material,
transactional reservations, durable checkpoints, and safe stops for ambiguous
state. Execution adapters revalidate the confirmed preview, current enable
setting, and current batch limit before entering a live path.

The extension background derives the requesting origin from Chrome's sender
metadata and rejects a mismatched page claim. The loopback development server
accepts only loopback Host headers and an explicit application-asset allowlist;
repository metadata, tests, documentation, and Git internals are not served.

Workspace exports can contain imported private data and bridge pairing
secrets. They are explicit user-created backups, not sanitized sharing
artifacts. Pairings should be revoked before a backup is shared.

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
