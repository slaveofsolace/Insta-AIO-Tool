# Architecture

## System shape

Insta AIO Tool is a local-first PWA with three optional delivery surfaces:

1. A read-only Tampermonkey companion for visible-list capture and manual queue navigation
2. A Manifest V3 extension with an Instagram sidecar, signed inspection requests, and a controlled one-item account-action boundary
3. A hardened Electron shell for Windows and macOS packaging

The stable data model remains independent of Instagram page markup. Imports, migrations, reviews, protections, checkpoints, and ledgers are implemented as browser-neutral modules.

## Runtime components

### PWA

The PWA owns:

- Offline ZIP and extracted-file import
- Account normalization and deduplication
- Relationship snapshots and comparisons
- Queue scheduling and protection checks
- Message normalization and filtering
- Reviewed account-action and DM job creation
- Local persistence, backup export, and activity history
- Extension pairing and signed request transport

`src/app-loader.js` combines the deterministic source fragments under `src/app.parts/` in memory. `pnpm run assemble` produces the equivalent ignored `src/app.js` file for inspection.

### Import pipeline

`src/core/zip.js` inspects ZIP metadata before extraction. It validates central/local header agreement, CRC values, archive size limits, path safety, compression method, encryption flags, and unsupported ZIP features. `src/workers/zip-import-worker.js` performs extraction away from the UI thread and reports progress and cancellation.

`src/core/import-classification.js` identifies supported records. `src/core/imports.js` routes records to the current Instagram parsers or source-specific migrations. Every source migration returns explicit imported, duplicate, skipped, unsupported, and manual-correction dispositions.

### Relationship engine

`src/core/accounts.js` normalizes account identity.

`src/core/snapshots.js` creates dated follower/following snapshots and calculates mutuals, non-mutual relationships, new followers, lost followers, following changes, and ID-backed renames.

`src/core/queue.js` schedules follow/unfollow reviews and enforces mutual, whitelist, preexisting-follow, status, and migration-history protections.

### Reviewed account actions

`src/core/action-jobs.js` creates immutable previews with exact usernames, actions, and a digest-bound confirmation phrase.

`src/adapters/reviewed-action-adapter.js` implements:

- Session inspection
- Exact-profile and relationship validation
- True no-click dry runs
- Immediate protection revalidation
- Ten-minute live-confirmation freshness validation
- One-use extension authorization revalidation before ledger reservation
- Transactional reservation before live driver calls
- Abort-aware revalidation after every awaited pre-driver boundary
- Matching-job discard cancellation with canceled reservation finalization
- Before/after evidence
- Pause, resume, stop, and durable per-item checkpoints
- Safe stops for ambiguous or blocked states

`src/core/action-ledger.js` and `src/adapters/indexeddb-action-ledger.js` enforce duplicate and finite daily-limit rules. Restored limits are normalized before use. A checkpoint can update only an existing reviewed job; a callback arriving after discard fails closed instead of recreating the job. The extension background also keeps a bounded, independent reservation mirror with a conservative per-action daily ceiling so the privileged page-control boundary never depends only on a cooperative PWA caller.

### Reviewed DM actions

`src/core/dm-jobs.js` preserves exact conversation ID, message ID, timestamp, ownership, and content digest for each selected message. Live jobs require both review and destructive confirmations.

`src/adapters/reviewed-dm-adapter.js` resolves the conversation and message immediately before a driver call, reserves the attempt transactionally, checkpoints after every item, and verifies removal. Matching discard cancellation is rechecked after every awaited pre-Unsend boundary. A post-reservation cancellation is finalized as `canceled` before any driver call; cancellation after dispatch retains the postcheck and real outcome semantics because Unsend cannot be recalled.

`src/adapters/instagram-dm-unsender.js` adapts safe concepts from the reviewed 0.7.2 source. It accepts only one exact sent-message candidate, one exact localized Unsend option, and a matching confirmation record. It does not copy the source's broad loop or heuristic mass-selection behavior.

The extension's signed DM dry-run route is narrower than the adapter's live
boundary. `content-instagram.js` requires a matching direct-thread ID, one
rendered row with an allowlisted stable message-ID attribute, an exact timestamp
and content digest, and proven sent ownership. The background independently
rechecks every returned identity field before recording `resolved-no-click`.
No message menu or page-control method is reachable from this dry-run route.
Missing or ambiguous identity safe-stops, and authenticated DOM acceptance
remains pending.

### Extension bridge

`src/core/bridge-protocol.js` defines a versioned signed-message format.

Pairing uses:

- An exact HTTP/HTTPS origin
- A 12-byte pairing identifier
- A 32-byte one-time secret
- Separate read and action permissions
- A two-nonce handshake that derives a new session secret

