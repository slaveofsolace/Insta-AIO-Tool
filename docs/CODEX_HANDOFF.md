# Codex-Handoff

This file is the authoritative list of work not completed in the initial scaffold.

## P0 — integrate the user's actual existing components

**Status:** Codex-Handoff

### Required input

The user must provide repository paths, branches, files, or archives for:

- Existing follow/unfollow component
- Existing follower/following checker component, if different from the supplied Gist
- Existing DM-unsender component

### Work

1. Audit each component's entry points, selectors/endpoints, state files, dependencies, and licenses.
2. Add source-specific adapters under a new `src/adapters/` directory.
3. Map legacy state into the existing normalized account, queue, snapshot, and message models.
4. Preserve original code in a clearly attributed `vendor/` or migration-only directory only when licensing permits.
5. Do not couple imported code directly to `app.js`.

### Acceptance

- Migration report for each source.
- No silently dropped records.
- Existing unit tests continue to pass.
- New fixture tests cover each supplied component.

## P0 — direct Instagram export ZIP import

**Status:** Codex-Handoff

### Work

- Add a local ZIP reader with no upload.
- Discover followers, following, and message JSON files recursively.
- Stream or batch large message files to avoid locking the UI.
- Show a pre-import manifest and counts.
- Preserve file paths as source metadata.

### Acceptance

- Imports an unmodified current Instagram ZIP.
- Works completely offline.
- Handles split follower/message files.
- Rejects malformed or encrypted archives clearly.
- Includes fixture tests and large-archive performance measurements.

## P0 — reviewed browser action adapter

**Status:** Codex-Handoff

### Scope

Implement an optional adapter for user-reviewed queue items. The initial repository intentionally contains no automatic follow/unfollow clicker.

### Required behavior

- Use the user's existing authenticated browser session.
- Never request or store the Instagram password.
- Require explicit confirmation before each batch.
- Show exact usernames/actions before execution.
- Enforce configured daily limits and duplicate prevention.
- Stop on action-block, challenge, session-expiration, unexpected UI, or ambiguous state.
- Record before/after relationship evidence when available.
- Support pause, resume, stop, skip, and retry.
- Keep a durable checkpoint after every action.

### Prohibited behavior

- Proxy rotation
- Fingerprint spoofing
- CAPTCHA solving
- Challenge bypassing
- Hidden or randomized behavior intended to conceal automation
- Private endpoint reverse engineering
- Continuing after Instagram signals that the action is blocked

### Acceptance

- Dry-run mode produces the exact intended plan with no account changes.
- Controlled live test uses a user-selected batch of one.
- Wrong-profile and duplicate-action tests pass.
- A UI change results in a safe stop, not a guessed click.
- Every result appears in the activity log.

## P0 — live DM unsend adapter

**Status:** Codex-Handoff

### Required behavior

- Resolve the exact conversation and exact sent message.
- Reconfirm sender ownership immediately before unsending.
- Display the complete selected batch and total.
- Require a second destructive-action confirmation.
- Checkpoint after each message.
- Support pause, resume, stop, skip, retry, and exportable failure reports.
- Never select or attempt to unsend received messages.
- Stop on ambiguous DOM, session expiration, challenge, action block, or missing message.

### Acceptance

- Dry run resolves every target without clicking Unsend.
- Controlled live test processes one user-selected sent message.
- Received-message and wrong-conversation tests are hard failures.
- Restart resumes from the last durable checkpoint.
- Duplicate attempts are prevented.

## P1 — extension/PWA bridge

**Status:** Codex-Handoff

Replace file-based queue exchange with an explicit browser-extension bridge:

- Signed/versioned message schema
- Origin checks
- One-time pairing
- Read-only and action permissions separated
- Clear connection status
- No cookie/session transfer
- Import/export remains available as fallback

## P1 — desktop packaging

**Status:** Codex-Handoff

Package the application with Electron or Tauri only after the adapter design stabilizes.

Requirements:

- Windows and macOS builds
- App-local data directory
- Automatic workspace backups
- Safe updates and schema migration
- Install/uninstall documentation
- No device-specific environment details in user-facing documentation

## P1 — SQLite storage

**Status:** Codex-Handoff

Move from a single IndexedDB state record to normalized SQLite tables for:

- Accounts
- Snapshots
- Snapshot memberships
- Relationship events
- Queue items
- Action attempts
- Conversations
- Messages
- DM jobs
- Settings
- Activity logs

Include transactions, indexes, migrations, backup, restore, and corruption recovery.

## P1 — UI and browser QA

**Status:** Codex-Handoff

- Keyboard navigation
- Screen-reader labels
- Large-list virtualization
- Responsive tests
- Import progress/cancel
- Confirmation dialogs
- Error inspection
- Empty/loading/error states
- Browser screenshot regression tests
- Mobile/PWA installation verification

## P2 — reporting

**Status:** Codex-Handoff

- Relationship trend charts
- Snapshot-to-snapshot reports
- Queue throughput and failure reports
- CSV exports for every view
- Migration reports with duplicates/skips/manual corrections
- Redacted diagnostic bundle
