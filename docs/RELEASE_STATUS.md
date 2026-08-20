# Release status

Current version: **0.11.0**

## Available tools

### Follower checker

- Imports Instagram relationship exports and supported legacy formats.
- Captures Following and Followers lists from the in-page extension or
  userscript, then compares them locally.
- Reports mutuals, accounts that do not follow back, and accounts the user does
  not follow back.
- Filters any comparison group by captured username or display name, locally.
- Does not need live-action permission.

### Follow / Unfollow

- Builds a fixed review list before a run can start.
- Supports true dry runs that do not activate Instagram controls.
- Requires a typed, time-limited authorization and a separate confirmation for
  any live userscript batch.
- Extension live jobs are limited to one reviewed account, with signed intent,
  exact profile matching, independent reservations, and post-action checks.
- Live execution is disabled by default.

### DM Unsend

- Identifies messages sent by the current user in an exact conversation.
- Supports read-only inspection and no-click dry runs.
- The signed extension path is limited to one reviewed message with stable
  thread and message identity.
- The userscript and extension thread runner require a successful no-click
  conversation check followed by an exact thread, scope, finite count,
  reviewed digest, expiry, typed phrase, and final confirmation.
- Live execution is disabled by default.

## Delivery formats

- **Tampermonkey userscript:** one-file Instagram overlay with all three tools.
- **Chrome extension:** Manifest V3 overlay plus optional signed pairing with
  the PWA.
- **PWA:** local imports, comparisons, message search, reviewed jobs, and
  activity history.
- **Desktop:** Electron packaging for Windows and macOS.

All imported data and local run state remain on the user's machine. The project
does not require an application account or hosted data service.

Fresh extension installs show a compact three-tool walkthrough the first time
the launcher is opened. Migrated profiles keep their prior view and are not
shown the walkthrough again.

## Automated verification

The repository includes checks for:

- deterministic PWA assembly;
- extension and userscript build reproducibility;
- import, migration, archive, and data-contract behavior;
- no-click action and DM paths;
- target matching, replay rejection, expiry, duplicate prevention, and safe
  stops;
- extension permissions and signed pairing;
- production content-script acceptance against synthetic Instagram fixtures;
- PWA and overlay screenshot baselines;
- desktop package smoke tests in CI.

The final local Windows matrix currently passes **222/222 tests**, nine PWA
screenshots, 42 overlay states, isolated extension/userscript fixture
acceptance, and disposable-Chrome extension/PWA pairing. The Windows 0.11.0
installer builds successfully and is intentionally unsigned.

Exact commands are documented in [Overlay QA](./OVERLAY_QA.md),
[Browser QA](./BROWSER_QA.md), and the [Maintainer guide](./MAINTAINER_GUIDE.md).

## Manual release checks

These checks require the operator's browser, account, credentials, or judgment
and are not automated:

- install the current userscript or unpacked extension in the intended Chrome
  profile;
- confirm the overlay on current Instagram profile, list, and conversation
  routes without arming a live action;
- complete a human screen-reader walkthrough;
- verify persistent-profile PWA pairing;
- sign and notarize macOS packages for public distribution;
- if desired, authorize and observe a single real Instagram action against an
  explicitly selected target.

Automated fixture results do not establish current authenticated Instagram
selector compatibility. No live Instagram action is part of the default test or
build process.

## Supporting records

- [Source audit](./SOURCE_AUDIT.md)
- [Component integration audit](./COMPONENT_INTEGRATION_AUDIT.md)
- [Component migration report](./COMPONENT_MIGRATION_REPORT.md)
- [Security review](./SECURITY_REVIEW.md)
- [Operator acceptance runbook](./OPERATOR_ACCEPTANCE.md)
