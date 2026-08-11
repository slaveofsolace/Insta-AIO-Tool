# Maintainer guide

## Invariants

- Preserve the PWA, migrations, userscript, tests, and data contracts.
- Keep live action settings disabled by default.
- Keep every dry-run route no-click; it must never reach `activateLiveControl()`.
- Keep extension live account execution to one fresh signed item, one exact Instagram-side phrase, one tab-scoped 90-second arm, one background-owned reservation, and one consumed capability.
- Keep controlled extension DM execution to exactly one fresh twice-confirmed
  item, one exact conversation/message/timestamp/content/ownership binding,
  one tab-scoped 90-second arm, independent PWA and extension reservations, one
  consumed row token, structurally bound interactive menu/dialog controls, and
  same-thread verified removal with stable identity coverage.
- Keep the extension DM dry-run resolver limited to allowlisted stable message
  IDs, exact timestamps and content digests, matching direct-thread IDs, and
  proven sent ownership; a visual-text similarity alone must safe-stop.
- Keep `content-instagram.js` loaded before `instagram-overlay.js`.
- Keep Instagram-side pairing state sanitized; never expose bridge secrets, signatures, or nonces.
- Preserve `insta-aio-visible-list` and `insta-aio-manual-queue` compatibility.
- Never infer exact identity from a visually similar profile or message.
- Reserve both the PWA ledger and the extension mirror before any destructive driver call.
- Preserve every import disposition.
- Keep state migrations additive.
- Do not introduce credential collection, session export, bypass behavior, or private endpoint dependencies.

## Change workflow

1. Start from an up-to-date branch.
2. Inspect the current state schema and relevant source tests.
3. Make one coherent change.
4. Run assembly and the full test suite.
5. Review the generated module only as a build artifact; do not commit `src/app.js`.
6. Review the diff for data-contract changes, unsafe defaults, session material, machine-specific paths, and accidental generated output.
7. Commit only when the repository is passing.

Required gate:

```bash
pnpm run assemble
pnpm run verify:repo-hygiene
pnpm test
```

Additional gates:

```bash
pnpm run benchmark:zip
pnpm run build:extension
pnpm run qa:extension
pnpm run qa:chrome
pnpm run pack:desktop
```

Run target-platform installers before claiming packaging acceptance.

For sidecar changes, run `pnpm run qa:extension`. It serves only the exact local
fixture and production content assets, exercises the bounded profile and message
DOM chains, validates keyboard focus plus the Chromium accessibility tree, and
checks PWA installability/read-only pairing defaults. This is deterministic
runtime evidence, not an authenticated Instagram mutation.

For controlled account-driver changes, also exercise `?mode=live-follow` and
`?mode=live-unfollow`. Verify that inspection performs zero activations, the
exact arm is required, suggested-account controls cannot impersonate the
profile header, Follow activates one control, pre-existing dialogs stop before
any click, Unfollow activates only a newly surfaced target-named confirmation,
token replay performs nothing, and duplicate relationship controls safe-stop.

For controlled DM-driver changes, exercise the exact stable-message fixture and
verify that dry run performs zero activations, a wrong or replayed token performs
zero additional activations, a pre-existing surface stops before every control,
unbound or noninteractive surfaces stop before Unsend, wrong-thread/identity-loss
outcomes stay uncertain, nested flex-end descendants cannot prove ownership,
and success uses only the exact row action, bound localized Unsend choice, bound
confirmation, and stable-identity removal proof. Do not treat this fixture as
authenticated issue #4 acceptance.

For pairing changes, run `pnpm run qa:chrome` with Chrome for Testing. The gate
uses a disposable browser profile, pregrants only loopback access in a disposable
copy of the unpacked manifest, completes the production popup/PWA handshake,
pings the extension, verifies read-only permissions and live-off defaults, then
deletes the profile. Branded stable Chrome may reject command-line loading of an
unpacked extension; do not weaken or modify the user's real profile to bypass
that policy.

For macOS packaging changes, run `pnpm run dist:mac -- --publish never` followed
by `pnpm run qa:mac-package` on macOS. CI performs this lifecycle with the
QA-only ad-hoc entitlement file; the release and inherited entitlements omit its
library-validation exception. A public release still requires its own Developer
ID identity and notarization.

## Source integrations

A component may be marked integrated only after:

- The exact source revision or artifact hash is recorded.
- Entry points, runtime, dependencies, selectors/routes, storage, session behavior, and license are reviewed.
- Reusable and rejected behavior is documented.
- A source-specific migration or adapter is implemented.
- Fixtures cover valid, invalid, duplicate, and incomplete records.
- Migration counts reconcile.
- User-facing documentation explains the supported scope.

## Reviewed browser drivers

Driver boundaries return observations and results. They do not write application state.

Before a live account action:

1. Require a fresh digest-bound confirmation for exactly one item.
2. Send the signed intent through an action-permission pairing.
3. Match the exact Instagram profile header and its owned relationship control.
4. Require the exact action/username phrase and create a tab-scoped 90-second arm.
5. Inspect session safety and reapply whitelist, preexisting, mutual, and status protections.
6. Resolve a short-lived exact DOM control token.
7. Revalidate the one-use arm immediately before reservation.
8. Reserve the PWA attempt transactionally.
9. Persist the extension-side mirror reservation and consume the arm before the page-control request.
10. Stop on any pre-existing dialog; invoke only the exact token-bound control and, for Unfollow, a newly surfaced dialog that names the reviewed username.
11. Reinspect and verify the relationship change.
12. Finalize both ledgers and checkpoint the item.

Before DM removal:

1. Resolve the exact conversation.
2. Resolve one message matching ID, timestamp, content digest, and sender ownership.
3. Reinspect immediately before opening message actions.
4. Resolve one exact localized Unsend option.
5. Verify the confirmation identity.
6. Reserve the attempt transactionally.
7. Confirm once.
8. Verify the message is absent.
9. Finalize the ledger and checkpoint.

Any uncertainty stops the job.

## Release checklist

- [ ] Assembly passes
- [ ] Unit/integration tests pass
- [ ] ZIP benchmark reviewed when relevant
- [ ] Extension sources validate and artifact builds
- [ ] Desktop target artifact builds
- [ ] Installer and removal tested on the target operating system
- [ ] Browser views checked at desktop, tablet, and mobile widths
- [ ] Keyboard and screen-reader checks completed
- [ ] Destructive confirmations and safe-stop errors exercised
- [ ] Public documentation contains no local paths, temporary notes, or credentials
- [ ] Dependency and third-party license review completed
- [ ] Secret scan completed
- [ ] Repository metadata and issue titles are current
