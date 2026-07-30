# Insta AIO Tool

A local-first Instagram relationship, review-queue, and message-data workspace that combines the strongest ideas from:

- `pishangujeniya/instagram-helper` and its local message-data viewer
- `mifi/SimpleInstaBot`
- `abir-taheer/instagram-follower-following.js`
- The user's existing follow/unfollow, relationship-checking, and DM-unsender components

This initial build is a zero-dependency progressive web app plus a Tampermonkey manual companion. It stores data in the browser through IndexedDB, does not ask for an Instagram password, and does not send imported account/message data to a server.

## Current status

| Component | Status | Notes |
|---|---:|---|
| Followers/following JSON import | Implemented | Supports current Meta-style JSON relationship files and app snapshot exports. |
| Relationship comparison | Implemented | Mutuals, not-following-back, not-followed-back, new followers, unfollowers, and following changes. |
| Historical snapshots | Implemented | Multiple dated snapshots with active/previous comparison. |
| Username-change handling | Implemented when IDs exist | ID-backed renames are not reported as unfollows. |
| Seven-day review queue | Implemented | Configurable waiting period, protections, status history, and deduplication. |
| SimpleInstaBot history migration | Implemented | Imports followed/unfollowed JSON history records. |
| InstagramHelper message-data migration | Implemented | Imports the older `allMessagesItemsArray` format. |
| Meta message export viewer | Implemented | Conversation preview, sent-message classification, type/search filters. |
| DM unsend-plan creation | Implemented | Selects only messages identified as sent by the user and exports a reviewed plan. |
| Tampermonkey companion | Implemented | Visible-list capture, queue import, profile navigation, manual completion/skip, state export. |
| Automatic follow/unfollow execution | **Codex-Handoff** | Adapter boundary and acceptance criteria are documented; this build does not click account-action controls. |
| Live mass DM unsend execution | **Codex-Handoff** | Preview and selection are complete; authenticated execution remains separate. |
| Direct Instagram ZIP import | **Codex-Handoff** | Extracted JSON file/folder import works now. |
| Desktop packaging | **Codex-Handoff** | PWA works now; Electron/Tauri packaging is documented as a later delivery. |
| Full browser UI regression suite | **Codex-Handoff** | Core domain tests are complete; browser interaction and visual tests remain. |

## Quick start

No package installation is required.

```bash
npm test
npm run serve
```

Open `http://localhost:4173`.

A direct `file://` launch may work for basic use, but serving the folder is recommended so the service worker and module imports behave consistently.

## Main workflow

### 1. Import Instagram data

From Instagram Accounts Center, request JSON data for followers/following and, when needed, messages. Extract the downloaded archive, then import either selected JSON files or the extracted folder.

Recognized files include:

- `followers_1.json`, `followers_2.json`, etc.
- `following.json` or `following_1.json`
- `message_1.json`, `message_2.json`, etc.
- InstagramHelper JSON containing `allMessagesItemsArray`
- SimpleInstaBot `*-followed.json` and `*-unfollowed.json`
- Insta AIO workspace/snapshot exports

### 2. Compare relationships

The Relationships view shows:

- Mutual followers
- Accounts that do not follow you back
- Accounts you do not follow back
- New followers
- Detected unfollowers
- Accounts newly followed by you
- Accounts you no longer follow
- ID-backed username changes

Each new import is preserved as a dated snapshot.

### 3. Build the review queue

Add usernames as follow targets or add relationship results to an unfollow review queue.

When a follow item is manually marked complete, the queue:

1. Starts the configured waiting period, defaulting to seven days.
2. Checks later snapshots for a follow-back.
3. Protects mutuals, whitelisted accounts, and accounts marked as preexisting.
4. Creates a ready unfollow-review item only when the waiting period expires without a follow-back.

The queue is a planner and audit record. It does not perform the account action in this build.

### 4. Review message data

Set the sender/display names that identify your own messages before importing current Meta message exports. Then:

- Search by message content, sender, or conversation.
- Filter by message type.
- Show only messages identified as yours.
- Select sent messages.
- Export an unsend plan for later execution.

Received messages are never added to an unsend plan.

### 5. Install the Tampermonkey companion

Install `userscripts/insta-aio-companion.user.js` in Tampermonkey.

It can:

- Capture usernames currently rendered in an Instagram follower/following dialog.
- Import a manual queue exported from the PWA.
- Open the next profile.
- Mark an item completed or skipped.
- Export updated companion state.

It deliberately does not auto-scroll lists, click Follow/Unfollow, click Unsend, bypass challenges, rotate proxies, spoof fingerprints, or collect passwords.

## Project structure

```text
.
├── index.html
├── manifest.webmanifest
├── sw.js
├── src/
│   ├── app.js
│   ├── styles.css
│   └── core/
│       ├── accounts.js
│       ├── imports.js
│       ├── messages.js
│       ├── queue.js
│       ├── snapshots.js
│       └── storage.js
├── userscripts/
│   └── insta-aio-companion.user.js
├── tests/
│   └── core.test.js
└── docs/
    ├── ARCHITECTURE.md
    ├── CODEX_HANDOFF.md
    ├── CODEX_HANDOFF_PROMPT.md
    ├── PROJECT_SPEC.md
    └── SOURCE_AUDIT.md
```

## Tests

```bash
npm test
```

The current suite covers:

- Username normalization
- Snapshot differences
- ID-backed rename detection
- Mutual/non-mutual classification
- Seven-day queue generation
- Waiting-item reevaluation
- Mutual protection
- Meta relationship imports
- SimpleInstaBot history migration
- InstagramHelper message migration
- Meta message parsing and sent-only unsend plans

## Design constraints

- No proxy rotation
- No fingerprint spoofing
- No CAPTCHA bypassing
- No circumvention of Instagram restrictions
- No password collection or password logging
- No hidden credential storage
- No automatic action executor in the initial build
- Imported data remains local unless the user explicitly exports it

## Source and licensing

The two referenced repositories use the MIT License. Their architecture and feature ideas were studied, but this repository uses a new local-first implementation rather than copying their applications wholesale. The referenced Gist does not present a license in the supplied source, so its code was not copied; only the general set-comparison concept was independently implemented.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and [docs/SOURCE_AUDIT.md](./docs/SOURCE_AUDIT.md).
