# Maintainer guide

## Invariants

- Preserve the PWA, migrations, userscript, tests, and data contracts.
- Keep live action settings disabled by default.
- Keep shipped extension execution no-click until controlled acceptance is recorded.
- Keep `content-instagram.js` loaded before `instagram-overlay.js`.
- Keep Instagram-side pairing state sanitized; never expose bridge secrets, signatures, or nonces.
- Preserve `insta-aio-visible-list` and `insta-aio-manual-queue` compatibility.
- Never infer exact identity from a visually similar profile or message.
- Reserve ledger attempts before any destructive driver call.
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
pnpm test
```

Additional gates:

```bash
pnpm run benchmark:zip
pnpm run build:extension
pnpm run pack:desktop
```

Run target-platform installers before claiming packaging acceptance.

For sidecar changes, also open
`tests/fixtures/overlay-preview.html` through a local static server. Exercise the
profile context, repeated capture deduplication, manual queue status updates,
collapse/keyboard controls, and `?mode=messages` fixture. This is deterministic
runtime evidence, not authenticated Instagram acceptance.

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

1. Inspect session safety.
2. Resolve the exact normalized username.
3. Resolve one unambiguous relationship state.
4. Reapply whitelist, preexisting, mutual, and status protections.
5. Reserve the attempt transactionally.
6. Invoke the exact driver control.
7. Reinspect and verify the relationship change.
8. Finalize the ledger and checkpoint the item.

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
