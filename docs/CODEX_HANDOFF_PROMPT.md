# Codex handoff prompt

Copy the prompt below into Codex after granting it access to `slaveofsolace/Insta-AIO-Tool` and supplying the missing existing component files/repositories.

---

You are continuing development of:

`https://github.com/slaveofsolace/Insta-AIO-Tool`

Act as the senior engineer responsible for completing the existing repository rather than replacing it.

## Objective

Finish the unified local-first Instagram account-management suite by integrating the user's existing follow/unfollow, follower/following, and DM-unsender components into the current normalized architecture.

The repository already contains a working zero-dependency PWA, core domain modules, migrations, a Tampermonkey manual companion, documentation, and passing tests. Preserve that work.

## Read first

Read these files before editing:

1. `README.md`
2. `docs/PROJECT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SOURCE_AUDIT.md`
5. `docs/CODEX_HANDOFF.md`
6. `THIRD_PARTY_NOTICES.md`
7. All files under `src/core/`
8. `tests/core.test.js`
9. `userscripts/insta-aio-companion.user.js`

Run:

```bash
npm test
```

Do not proceed with integration until the existing suite passes.

## Required audit

The user will provide source paths or repositories for three existing components. For each component:

- Identify framework/runtime.
- Identify entry points.
- Identify data files and schemas.
- Identify Instagram selectors/endpoints.
- Identify credentials/session handling.
- Identify dependencies and version constraints.
- Identify license and attribution requirements.
- Identify what is reusable versus obsolete.
- Identify conflicts with the current data model.
- Produce a written migration map before editing core code.

Do not claim a component was integrated when its source was not supplied.

## Architecture rules

- Keep `src/core/` platform-independent and testable.
- Put Instagram/browser-specific logic in `src/adapters/`.
- Put source migrations in `src/migrations/`.
- Do not put selectors, network endpoints, or credential/session code into `app.js`.
- Treat the existing queue, snapshot, account, message, and storage schemas as the starting contract.
- Add schema migrations instead of deleting existing local data.
- Preserve JSON/file exchange as a fallback even if an extension bridge is added.

## Required remaining work

Complete the highest-priority items in `docs/CODEX_HANDOFF.md`:

1. Integrate the user's actual existing components.
2. Add direct local ZIP import for current Instagram exports.
3. Add a reviewed action-adapter boundary with dry-run, confirmation, limits, checkpoints, and safe-stop behavior.
4. Add a live DM-unsend adapter with exact conversation/message resolution and sent-message revalidation.
5. Add browser/UI tests.
6. Produce migration and completion reports.

## Non-negotiable constraints

- No proxy rotation.
- No fingerprint spoofing.
- No CAPTCHA solving.
- No login-challenge bypassing.
- No private endpoint reverse engineering.
- No password collection, logging, or hidden storage.
- No cookie/session export.
- No guessed clicks when the UI is ambiguous.
- Stop immediately on action block, challenge, expired session, unexpected UI, or uncertain target.
- Never select or unsend received messages.
- Never silently discard migration data.
- Never auto-unfollow protected, whitelisted, preexisting, or mutual accounts.
- Do not include device-specific storage, SDK, runtime, machine-path, or environment details in user-facing documentation.

## Execution process

1. Create a new branch named `codex/integration-completion`.
2. Run and record the baseline test results.
3. Audit the supplied components and add `docs/COMPONENT_INTEGRATION_AUDIT.md`.
4. Add fixtures before writing migration code.
5. Implement migrations and adapters incrementally.
6. Keep live action execution disabled by default.
7. Implement dry-run before any live path.
8. Add explicit batch previews and confirmations.
9. Add durable checkpoints and duplicate prevention.
10. Add unit, integration, and browser tests.
11. Run all tests and a read-only browser verification.
12. Run only a user-initiated controlled live test with a batch size of one.
13. Update the README status table and `docs/CODEX_HANDOFF.md` honestly.
14. Commit logical changes with clear messages.
15. Open a pull request into `main` with test evidence, migration results, limitations, and rollback instructions.

## Acceptance gates

Do not mark complete until:

- Existing tests pass.
- New migrations have fixture coverage.
- Direct ZIP import works offline.
- The action adapter has a true no-click dry run.
- Daily limits and duplicate prevention are enforced transactionally.
- Protected accounts cannot enter an actionable unfollow state.
- The DM adapter cannot target received messages.
- Interrupted jobs resume from checkpoints.
- Ambiguous UI produces a safe stop.
- All actions and failures appear in the activity log.
- User-facing docs contain no machine-specific details.
- Installation and rollback steps are documented.

When a blocker remains, label it exactly `Codex-Handoff` in code comments and documentation, explain the blocker, and leave the repository in a passing state.

---
