# Component integration audit

Audit date: 2026-08-08

Integration means that a source was reviewed, its applicable data was mapped, source-specific code was implemented, fixtures were tested, and behavior was documented. A source's historical browser executor is not considered integrated merely because its data migration is supported.

## Status

| Component | Reviewed source | Implemented scope | Test coverage | Integration claim |
|---|---|---|---|---|
| Instagram Helper | Revision `5853d856a18a395aab7c8b8c7e3633175e23ddaf` | Message-data migration | Valid, duplicate, malformed, and incomplete records | Message migration integrated |
| SimpleInstaBot | Revision `5eed7e4ac7ac7db6922eb9e5ed6db36ad9f18fca` | Follow/unfollow history migration | Success, failure, no-action, duplicate, malformed, unsupported photo history | History migration integrated |
| Follower checker | Revision `3876d9a67bc8255a79990a1616c20cae296d7194` | Read-only partial relationship report | Duplicate, invalid, and incomplete metadata | Partial-report migration integrated |
| instagram-dm-unsender | Tag `v0.7.2`, revision `a8d7b4d9b76967f54cd9890fc3b1e0bb9c1b8d6a`, supplied SHA-256 `2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C` | Exact-candidate adapter and stateless migration report | Exact, missing, ambiguous, received, confirmation mismatch | Safe adapter behavior integrated; mass loop excluded |

## Instagram Helper

### Runtime and entry points

The archived project is a TypeScript browser script compiled to `dist/InstagramHelper.js`. Its primary entry constructs `InstagramHelper` inside an authenticated Instagram page. It also includes a standalone message-data viewer and a Windows launcher that weakens browser security.

The launcher and security changes are not used.

### Dependencies and session behavior

The helper depends on the active Instagram page and reads browser-managed session values before issuing credentialed requests. It does not ask for a password, but it directly accesses session state. None of that state enters Insta AIO.

### Selectors and network behavior

The source uses private direct-message routes, fixed application identifiers, browser storage, and generic class-based clicks. These behaviors are obsolete or outside the product safety boundary and were excluded.

### Data contract

Relevant exports contain:

```js
{
  myUserId,
  allMessagesItemsArray: [
    { item_id, user_id, item_type, timestamp }
  ],
  usersChatParticipants: [
    { pk, username, profile_pic_url, full_name }
  ]
}
```

The source omits a durable conversation identifier in some exports and may use millisecond or microsecond timestamps.

### Migration

`src/migrations/instagram-helper.js`:

- Validates the top-level arrays
- Maps participant IDs to normalized accounts
- Preserves message identity and source metadata
- Converts supported items to the current message contract
- Generates deterministic fallback identity when required
- Reports duplicates, skips, warnings, and manual conversation corrections

The migration never invokes the source's private delete route.

## SimpleInstaBot

### Runtime and entry points

The reviewed monorepo contains:

- A Node/TypeScript browser library under `packages/instauto`
- An Electron/React desktop application under `packages/simpleinstabot`
- A JSON persistence layer used for action history

The programmatic library entry is `Instauto(db, page, options)`. The desktop main process exposes application operations to its renderer.

### Dependencies and session behavior

The source uses Puppeteer-based browser control, desktop state storage, persisted browser-session files, automated login options, and browser signature rotation. Insta AIO does not reuse these behaviors.

### Selectors and network behavior

The source contains text/ARIA selectors for relationship controls, DOM click paths, legacy GraphQL identifiers, embedded profile-data reading, and private relationship routes. They were useful only for identifying failure modes and are not treated as current Instagram truth.

The source's `dryRun` mode omits final relationship-changing clicks but still navigates, performs network requests, and may click setup dialogs. It therefore does not satisfy Insta AIO's no-click contract.

### Data contract

Follow and unfollow histories are JSON arrays:

```js
[
  {
    username,
    time,
    failed,
    noActionTaken
  }
]
```

Photo history uses `{ username, href, time }` and is outside the current contract.

### Migration

`src/migrations/simpleinstabot.js`:

- Classifies followed, unfollowed, and photo-history paths
- Normalizes usernames and timestamps
- Maps successful records to completed history
- Maps `failed` records to failure history
- Maps `noActionTaken` records to explicit skips
- Deduplicates by source action, username, and timestamp
- Reports invalid entries and unsupported photo history
- Marks every migrated queue record as historical so it cannot become actionable

No Puppeteer executor, credential workflow, browser-session file, private route, or retry loop is included.

## Follower/following checker

### Runtime and entry point

The source is one dependency-free script designed for execution in an authenticated page console. It resolves an account and recursively requests relationship pages.

### Session and network behavior

The script relies on the existing browser session, a fixed application header, private search and relationship routes, and pagination tokens. These behaviors were excluded.

### Output contract

```js
{
  PeopleIDontFollowBack: [username, ...],
  PeopleNotFollowingMeBack: [username, ...]
}
```