Every request includes a timestamp, request ID, nonce, type, payload, and HMAC-SHA-256 signature. Verification enforces origin, permission, maximum age, replay protection, payload size, and session-material rejection.

The extension background worker serializes bridge requests and persists its replay cache. `action-labels.js` loads first and exposes one frozen normalization/allowlist surface for the reviewed relationship and localized Unsend labels. The Instagram inspector then exposes read-only page inspection, and the isolated **Field Desk** sidecar renders in a closed shadow root after the inspector is available. The deterministic browser fixture explicitly opts into an open root for QA only.

The sidecar owns only browser-local field state:

- A bounded visible-list capture draft using the existing `insta-aio-visible-list` contract
- An imported `insta-aio-manual-queue` and extension-local completion/skip updates
- Read-only visible-message evidence plus conditional stable-identity DM dry runs
- Sanitized pairing and recent dry-run summaries returned by the background worker
- A sanitized pending one-item account intent and 90-second one-use arm

The PWA remains the system of record for imports, snapshots, comparisons,
protections, reviewed jobs, ledgers, and backups. The background worker never
returns pairing secrets, signatures, or nonces to the Instagram sidecar.

Account dry runs never reach a page-control method. A live account job must be
fresh, signed with action permission, contain exactly one item, and match an
Instagram-side intent. The operator must type the exact action and username on
the matching profile. The resulting arm expires after 90 seconds. The
background worker persists its own reservation and consumes the arm before it
sends the single execution request, then finalizes that reservation after the
result. The content script binds the request to a short-lived exact DOM token,
requires one relationship control inside one header that independently names
the pathname account, stops before any click when a dialog is already visible,
and accepts only a newly surfaced Unfollow dialog that names the reviewed
username. It then verifies the resulting relationship. The PWA independently
rechecks the arm before its transactional reservation and checkpoints the
before/after result. DM dry runs use only the separate stable-identity inspector.
The controlled DM path accepts exactly one twice-confirmed sent-message item,
uses a separate signed intent and 90-second tab arm, reserves independent PWA
and extension ledgers, consumes the arm before the isolated page driver, and
revalidates the exact row before its action menu, localized Unsend option, and
localized confirmation. The menu and dialog must be new, interactive, and
structurally related to their triggering controls. Success requires the same
thread, both retained exact nodes disconnected, the exact candidate absent,
and another stable message identity still available; otherwise both callers
preserve an uncertain outcome. Authenticated selector and live-action acceptance
remain external gates.

Profile and message resolution capabilities require a valid Web Crypto
`randomUUID` or nonzero `getRandomValues` result. A missing, throwing, or
non-producing secure random source returns `secure-random-unavailable`, stores
no token, and therefore cannot reach either controlled page driver.

### Tampermonkey companion

The userscript reads only currently rendered anchors and manages a separate manual queue in userscript storage. It performs profile navigation only after the user selects the control and never invokes Instagram action buttons.

### Desktop shell

`desktop/main.mjs` serves packaged assets through a confined custom protocol. The renderer uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- Denied permission requests
- Navigation and new-window restrictions
- A restrictive content policy

Electron's app-specific Chromium directory stores the same IndexedDB data used by the PWA. Before the renderer opens, the shell copies available storage directories into a timestamped backup and keeps the five newest backups.

## State model

The current workspace schema is version 3:

```text
snapshots
queue
messages
selectedMessageIds
selectedQueueItemIds
migrationReports
relationshipReports
actionJobs
actionLedger
dmJobs
dmLedger
bridgePairing
settings
activity
importWarnings
```

Migrations are additive. Missing collections receive safe defaults, unknown extra fields remain available through object spread, and live settings default to disabled with batch limits of one.

IndexedDB is the primary store. LocalStorage is a fallback for environments without usable IndexedDB. Atomic ledger updates use one IndexedDB read/write transaction or a serialized LocalStorage fallback. Reviewed-job checkpoint updates are update-only transactions and reject missing jobs, preventing stale asynchronous writers from undoing discard.

## Trust boundaries

- Imported archives and JSON are untrusted and validated before normalization.
- Imported strings are escaped before HTML rendering.
- Instagram credentials and session material do not enter the PWA.
- The extension pairing secret authenticates local bridge messages only.
- The extension may inspect an existing Instagram tab but does not export its session state.
- A live account capability is scoped to one signed job item, one Instagram tab, one username/action pair, and a 90-second expiry; it is consumed before page mutation.
- Destructive drivers cannot mutate application history directly; they return observations and results that the core validates and checkpoints.
- Exported workspaces and reviewed jobs contain private account/message metadata and should be handled as sensitive personal files.

## Offline behavior

The service worker precaches the shell, UI fragments, core modules, adapters, migrations, and ZIP worker. Imported data is never uploaded by the application. A service-worker cache version change removes older application caches during activation without deleting IndexedDB workspace data.
