# Component migration report

## Summary

| Source | Input family | Destination | Actionable after migration |
|---|---|---|---:|
| Instagram Helper | `allMessagesItemsArray` | Normalized messages and migration report | No |
| SimpleInstaBot | Followed/unfollowed history | Historical queue records and migration report | No |
| SimpleInstaBot | Photo history | Unsupported disposition | No |
| Follower checker | Two non-mutual arrays | Read-only relationship report | No |
| instagram-dm-unsender | Stateless userscript configuration | Migration report only | No |

The dispatcher in `src/adapters/legacy-components.js` identifies supported data without evaluating supplied source code.

## Companion workflow migration

Extension version 0.3.0 migrates the proven in-page workflow from the preserved
Tampermonkey companion into the Manifest V3 Instagram sidecar. The migration
retains the existing `insta-aio-visible-list`, `insta-aio-manual-queue`, and
`insta-aio-companion-state` shapes. It adds repeated capture deduplication,
current-page inspection, sanitized bridge dry-run history, and read-only DM
evidence. The userscript remains available as a fallback; it was not removed or
replaced.

The DM migration also adds a conditional exact-identity inspection boundary for
signed reviewed dry runs. It reuses only the supplied source's read-only
conversation-container and sent-layout observations, adds stable message ID,
timestamp, and content-digest requirements, and never opens an action menu.
This is deterministic no-click fixture coverage, not authenticated live Unsend
acceptance.

The independently reviewed account-action boundary now has an optional
production extension driver. It does not reuse SimpleInstaBot's Puppeteer,
session persistence, private routes, selector set, or retry automation. It
accepts one fresh reviewed item, requires an Instagram-side exact phrase and
short-lived one-use arm, consumes that arm before using the exact visible
control, and returns before/after observations to the PWA ledger. This does not
change the disposition of migrated SimpleInstaBot records: they remain
historical and non-actionable.

## Disposition rules

### Instagram Helper

- A valid source message becomes one normalized message.
- Reimported identity becomes a counted duplicate.
- Malformed records become counted skips with file/index warnings.
- Missing durable conversation identity becomes a manual-correction entry.
- Unsupported message types retain their source type and normalized generic content where possible.

### SimpleInstaBot

- A successful followed record becomes completed follow history.
- A successful unfollowed record becomes completed unfollow history.
- `failed: true` becomes failure history.
- `noActionTaken: true` becomes skipped history.
- Invalid usernames or timestamps become counted skips.
- Duplicate action/username/timestamp records become counted duplicates.
- Photo-history records become explicit unsupported dispositions.
- Every migrated queue item has `migrationOnly: true`.

### Follower checker

- Both result arrays are normalized and deduplicated.
- Invalid usernames are reported.
- Missing account or capture metadata is reported.
- The result remains `complete: false` and `actionable: false`.
- No snapshot or queue item is created.

### instagram-dm-unsender

- No action history, durable message identity, or checkpoint state exists to migrate.
- A report records the pinned release and requires manual creation of a reviewed job from imported message data.
- No rendered row is converted into a stored message target.
- A rendered row may satisfy a fresh signed dry run only when its stable message
  ID, exact timestamp, content digest, thread ID, and sent ownership match one
  reviewed item; otherwise it safe-stops and is not persisted as a target.

## State changes

Workspace schema version 3 adds:

- `migrationReports`
- `relationshipReports`
- `selectedQueueItemIds`
- `actionJobs`
- `actionLedger`
- `dmJobs`
- `dmLedger`
- `bridgePairing`
- Default-off live settings and batch limits

Migration is additive. Previous snapshots, messages, queue items, activity, warnings, and settings remain intact.

## Import application

`importFileRecords()` returns normalized data and source reports. The UI:

1. Classifies every selected record.
2. Applies supported migrations.
3. Stores normalized output.
4. Stores every report.
5. Displays source files, counts, warnings, and required corrections.
6. Leaves unsupported or incomplete data visible for review.

ZIP import uses the same record pipeline after archive inspection and worker extraction.

## Verification

Fixtures cover:

- Instagram Helper valid, duplicate, malformed, and missing-thread records
- SimpleInstaBot completed, failed, no-action, duplicate, malformed, and photo-history records
- Follower-checker duplicate, invalid, and incomplete output
- instagram-dm-unsender exact, missing, ambiguous, received, and confirmation-mismatch cases
- Cross-source dispatcher detection
- Additive schema migration

Run:

```bash
pnpm run assemble
pnpm test
```

The migration is considered successful only when record counts reconcile and the full suite passes.
