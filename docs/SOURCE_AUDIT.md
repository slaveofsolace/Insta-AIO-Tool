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

## instagram-dm-unsender

- Repository: <https://github.com/thoughtsunificator/instagram-dm-unsender>
- Reviewed release: `0.7.2`
- Supplied artifact SHA-256: `2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C`
- License: MIT
- Author: Romain Lebesle

The supplied userscript bundle and embedded source map were reviewed. The map contained 21 original modules and confirmed the full source set.

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

## License boundary

MIT notices for reviewed MIT projects are retained in `THIRD_PARTY_NOTICES.md`. The implementation uses new local-first modules and does not vendor the reviewed applications. The unlicensed Gist is referenced only for provenance; its source is not included.
