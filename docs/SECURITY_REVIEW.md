# Security review

Last reviewed: 2026-08-24

## Boundaries

Insta Toolbox is local-first. The PWA and desktop app process selected files and saved workspace data on the local device. The Instagram companion uses the session already active in the browser tab. It does not request a password, read or export cookies, send analytics, or use a remote control service.

Required extension host access is limited to Instagram. Pairing requests optional access only to the approved workspace origin; requests are signed, short-lived, nonce-protected, and split into read and action permissions. Sender origin comes from browser metadata, not the page's claim. Credential-like bridge fields are rejected.

Workspace exports can contain imported account data and pairing secrets. Treat them as private backups. Revoke pairings before sharing a backup.

## Action authority

There is no global live switch, persistent arm state, or typed authorization phrase. Dry runs cannot reach the page-control activator.

Every Follow, Unfollow, or Unsend mutation requires:

1. an exact reviewed target or thread and scope;
2. an action-specific confirmation;
3. a short-lived capability bound to that reviewed material;
4. reservation before page control;
5. revalidation immediately before each click;
6. a verified postcondition before a success ledger entry.

Capabilities expire and cannot be replayed. Route changes, panel closure, Stop, challenge, block, rate limit, wrong target, pre-existing dialog, ambiguous controls, or an uncertain postcondition stop the run. Failed preflight and zero-click failure record zero removals.

The in-overlay confirmation controller freezes the reviewed binding, focuses Cancel first, and accepts only a trusted browser click on its exact Confirm button. Synthetic `.click()` and dispatched events do not mint authority. Rendered facts use text nodes rather than HTML interpolation.

Thread-wide DM Unsend has an internal runaway watchdog, not a daily action limit. Version 3 does not read, migrate, or delete version 2 browser or desktop state.

## Follow and Unfollow

An account run is bound to a reviewed action, finite count, target list digest, and expiry. Each profile navigation revalidates the exact profile header and its owned relationship control. A pre-existing dialog stops the run. Unfollow accepts only the newly surfaced confirmation that names the reviewed account. Duplicate controls or a changed relationship stop before another action.

The userscript may retain the original run expiry across navigation through tab-scoped manager storage. It does not put action authority in shared userscript storage. A manager without the required tab-scoped API keeps account batches disabled.

## DM Unsend

Thread-wide Unsend binds a versioned plan to the exact open thread, scope (`all`, `newest`, or `oldest`), optional finite limit, digest, and expiry. After one confirmation it performs one streaming traversal; a read-only mounted-row count is not authorization.

Before each removal the runner rechecks:

- the exact `/direct/t/<id>` route;
- expiry and Stop state;
- proof that the message was sent by the current user;
- one newly surfaced, interactive Unsend menu item;
- one newly surfaced matching confirmation dialog;
- verified message removal in the same thread.

The traversal handles virtualized rows, normal and reversed layouts, scroller replacement, DOM shrinkage, bounded retries, and stable-empty exhaustion. Successful actions use adaptive one-to-two-second pacing. The runner records only verified removals and never reports the mounted DOM window as the conversation total.

Visible DM evidence is scoped to the exact open thread. Navigating to the inbox, feed, a profile, or a different thread hides and clears previously exposed candidates.

## Mutual Checker

Mutual Checker is the narrow authenticated-read exception. It can call only these same-origin GET routes:

- `/api/v1/web/search/topsearch/`
- `/api/v1/users/web_profile_info/?username=<exact-username>`
- `/api/v1/friendships/<numeric-id>/followers/`
- `/api/v1/friendships/<numeric-id>/following/`

The client uses browser-managed credentials without reading them, a fixed application header, bounded pagination, paced requests, a 20-minute deadline, and user cancellation. The profile response must repeat the exact normalized username and numeric ID. Complete results require exact total equality and stable totals before and after traversal. Login loss, challenge, block, rate limit, repeated pagination tokens, invalid schemas, conflicting totals, and request failures leave the result incomplete or stop the scan.

Results replace Followers and Following atomically and are not sent through the extension bridge. Instagram can change these unsupported web routes without notice.

## Local app and web delivery

The PWA service worker uses network-first same-origin GET handling, caches only successful same-origin responses, bypasses the HTTP cache for service-worker update checks, and removes earlier cache generations. Version 3.1 uses `insta-toolbox-v314`.

The loopback development server accepts only loopback Host headers and serves an explicit asset allowlist. Repository metadata, tests, documentation, and Git internals are not served. Framing protection is sent as HTTP headers because `frame-ancestors` is ineffective in a meta policy.

Running PWA jobs own an `AbortController` and immutable reviewed identity. Discard aborts only the matching run. Cancellation is checked around every awaited inspection, authorization, and reservation boundary. A job removed from storage cannot be recreated by a late callback. If a browser mutation was already dispatched, the adapter completes its postcondition check and records the observed result rather than calling it canceled.

## Desktop packages

The Windows installer is unsigned. SmartScreen trust is not claimed.

The universal macOS package is ad-hoc signed, not Developer ID signed or notarized. It currently needs `com.apple.security.cs.disable-library-validation` because the Electron bundle has no Developer ID Team ID. Package QA treats that entitlement as a disclosed exception and rejects other unexpected entitlements. It checks both `arm64` and `x86_64` slices, hardened-runtime flags, bundle contents, icon, signature, archive roots, and exact-app launch.

When release credentials are available, remove the library-validation exception, sign every nested binary with the release identity, notarize the artifacts, staple the ticket, and repeat the exact-package checks.

## Review history

Earlier reviews fixed structural profile-control binding, pre-existing-dialog confusion, missing extension reservations, malformed migration fields, discard races, weak message identity, unbound or noninteractive DM controls, synthetic confirmation acceptance, and incomplete oldest-edge traversal. Regression fixtures cover these boundaries.

Historical releases retain their own acceptance records. They are not evidence that the current 3.1 build passed authenticated acceptance. Current authenticated compatibility, human screen-reader use, Windows publisher trust, Apple notarization, and physical Intel Mac behavior require fresh acceptance.

## Dependencies and supply chain

Runtime application code has no third-party production dependencies. The lockfile keeps major-compatible patched `brace-expansion` releases and executable tests verify their expansion-length bounds.

CI actions are pinned to full commit SHAs. Pull requests receive dependency review; CodeQL runs on pull requests, `main`, and weekly. Dependabot proposes npm and action updates. Release promotion accepts only artifacts from the successful current `main` CI run, rechecks versions and checksums, generates an SBOM, and requests GitHub provenance attestation without rebuilding.

The 3.1 account-free matrix contains 370 tests, 45 overlay states, and 11 PWA states. Final pass links and hashes belong in [the 3.1.4 acceptance record](./acceptance/3.1.4.md). Fixtures do not prove current authenticated Instagram behavior.

## License

The application is MIT licensed. Source provenance and third-party licenses are recorded in `THIRD_PARTY_NOTICES.md`. Release archives include the license and notices.
