# Release status

Current candidate: **3.1.8**

## Release files

| Surface | File |
| --- | --- |
| Tampermonkey | `insta-toolbox.user.js` |
| Chrome extension | `Insta-Toolbox-Extension-3.1.8.zip` |
| Web/PWA | `insta-toolbox-web-3.1.8.zip` |
| Windows | `Insta-Toolbox-Setup-3.1.8.exe` |
| macOS | `Insta-Toolbox-3.1.8-universal.dmg` and `.zip` |
| Integrity | `SHA256SUMS.txt`, SBOM, and GitHub provenance attestation |

The stable userscript channel is:

`https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js`

Version 3 keeps the userscript identity introduced in 3.0. Tampermonkey updates 3.0 in place. Remove a 2.x script before installing 3.1.

## Candidate gates

The 3.1 account-free matrix contains:

- 515 automated tests;
- 45 overlay screenshot states;
- 11 PWA screenshot states;
- service-worker cache generation `insta-toolbox-v318`.

Before a release is promoted, the exact `main` commit must pass assembly, tests, repository hygiene, dependency audit, generated-userscript parity, extension and userscript acceptance, Chrome pairing, browser QA, overlay/PWA visual checks, Windows packaging, macOS packaging, archive inspection, checksum generation, and `git diff --check`.

The release workflow does not rebuild. A maintainer supplies the successful `main` CI run ID and version tag, approves the protected `release` environment, and promotes those exact tested artifacts. The workflow rechecks versions and checksums, generates an SBOM, requests provenance attestation, creates the tag, and publishes the GitHub release.

## Signing status

The Windows installer is unsigned. SmartScreen may warn.

The macOS application is ad-hoc signed for bundle integrity but is not Developer ID signed or notarized. Gatekeeper may warn. Developer ID signing and notarization remain a separate credentialed release task.

## Safety boundary

- Live actions start disabled on every load.
- Dry runs do not click Instagram controls.
- Mutual Checker navigation opens and closes only the exact Followers and Following dialogs; it never clicks relationship controls.
- Every mutation requires an action-specific confirmation and transient capability.
- Follow / Unfollow revalidates the target and relationship.
- DM Unsend revalidates the open thread, sent-message ownership, menu, dialog, and removal result.
- Challenge, block, rate-limit, expiry, wrong-target, ambiguous-control, and uncertain-result states stop the runner.
- No build or test command performs a live Instagram action.

## Evidence and nonclaims

The candidate record is [acceptance/3.1.8.md](./acceptance/3.1.8.md). Compatibility is tracked in [compatibility/3.1.8.md](./compatibility/3.1.8.md).

Full-list authenticated Mutual Checker acceptance has not passed. The native Followers request redirected to the homepage; the background cursor chain also ended below the declared follower total. A separate verified follow-back review now uses explicit relationship flags without claiming complete lists. Exact-build installed acceptance of that review and release promotion remain pending.

Automated fixtures do not prove current authenticated Instagram selectors, human screen-reader use, persistent-profile behavior, SmartScreen trust, Gatekeeper trust, or notarization. Record those checks separately without committing usernames, messages, thread IDs, cookies, tokens, or private screenshots.

Historical evidence directories keep the version and filenames they were produced with. They are not renamed or presented as 3.1 evidence.

## Related documents

- [Installation](./INSTALLATION.md)
- [Operator acceptance](./OPERATOR_ACCEPTANCE.md)
- [Browser QA](./BROWSER_QA.md)
- [Overlay QA](./OVERLAY_QA.md)
- [Maintainer guide](./MAINTAINER_GUIDE.md)
- [Security review](./SECURITY_REVIEW.md)