The result has no mutual list, stable IDs, source account, capture timestamp, or completeness proof. It is not a full relationship snapshot.

### Migration and license boundary

No explicit source license was identified, so its implementation was not copied.

`src/migrations/follower-checker.js` independently:

- Recognizes the two output arrays
- Normalizes and deduplicates usernames
- Preserves the values as a partial report
- Reports invalid records and missing metadata
- Prevents the report from creating a snapshot or queue action

## instagram-dm-unsender 0.7.2

### Runtime and source completeness

The supplied file is a userscript bundle with an embedded source map. The source
map identifies 21 original modules. Normalized comparison against revision
`a8d7b4d9b76967f54cd9890fc3b1e0bb9c1b8d6a` matched every embedded source to its
upstream `v0.7.2` file (21/21).

The script has no external dependencies, no granted userscript APIs, and no persistent job database.

### Selectors and behavior

The source locates the DM list through pagelet and role selectors, finds a scrollable list, treats right-aligned message rows as sent messages, opens an action control, matches localized Unsend text, and confirms through a dialog. It loops through rendered rows with short randomized delays.

### Safety findings

The source cannot map an exported conversation/message ID to one durable rendered record. Visual alignment is insufficient ownership proof. A generic first dialog button is also insufficient destructive confirmation. The broad loop has no durable checkpoint, reviewed batch digest, second confirmation, transactional duplicate guard, or immediate stop policy for every uncertain state.

### Migration and adapter

`src/migrations/instagram-dm-unsender.js` produces a stateless report because the source contains no queue or checkpoint data to migrate.

`src/adapters/instagram-dm-unsender.js` independently retains only:

- Direct-thread identity parsing
- Exact candidate matching across conversation ID, message ID, timestamp, and content digest
- Sender-ownership verification
- Exact localized Unsend option matching
- Reinspection before opening the menu
- Matching confirmation identity
- Post-action result validation

Missing, duplicate, received, changed, or ambiguous candidates safe-stop. The mass loop is not included.

The extension implements a no-click DOM boundary for signed reviewed DM jobs.
It borrows the source's conversation-container and sent-layout observations but
requires a matching direct-thread ID, an allowlisted stable message-ID
attribute, exact timestamp, exact content digest, and one sent candidate. Dry
run never invokes hover, menu, dialog, loop, or Unsend paths. Fixture coverage
proves exact, missing, changed, received, wrong-thread, and ambiguous outcomes.

Extension 0.10.3 also independently migrates the source-audited one-message UI
sequence behind a stronger capability boundary. It retains the exact row's
source-backed hover and action-control patterns plus exact localized Unsend
labels. Those labels now live in one frozen UTF-8 module, normalize with NFKC,
and include an executable `zurücknehmen` regression. The implementation excludes the source's mass loop, automatic retries, randomized
batch delays, stale-overlay dismissal, generic first-dialog-button selection,
and descendant-wide ownership guesses. One fresh twice-confirmed item creates a signed
intent and short-lived tab arm. Independent ledgers reserve before the first
page control, the arm and token are consumed once, the same row is revalidated
before every destructive stage, pre-existing or unbound surfaces reject
execution, and same-thread removal requires retained-node disconnection plus
stable identity coverage. Authenticated Instagram DOM and live-action acceptance
remain open.

## Shared migration contract

Every migration returns:

```js
{
  schemaVersion: 1,
  source,
  sourceRevision,
  sourceFiles: [],
  inputCount,
  importedCount,
  duplicateCount,
  skippedCount,
  warnings: [],
  manualCorrections: []
}
```

Rules:

- Individual record counts must reconcile.
- Every skip includes a reason and source location.
- Duplicates are counted.
- Unsupported families are reported.
- State changes are additive.
- Existing snapshots, queue records, messages, settings, and activity are preserved.
- Source labels are portable and never expose machine-specific paths.

## Live execution boundary

The reviewed sources do not supply a safe live executor that satisfies current
contracts. The independent action and DM adapters implement transaction
ordering, durable checkpoints, no-click dry runs, and safe stops.

Extension 0.10.3 includes independently implemented controlled account and DM
drivers;
it does not copy the SimpleInstaBot executor. A fresh signed job of exactly one
item creates a sanitized intent. The Instagram sidecar requires the matching
profile, relationship, action/username phrase, and a 90-second one-use arm. The
PWA revalidates that arm before reserving the ledger; the extension consumes it
before activating one exact Follow control or the exact Following plus
Unfollow-confirmation controls. Token replay and ambiguous controls fail closed.

This is implementation and deterministic fixture coverage, not authenticated
live acceptance. Account live acceptance cannot be claimed until the operator
selects a batch of one and exact before/after plus durable ledger evidence is
captured in the intended authenticated environment. DM live acceptance also
cannot be claimed until the operator selects exactly one twice-confirmed sent
message and exact row-removal plus both durable-ledger records are captured in
the intended authenticated environment.
