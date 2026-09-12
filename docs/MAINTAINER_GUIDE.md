# Maintainer guide

## Invariants

- Preserve the PWA, migrations, userscript, tests, and data contracts.
- Keep every destructive path without authority until its exact confirmation.
- Keep every dry-run route no-click; it must never reach `activateLiveControl()`.
- Keep extension live account execution bound to one confirmed finite run, one
  short-lived tab capability, one background-owned reservation, and exact
  target revalidation before every page control.
- Keep controlled extension DM execution bound to one confirmed plan, the exact
  conversation, scope, optional finite limit, digest, expiry, sent ownership,
  structurally bound interactive menu/dialog controls, and same-thread verified
  removal.
- Keep the extension DM dry-run resolver limited to allowlisted stable message
  IDs, exact timestamps and content digests, matching direct-thread IDs, and
  proven sent ownership; a visual-text similarity alone must safe-stop.
- Keep `content-instagram.js` loaded before `instagram-overlay.js`.
- Keep Instagram-side pairing state sanitized; never expose bridge secrets, signatures, or nonces.
- Preserve the documented `insta-toolbox-visible-list` and
  `insta-toolbox-manual-queue` contracts.
- Never infer exact identity from a visually similar profile or message.
- For signed PWA one-item jobs, reserve both the PWA ledger and extension mirror
  before the destructive driver call.
- For thread-wide DM Unsend, reserve the transient capability before page
  control and append ledger progress only after each verified removal. A
  zero-click failure records zero removals.
- Preserve every import disposition.
- Keep state migrations additive.
- Do not introduce credential collection, session export, bypass behavior,
  arbitrary endpoints, or mutation-capable private endpoint dependencies. The
  Mutual Checker exception is limited to its tested fixed Instagram GET-route allowlist.

## Change workflow

Use Node.js 24 and the lockfile-pinned pnpm version.

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
git diff --check
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
confirmed capability is required, suggested-account controls cannot impersonate the
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
authenticated Instagram acceptance.

For pairing changes, run `pnpm run qa:chrome` with Chrome for Testing. The gate
uses a disposable browser profile, pregrants only loopback access in a disposable
copy of the unpacked manifest, completes the production popup/PWA handshake,
pings the extension, verifies read-only permissions and live-off defaults, then
deletes the profile. Branded stable Chrome may reject command-line loading of an
unpacked extension; do not weaken or modify the real profile to bypass
that policy.

For macOS packaging changes, run `pnpm run dist:mac` followed by
`pnpm run qa:mac-package` on macOS. The current public package is universal and
ad-hoc signed. Its inherited entitlements include
`com.apple.security.cs.disable-library-validation` because an ad-hoc-signed
Electron bundle has no Developer ID Team ID for library validation. QA must
reject unexpected outer archive content; check both architectures, the
hardened-runtime flag and effective entitlement allowlist for every bundled
Mach-O; verify the bundle icon; and launch the exact packaged app without
modifying it. When Developer ID credentials are
available, remove this exception, sign the complete bundle, notarize it, staple
the ticket, and repeat the lifecycle checks.

For the portable web artifact, run `pnpm run build:web` and
`pnpm run verify:web-package`. The ZIP is a static-hosting package, not a
double-click application; verify it through HTTPS or localhost.

## Release promotion

The `Release` workflow promotes tested artifacts; it does not rebuild them.

1. Merge the candidate into `main` and wait for the complete CI workflow.
2. Record the successful CI run ID and its exact commit.
3. Run the `Release` workflow manually with that run ID and the
   `v<package.version>` tag.
4. Approve the protected `release` environment after reviewing the run and
   [acceptance record](./acceptance/3.1.12.md).
5. Confirm that the workflow rejects a stale, non-`main`, non-push, failed, or
   version-mismatched CI run.
6. Verify every promoted file against `SHA256SUMS.txt`, then inspect the SBOM,
   provenance attestation, tag target, and release notes.

Configure the `release` environment with required reviewers. Configure GitHub
Pages to use GitHub Actions; the Pages workflow extracts the exact successful
`main` web artifact instead of rebuilding it.

Keep the repository description, homepage, and topics aligned with
[GITHUB_METADATA.md](./GITHUB_METADATA.md).

Version 3.1 publishes `insta-toolbox.user.js`,
`Insta-Toolbox-Extension-3.1.12.zip`, and `insta-toolbox-web-3.1.12.zip`. Do not
publish old-name aliases or a raw-branch userscript update channel.

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

1. Require a fresh confirmation naming the exact action, targets, and finite count.
2. Send a signed intent when the run originated from an action-permission pairing.
3. Match each exact Instagram profile header and its owned relationship control.
4. Create a short-lived tab capability for only the confirmed run.
5. Inspect session safety and reapply whitelist, preexisting, mutual, and status protections.
6. Resolve a short-lived exact DOM control token.
7. Revalidate the one-use capability immediately before reservation.
8. Reserve the attempt transactionally.
9. Persist the extension-side mirror reservation and consume the capability before the page-control request.
10. Stop on any pre-existing dialog; invoke only the exact token-bound control and, for Unfollow, a newly surfaced dialog that names the reviewed username.
11. Reinspect and verify the relationship change.
12. Finalize the ledgers and checkpoint the item.

Before a signed one-message DM removal:

1. Resolve the exact conversation.
2. Resolve one message matching ID, timestamp, content digest, and sender ownership.
3. Accept one ordinary confirmation naming that thread and message.
4. Mint a short-lived capability and reinspect immediately before opening message actions.
5. Reserve the attempt transactionally.
6. Resolve one exact localized Unsend option and its matching confirmation.
7. Verify the message is absent.
8. Finalize the ledger and checkpoint.

Before thread-wide DM Unsend:

1. Resolve the exact open conversation and selected scope.
2. Accept one ordinary confirmation naming that thread and scope.
3. Create a versioned thread/scope/optional-limit/digest/expiry plan and mint its transient capability.
4. Start one streaming traversal without a preliminary history count.
5. Revalidate thread, expiry, sent ownership, menu, and confirmation before each removal.
6. Append ledger progress only after verified removal; never record a mounted-row estimate as a result.

Any uncertainty stops the job.

## Release checklist

- [ ] Assembly passes
- [ ] Unit/integration tests pass
- [ ] ZIP benchmark reviewed when relevant
- [ ] Extension sources validate and artifact builds
- [ ] Static web archive builds, verifies, and matches the offline asset graph
- [ ] Desktop target artifact builds
- [ ] Installer and removal tested on the target operating system
- [ ] Browser views checked at desktop, tablet, and mobile widths
- [ ] Keyboard and screen-reader checks completed
- [ ] Destructive confirmations and safe-stop errors exercised
- [ ] Public documentation contains no local paths, temporary notes, or credentials
- [ ] Dependency and third-party license review completed
- [ ] CodeQL and dependency review passed for the release commit
- [ ] `SHA256SUMS.txt` covers the userscript, extension, web, and desktop artifacts
- [ ] SBOM and provenance attestation cover the promoted release files
- [ ] GitHub Pages serves the exact successful `main` web artifact
- [ ] Secret scan completed
- [ ] Repository metadata and issue titles are current
