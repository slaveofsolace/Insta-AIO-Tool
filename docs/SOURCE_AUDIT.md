# Source audit

## 1. `pishangujeniya/instagram-helper`

Repository: `https://github.com/pishangujeniya/instagram-helper`

### Useful ideas retained

- Local JSON loading through the browser File API.
- Rendering downloaded message history as a readable conversation.
- Recognizing multiple message item types, including text, links, shared media, clips, and private media placeholders.
- Keeping message-data viewing separate from authenticated Instagram actions.

### Problems not carried forward

- The repository is archived.
- Its README states that the main automation stopped working after Instagram changes in May 2023.
- Its original setup disabled browser web security and required a CSP-disabling extension.
- Its older viewer uses direct HTML string composition and remote placeholder images.
- The original stop mechanism was browser refresh/close rather than persistent jobs and checkpoints.

### New implementation

Insta AIO parses the old `allMessagesItemsArray` format for migration, but uses escaped rendering, IndexedDB storage, explicit sent-message classification, filters, selection, and exportable plans.

## 2. `mifi/SimpleInstaBot`

Repository: `https://github.com/mifi/SimpleInstaBot`

### Useful ideas retained

- Persistent history of followed and unfollowed accounts.
- A configurable age before an account becomes eligible for unfollow review.
- Exclusion/protection lists.
- Dry-run planning.
- Separate follow-list and unfollow-list workflows.
- Local execution and local logs.
- Resume-friendly history that survives app restarts.

### Problems not carried forward

- The desktop app and automation library are tightly coupled to Electron/Puppeteer and Instagram DOM behavior.
- Its JSON persistence model is too limited for snapshot history, relationships, DM jobs, and migrations.
- The project includes randomized user-agent/browser-signature behavior; Insta AIO explicitly excludes fingerprint spoofing.
- The live browser-action layer is fragile and can become incompatible whenever Instagram changes its UI.

### New implementation

Insta AIO independently implements a normalized account model, snapshot history, queue statuses, waiting schedules, protections, migrations, and local audit records. SimpleInstaBot history arrays can be imported without adopting its live browser automation engine.

## 3. `abir-taheer/instagram-follower-following.js`

Gist: `https://gist.github.com/abir-taheer/0d3f1313def5eec6b78399c0fb69e4b1`

### Useful ideas retained

- Normalize follower and following usernames.
- Compare the lists with set operations.
- Produce two important views: accounts not followed back and accounts not following back.
- Paginated collection as an adapter concern rather than a comparison concern.

### Problems not carried forward

- The script calls Instagram's private web friendship endpoints directly from an authenticated session.
- Endpoint and header details can change without notice.
- It has no historical snapshots, migrations, queue protections, or durable storage.
- The supplied Gist has no explicit license in the referenced page; its source code was not copied.

### New implementation

The relationship comparison is a clean local module operating on imported snapshots. Collection is abstracted away so official exports, visible-DOM capture, or a future approved adapter can feed the same comparison engine.

## 4. User-provided existing components

The prompt states that follow/unfollow, follower-checking, and DM-unsending components already exist, but only two public code references and one feature-reference repository were supplied in this task. The repository therefore includes migration/adaptor boundaries and a Codex handoff rather than pretending that unprovided source code was integrated.

## Licensing conclusion

- `instagram-helper`: MIT.
- `SimpleInstaBot`: MIT.
- Referenced Gist: no explicit license identified from the supplied page.
- Insta AIO implementation: MIT, independently structured.
