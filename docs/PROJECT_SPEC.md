# Product specification

## Purpose

Insta AIO Tool provides a private, local workspace for understanding Instagram relationship exports, planning account reviews, migrating supported legacy data, and preparing exact message-removal reviews.

The product favors verifiable local data processing over unattended page automation.

## Supported data

### Current Instagram exports

- Original ZIP archives containing JSON data
- Split follower files
- Following files
- Split conversation message files

### Legacy sources

- Instagram Helper message data with `allMessagesItemsArray`
- SimpleInstaBot followed and unfollowed history
- Saved follower-checker output containing both non-mutual arrays
- Insta AIO workspace, snapshot, queue, and plan exports

Every import must preserve its source path or file name and produce explicit warnings or migration dispositions. Unsupported records must not disappear silently.

## Relationship requirements

The application shall:

- Normalize usernames and profile URLs
- Prefer stable account IDs when present
- Deduplicate accounts deterministically
- Store multiple dated snapshots
- Compare the active and preceding snapshot
- Identify mutuals and both non-mutual directions
- Identify new and lost followers
- Identify following additions and removals
- Report ID-backed username changes without false unfollow events

## Queue requirements

The queue shall:

- Support follow and unfollow review records
- Preserve status history and scheduling
- Apply a configurable waiting period
- Protect mutuals when enabled
- Protect whitelisted and preexisting accounts
- Prevent migration history from becoming a new action
- Prevent duplicates
- Allow pause, skip, completion, failure, and removal states
- Export a manual companion queue

## Reviewed account-action requirements

A reviewed job shall:

- Contain exact usernames and actions
- Exclude protected or non-actionable records
- Bind confirmation to a preview digest
- Default to dry-run mode
- Require explicit confirmation
- Support durable checkpoints and resume
- Revalidate profile-header ownership, relationship state, and protections immediately before execution
- Reserve live attempts transactionally in both the PWA and extension background
- Enforce finite daily limits and duplicate prevention after state restore and at reservation time
- Reject live confirmations older than ten minutes
- Require extension live execution to contain exactly one item
- Revalidate a tab-scoped one-use arm before ledger reservation
- Stop on uncertain identity, controls outside the verified profile header, any pre-existing dialog, an unbound confirmation, session expiry, challenge, rate limit, or action block
- Record before/after evidence and results

Live action flags default to false and the default live batch limit is one.

## Message requirements

The application shall:

- Normalize Meta and supported legacy message records
- Identify sender ownership from configured owner names and source metadata
- Filter by keyword, conversation, sender, and type
- Use windowed rendering for large result sets
- Allow selection only for messages identified as sent by the owner
- Preserve conversation ID, message ID, timestamp, type, sender, content digest, and preview
- Export a simple plan or reviewed job

## Reviewed DM requirements

A reviewed DM job shall:

- Block received, duplicate, or incomplete records
- Bind review to a digest and exact phrase
- Require a second destructive phrase for live mode
- Reconfirm exact conversation, exact message, and sender ownership
- Reserve a destructive attempt before the driver call
- Checkpoint every message
- Prevent duplicate attempts
- Verify removal after a driver call
- Stop on missing or ambiguous messages, changed content, session expiry, challenge, rate limit, or action block

No adapter may guess which rendered message corresponds to an export record.

## ZIP requirements

ZIP import shall:

- Operate locally
- Display a reviewed manifest before extraction
- Recursively identify supported JSON paths
- Preserve source paths
- Support stored and deflated entries
- Validate CRC and header agreement
- Reject encryption, unsafe paths, duplicate paths, multidisk archives, ZIP64, unsupported compression, and configured size-limit violations
- Support cancellation and progress
- Yield UI work during large imports
- Leave extracted file/folder import available

## Extension requirements

The bridge shall:

- Use a versioned schema
- Pair one exact origin through a one-time code
- Rotate the pairing secret during handshake
- Separate read and action permissions
- Sign every message
- Enforce age and nonce replay limits
- Reject session and authorization material
- Preserve JSON exchange as a fallback

The shipped extension shall keep live execution locked by default. A live
account action may be exposed only for one fresh signed reviewed item after an
exact Instagram-side action/username phrase creates a short-lived, tab-scoped,
one-use arm. The arm must be revalidated before the PWA ledger reservation. The
background must persist its independent reservation and consume the arm before
the page-control request. Dry-run routes shall never reach the page-control
activator. A live DM route shall remain separate from dry run and accept exactly
one twice-confirmed sent message only when exact rendered conversation,
message, timestamp, content digest, and ownership identity are available. It
shall require a fresh signed intent, tab-scoped 90-second arm, independent PWA
and extension reservations, one-use resolution token, new structurally bound
interactive menu/dialog controls, and revalidation before every destructive
stage. Layout ownership evidence must belong to the exact identity ancestor
chain. Success requires the same thread, disconnected retained target nodes,
exact absence, and independent stable identity coverage. Any missing, changed,
duplicate, stale, replayed, pre-existing, unbound, or noninteractive surface
shall safe-stop.

The Instagram sidecar shall:

- Be visible on Instagram without replacing the PWA
- Keep Instagram as the current-context surface and the PWA as the durable system of record
- Restore visible-list capture and imported manual-queue navigation from the Tampermonkey companion
- Merge repeated visible captures without auto-scrolling
- Expose current-page inspection and sanitized no-click run history
- Treat visible DM text as evidence only until exact message identity and ownership are available
- Remain keyboard reachable, responsive, and reduced-motion aware
- Keep live execution visibly locked unless the exact one-item arm is active

## Desktop requirements

The desktop shell shall:

- Package the existing PWA without replacing its contracts
- Use an app-specific local data directory
- Preserve data across approved upgrades
- Create bounded startup backups
- Restrict renderer capabilities
- Confine asset paths
- Deny unneeded permissions
- Provide Windows installer and macOS build configuration
- Document installation, removal, and rollback

## Accessibility and responsive requirements

- Primary workflows must be keyboard reachable
- Interactive controls need visible focus
- Status changes must use accessible live regions where appropriate
- Tables and windowed lists must expose position/count metadata
- Layouts must support desktop, tablet, and narrow mobile widths
- Reduced-motion preferences must be honored
- Destructive confirmations and errors must be understandable without color alone

## Privacy and security requirements

- No Instagram password collection or logging
- No Instagram session export
- No hidden remote analytics
- No imported-data upload
- No proxy rotation or fingerprint spoofing
- No challenge or CAPTCHA bypass
- No private endpoint reverse engineering
- No unreviewed destructive actions

## Release gates

A releasable change must satisfy:

```bash
pnpm run assemble
pnpm test
```

Changes affecting ZIP performance must also run:

```bash
pnpm run benchmark:zip
```

Changes affecting desktop delivery must build and smoke-test the target platform artifact. Changes affecting interactive UI behavior require browser verification at representative viewports before visual acceptance is claimed.
