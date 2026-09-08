# Source audit

This document records the external source versions reviewed for the current migrations and adapter boundaries. Source review does not imply wholesale code inclusion.

## Instagram Helper

- Repository: <https://github.com/pishangujeniya/instagram-helper>
- Reviewed revision: `5853d856a18a395aab7c8b8c7e3633175e23ddaf`
- License: MIT
- Relevant data: local message data containing `allMessagesItemsArray`

Adopted:

- Recognition of the archived message-data shape
- Preservation of conversation, sender, timestamp, type, and content fields
- Explicit migration dispositions for malformed or duplicate records

Rejected:

- Coupling the current PWA to archived server routes or templates
- Reusing obsolete authenticated request behavior
- Treating legacy DOM assumptions as current Instagram selectors

## SimpleInstaBot

- Repository: <https://github.com/mifi/SimpleInstaBot>
- Reviewed revision: `5eed7e4ac7ac7db6922eb9e5ed6db36ad9f18fca`
- License: MIT
- Relevant data: per-owner followed, unfollowed, and liked-photo history files

Adopted:

- Migration of followed/unfollowed history into non-actionable queue history
- Preservation of timestamps, owner context, and outcome metadata
- Explicit unsupported-record reporting for liked-photo history

Rejected:

- Credential entry or persistence
- Reusing browser-session files
- Fingerprint rotation
- Unreviewed page automation
- Conversion of historical records into fresh actions

## Follower/following checker Gist

- Reference: <https://gist.github.com/abir-taheer/0d3f1313def5eec6b78399c0fb69e4b1>
- Reviewed revision: `3876d9a67bc8255a79990a1616c20cae296d7194`
- License: no explicit license identified
- Relevant data: `PeopleIDontFollowBack` and `PeopleNotFollowingMeBack`

Because no license was identified, source code was not copied. The project independently implements normalized set comparison.

Saved checker results migrate as partial, read-only reports. They do not contain a complete snapshot and cannot create queue actions.

### 2026 pagination review

The 3.1.3 review compared the independent reader with current public examples
and maintained client implementations:

- The original Gist pages with `count=50`, `max_id`, the Instagram web app ID,
  and 800–1500 ms pacing.
- [OpenCLI issue 1831](https://github.com/jackwener/OpenCLI/issues/1831) and
  [pull request 1835](https://github.com/jackwener/OpenCLI/pull/1835), which
  document current 400 responses for oversized page counts and the use of
  50-row cursor pagination.
- The current
  [instagrapi relationship reader](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/user.py),
  which uses the follow-list surface parameters and recognizes
  `should_limit_list_of_followers` as a platform-limited response.
- [Meta's public Instagram API collection](https://www.postman.com/meta/instagram/folder/23987686-22b3a5b0-4a51-449a-9299-e3667d69b182),
  which exposes relationship counts but not a supported endpoint for
  enumerating a personal account's complete follower identities.

Adopted independently:

- One bounded cursor traversal per list
- Current same-origin follow-list parameters and web request headers
- Explicit handling for a platform-limited list or a missing next cursor
- Exact profile-count reconciliation before a list is marked complete

Rejected:

- Repeating a complete list scan to combine changing memberships
- Treating a profile total as proof that every identity is available
- Promoting partial rows into Follow / Unfollow targets
- Claiming the private web route is a stable public Instagram API

### Background relationship pagination references

The September 2026 review rechecked the original Gist at the same revision;
its recent activity is discussion, not a changed implementation. Its missing
cursor handling cannot prove that a complete list was returned.

Two maintained MIT projects were also inspected:

- [InstagramUnfollowers](https://github.com/davidarroyo1234/InstagramUnfollowers/tree/a203e13b2c6bd039d75438bdf7f8803fa595544c):
  `src/utils/utils.ts` and the relationship-reader portion of `src/main.tsx`.
  The Following reader uses a fixed GraphQL query and `page_info` cursors.
- [instagrapi](https://github.com/subzeroid/instagrapi/blob/c23bb018e2131a476979d30ab2d1fb08c774338c/instagrapi/mixins/user.py):
  `user_followers_gql_chunk` and adjacent relationship readers. The Followers
  query exposes account edges, a reported count, and an explicit continuation.

The independently implemented background option uses those fixed query shapes
with the existing bounded reader, exact username lookup, stable-ID deduplication,
and unchanged-profile count checks. Both routes returned JSON in authenticated
read-only probes. That is route evidence, not proof of a complete comparison.

No upstream bundle or implementation is included. Cookie lookup, session copying,
unbounded retries, and mutation helpers were not adopted. The private GraphQL
routes are not supported public APIs and may stop working or omit accounts.

## instagram-dm-unsender

- Repository: <https://github.com/thoughtsunificator/instagram-dm-unsender>
- Reviewed tag: `v0.7.2`
- Reviewed revision: `a8d7b4d9b76967f54cd9890fc3b1e0bb9c1b8d6a`
- Supplied artifact SHA-256: `2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C`
- License: MIT
- Author: Romain Lebesle

The supplied userscript bundle and embedded source map were reviewed. The map
contained 21 original modules. After normalizing source-map paths and line
endings, all 21 embedded `sourcesContent` entries matched the corresponding
upstream `v0.7.2` source files (21/21).

Adopted as independent adapter behavior:

- Abortable execution
- Localized exact-label matching for Unsend
- Reinspection immediately before a destructive step
- Post-action disappearance verification

Rejected:

- Selecting every right-aligned rendered row
- Treating visual alignment as durable sender identity
- Generic first-button confirmation
- Broad retry loops after blocks or uncertain outcomes
- Mass execution without exact message IDs, checkpoints, batch review, or two-stage confirmation

The source has no durable job state that can be migrated. `src/migrations/instagram-dm-unsender.js` therefore records a stateless migration report and requires manual creation of reviewed jobs from imported message data.

The shipped extension independently uses only the source's read-only
conversation-container and sent-layout observations during reviewed dry runs.
It additionally requires a stable rendered message ID, exact timestamp and
content digest, matching thread ID, and unique ownership result. It does not
reuse the source's hover events, menu clicks, confirmation clicks, or mass loop.

## License boundary

MIT notices for reviewed MIT projects are retained in `THIRD_PARTY_NOTICES.md`. The implementation uses new local-first modules and does not vendor the reviewed applications. The unlicensed Gist is referenced only for provenance; its source is not included.
