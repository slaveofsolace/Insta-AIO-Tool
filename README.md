# Insta AIO Tool

Insta AIO Tool is a local-first workspace for reviewing Instagram relationship exports, maintaining follow/unfollow queues, and examining message exports. Imported data stays in the browser or desktop app unless the user explicitly exports a file.

The project includes:

- An installable progressive web app with offline support
- Direct, local Instagram ZIP import with a reviewed manifest
- Relationship snapshots, comparisons, protections, and queue history
- Message search, sent-message classification, and reviewed unsend jobs
- Source-specific migrations for Instagram Helper, SimpleInstaBot, and saved follower-checker results
- A read-only Tampermonkey companion
- A signed, origin-paired Manifest V3 extension bridge
- Windows and macOS Electron packaging configuration

## Safety model

Live account changes and DM removal are disabled by default. The PWA requires exact batch previews and confirmation phrases. The companion extension currently exposes read-only inspection and true no-click dry runs; it rejects every live job.

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

Dry runs inspect the current profile without clicking. The adapter safe-stops on the wrong profile, ambiguous controls, session expiry, challenges, rate limits, action blocks, or changed protection state. The action ledger reserves a live attempt before any driver call and prevents duplicate or over-limit execution.

The shipped extension does not expose live clicks. JSON export remains available for review and controlled adapter development.

## Reviewed DM jobs

Only messages classified as sent by the configured owner can enter a reviewed unsend job. Each item preserves conversation ID, message ID, timestamp, sender ownership, and a content digest.

Live-mode data structures require:

- Complete batch review
- A second destructive confirmation
- Exact conversation and message resolution
- Immediate sender-ownership revalidation
- A durable reservation before the destructive call
- Post-action removal verification

The browser extension safe-stops when an Instagram export message ID cannot be matched to one exact rendered message. It never guesses.

## Companion extension

Build the extension:

```bash
pnpm run build:extension
```

Load `dist/extension` as an unpacked extension, or install the generated ZIP through the appropriate browser-managed workflow.

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
pnpm run benchmark:zip
```

The automated suite covers imports, migrations, archive integrity and limits, action/DM reviews, no-click execution, transactional ledgers, bridge signing and replay protection, extension permissions, desktop hardening, state migration, service-worker assets, and large-list windowing.

Windows packaging has been exercised through unpacked launch, silent NSIS install, installed-app launch, and silent uninstall. macOS artifact production and interactive Chrome visual acceptance must be performed on their target environments before a signed release.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
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
