# Architecture

## Decision

The initial product is a **hybrid local PWA plus Tampermonkey manual companion**.

This is the simplest architecture that delivers useful working functionality immediately while keeping unstable Instagram-specific behavior outside the core application.

## Why this architecture

### PWA core

The browser application handles stable, testable work:

- Import and migration
- Account normalization
- Snapshot storage
- Relationship comparison
- Queue scheduling
- Whitelist/preexisting/mutual protection
- Message parsing and viewing
- Sent-message filtering
- Unsend-plan creation
- Audit history
- JSON/CSV exports

It has no runtime dependencies and can be served with a basic local HTTP server.

### Tampermonkey companion

The userscript handles limited on-site assistance:

- Capture usernames already rendered in the page.
- Import/export a manual queue.
- Navigate to the next profile.
- Mark manual work complete or skipped.

Instagram DOM selectors are isolated here so changes do not corrupt the data model or core UI.

### Future execution adapters

Authenticated account-changing actions are defined as a separate adapter boundary. They are not embedded into the queue engine, import logic, or UI state.

A future adapter must expose a narrow contract such as:

```js
{
  inspectSession(): Promise<SessionStatus>,
  inspectRelationship(username): Promise<RelationshipStatus>,
  performReviewedAction(action): Promise<ActionResult>,
  inspectConversation(conversationId): Promise<ConversationStatus>,
  unsendReviewedMessage(message): Promise<ActionResult>
}
```

The adapter must never be allowed to mutate application history directly. It returns results, and the core records those results through validated state transitions.

## Modules

### `accounts.js`

- Username normalization
- Profile URL normalization
- Stable ID/username keys
- Account deduplication

### `snapshots.js`

- Snapshot creation
- Current/previous comparison
- New/lost follower detection
- Following changes
- ID-backed rename detection
- Mutual/non-mutual classification

### `queue.js`

- Follow/unfollow queue records
- Queue status transitions
- Waiting-period calculation
- Follow-back protection
- Whitelist protection
- Preexisting-follow protection
- Duplicate-action prevention

### `messages.js`

- Old InstagramHelper format migration
- Current Meta message export parsing
- Message-type inference
- Conversation summaries
- Sent-only filtering
- Unsend-plan creation

### `imports.js`

- File classification
- Relationship format parsing
- Message format parsing
- SimpleInstaBot history migration
- Warning collection

### `storage.js`

- IndexedDB state persistence
- LocalStorage fallback
- State defaults and migrations

### `app-loader.js` and `app.parts/`

- Deterministically reconstruct the complete browser UI module at runtime
- `npm run assemble` materializes the same source as the generated `src/app.js` development file
- UI composition
- Event handling
- File import/export
- Queue and message workflows
- Local activity log

## Data flow

```text
Instagram export / legacy JSON / visible DOM capture
                    │
                    ▼
               Import adapters
                    │
                    ▼
       Normalized accounts and messages
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Snapshot engine       Message engine
          │                   │
          ▼                   ▼
 Relationship views     Viewer / filters
          │                   │
          ▼                   ▼
     Review queue         Unsend plan
          └─────────┬─────────┘
                    ▼
              IndexedDB state
```

## Storage model

The initial version stores a single versioned workspace state in IndexedDB. This is adequate for an offline personal tool and avoids native database packaging.

A future desktop build should move to SQLite once message volumes, job checkpoints, and multi-account support require indexed queries and transactions.

## Trust boundaries

- Imported files are untrusted data and are escaped before display.
- The PWA never receives Instagram credentials.
- The userscript uses the browser's existing Instagram session but does not collect or export session cookies.
- Live action adapters, when developed, must be isolated from storage and UI rendering.
- Exported queue and message plans contain usernames/message metadata and should be treated as private files.

## Non-goals for the initial build

- Proxy rotation
- Fingerprint spoofing
- CAPTCHA solving
- Login-challenge bypassing
- Private API endpoint reverse engineering
- Automated cold messaging
- Unreviewed destructive actions
