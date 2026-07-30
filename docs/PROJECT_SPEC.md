# Unified Instagram Account Management Suite — project specification

## Objective

Combine the user's three existing tools into one local-first application with a shared interface, storage model, history, import/migration layer, queue system, and audit log.

The product must support three domains:

1. Follow/unfollow review scheduling
2. Follower/following comparison and unfollower history
3. Direct-message data viewing, selection, and reviewed unsend planning

Existing implementations should be adapted where source is available. Working code should not be rewritten solely for appearance. Missing or unstable integrations must be isolated behind adapters and labeled `Codex-Handoff` until completed and verified.

## Delivery architecture

### Current delivery

- Installable local PWA
- Tampermonkey manual companion
- Zero runtime dependencies
- IndexedDB persistence with LocalStorage fallback
- Node built-in test suite

### Future delivery options

- Browser extension with an explicit message bridge
- Electron or Tauri desktop package
- SQLite-backed multi-account workspace

## Component A — relationship snapshots

### Inputs

- Meta followers JSON
- Meta following JSON
- Insta AIO snapshots
- Read-only visible-DOM captures
- Future approved collection adapters

### Required outputs

- Followers
- Following
- Mutuals
- Accounts not following the user back
- Accounts the user does not follow back
- New followers
- Detected unfollowers
- Newly followed accounts
- Accounts no longer followed
- Username changes when stable IDs are available

### Historical rules

- Preserve every snapshot with capture time and source.
- Compare a selected snapshot with the immediately prior snapshot.
- Do not silently overwrite historical snapshots.
- Use stable user IDs when available.
- When no stable ID exists, document that rename/deletion/suspension distinctions may be uncertain.

## Component B — follow/unfollow review queue

### Follow target creation

Allow targets to be added from:

- Manual username input
- Imported lists
- Relationship views
- Existing tool migrations

### Follow workflow

1. Create a pending follow record.
2. Require the user or future executor to report completion.
3. Record exact completion time.
4. Place the account in waiting status.
5. Reevaluate after the configured waiting period.
6. If the account follows back, protect it.
7. If no follow-back is present, create a ready unfollow-review item.

### Protections

Never produce an actionable unfollow item for:

- Whitelisted accounts
- Protected preexisting follows
- Mutuals when mutual protection is enabled
- Records manually marked protected
- Duplicate queue entries
- Removed/skipped records

### Queue statuses

- Pending
- Waiting
- Ready
- Processing
- Completed
- Paused
- Skipped
- Failed
- Protected
- Removed

### Queue fields

- Account ID and username
- Action
- Reason
- Created time
- Scheduled time
- Status
- Source action
- Preexisting flag
- Attempt count
- Last attempt time
- Completion time
- Error
- Notes

### Limits

Store configurable daily planning limits for follow and unfollow work. A future executor must enforce them transactionally.

## Component C — messages and unsend planning

### Imports

- Meta `message_*.json` files
- InstagramHelper `allMessagesItemsArray` JSON
- Future direct ZIP import
- Future user's existing DM-unsender job format

### Viewer

Display:

- Conversation
- Sender
- Timestamp
- Message type
- Content/placeholder
- Sent-by-me status

Recognize at minimum:

- Text
- Links
- Shared media
- Photos
- Videos
- Audio
- GIFs
- Stickers
- Calls
- Unknown/placeholder records

### Filters

- Keyword
- Conversation
- Sender
- Date range
- Message type
- Only messages sent by the user

### Unsend plan

- Only messages identified as sent by the user are eligible.
- Received messages must never enter the plan.
- The user must explicitly select or bulk-select reviewed messages.
- Export message ID, conversation ID, timestamp, type, and a limited preview.
- Preserve status and future checkpoint fields.

### Live execution

Live unsending remains an adapter task until it can reliably:

- Resolve the exact conversation
- Resolve the exact message
- Confirm it was sent by the user
- Preview the final batch
- Pause, resume, stop, skip, and retry
- Persist checkpoints
- Avoid duplicate attempts
- Report per-message results

## Unified interface

Views:

- Overview
- Relationships
- Action Queue
- Messages
- Import / Export
- Settings
- Activity

### Overview metrics

- Followers
- Following
- Mutuals
- Not following back
- New followers
- Detected unfollowers
- Queue pending/waiting/ready/protected
- Loaded messages
- Sent messages
- Selected unsend messages

## Migration

### InstagramHelper

Import its downloaded message JSON and normalize messages into the unified model.

### SimpleInstaBot

Import followed and unfollowed history arrays, preserving:

- Username
- Time
- Follow/unfollow action
- Failed flag
- No-action-taken flag

### Existing user tools

Once supplied, create source-specific adapters rather than copying their state directly into UI code.

Every migration must produce:

- Imported count
- Duplicate count
- Skipped count
- Warning list
- Records requiring manual correction

## Privacy and account constraints

- Local processing by default
- No password storage
- No password logging
- No cookie/session export
- No proxy rotation
- No fingerprint spoofing
- No CAPTCHA bypassing
- No challenge bypassing
- No circumvention of Instagram restrictions
- No silent destructive actions
- No unreviewed mass action

## Testing requirements

### Implemented domain tests

- Username normalization
- Snapshot comparison
- Rename handling
- Relationship classification
- Waiting-period queue creation
- Waiting-item reevaluation
- Mutual protection
- Relationship import parsing
- Legacy action migration
- Message import parsing
- Sent-only unsend planning

### Codex-Handoff tests

- Browser interaction tests
- Responsive UI tests
- Direct ZIP import fixtures
- Very large export performance
- Interrupted executor recovery
- Session expiration
- Login challenge detection
- Rate-limit/action-block detection
- Exact DM message resolution
- Duplicate destructive-action prevention
- Packaged desktop install/uninstall

## Acceptance criteria

The initial build is accepted when:

- It runs from a local static server.
- Core tests pass without installing dependencies.
- Followers/following imports produce correct relationship views.
- Multiple snapshots produce historical changes.
- Queue waiting logic creates protected or ready records correctly.
- SimpleInstaBot history imports.
- InstagramHelper and Meta message formats import.
- Received messages cannot be exported in an unsend plan.
- Workspace state persists locally.
- Queue and state exports can be downloaded.
- Tampermonkey companion imports a queue and records manual status updates.
- All unfinished work is explicitly labeled `Codex-Handoff`.

Full product completion requires the separate handoff items in `CODEX_HANDOFF.md` to pass their own acceptance criteria.
