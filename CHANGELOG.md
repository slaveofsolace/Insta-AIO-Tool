# Changelog

This project uses [Semantic Versioning](https://semver.org/).

## 3.1.7 - 2026-09-07

- Recognize Instagram's hash-link follower counters inside the exact profile header. This removes the unintended profile-count fallback on current profile pages.
- Match the browser fixtures to that markup and reject hash-link counts outside the correct profile header.
- Match the page size and list-specific parameters used by Instagram's web dialogs. Remove extra grouping and search parameters from background requests.

## 3.1.6 - 2026-09-07

- Check both lists in the background from an open profile, using its exact displayed totals instead of two extra profile-count requests.
- Recognize HTML rate-limit and sign-in responses before decoding JSON. Stop without retries or a manual-scan fallback.
- Keep the request timeout active through the response body and abort stalled downloads before retrying.
- Make manual list capture optional in the context banner. Preserve complete-only comparisons and previous results after failures.

## 3.1.5 - 2026-09-07

- Withhold Mutual Checker comparisons and comparison downloads until both lists are complete. Keep partial rows available separately under Advanced.
- Scan overlapping windows from the top of virtualized dialogs, retaining rows as Instagram recycles them and reacquiring replaced scrollers.
- Require an exact profile total for dialog completion; a quiet scrollbar alone is not proof.
- Reject limited or unfinished API responses even when their counts happen to match. Missing counters are no longer interpreted as zero.
- Preserve saved data while requiring a fresh scan of older dialog captures with unproven completion.

## 3.1.4 - 2026-09-06

- Stop DM Unsend and pending message checks when the open conversation changes, including browsers without navigation events.
- Cancel pending menu waits and release the run so another conversation can be used without refreshing.
- Update the fast-uri build dependency to 3.1.6.

## 3.1.3 - 2026-08-26

### Fixed

- Read Followers and Following with one cursor traversal instead of restarting the entire list.
- Match Instagram's current follow-list request shape and detect platform-limited lists.
- Explain missing cursors and limited lists without marking partial comparisons complete.
- Keep progress tied to the single active traversal, including bounded request retries.

## 3.1.2 - 2026-08-26

### Added

- Browse, search, and progressively reveal all three Mutual Checker comparison groups inside the Instagram toolbox.
- Keep both downloads: a readable text report and the schema-1 JSON record under **Capture lists and export**.
- Show visible disclosure arrows on secondary tool sections in the extension and userscript.

### Fixed

- Retry incomplete relationship pagination with three isolated passes without combining changing memberships into a false complete result.
- Stop duplicate cursor pages from hanging, reacquire replaced list scrollers, ignore unrelated profile counters, and keep uncertain list ends partial.
- Replace the jumping Mutual Checker bar with verified count-based progress and an honest indeterminate state when the total is unknown.
- Prevent a failed manual rescan from presenting an older saved list as a new result.
- Replace stale rows after a complete rescan and isolate manual captures when the profile changes.
- Keep partial or differently sourced captures available for review and export without allowing them to create Follow or Unfollow targets.
- Show verified empty lists as scanned, replace failed-scan progress text, stack narrow result filters, and announce coarse progress and filtered counts.

## 3.1.1 - 2026-08-26

### Fixed

- Prevented duplicate **IT** launchers when more than one current userscript copy starts on the same page.
- Corrected the Tampermonkey guide with arrows on the exact Chrome permission and left-side Install controls.

### Changed

- Added direct support, issue, and Buy Me a Coffee links below the one-minute installation steps.

## 3.1.0 - 2026-08-26

### Changed

- Made the collapsed **IT** button draggable and keyboard-movable across the viewport.
- Added matching lower-left and lower-right resize controls to both in-page surfaces.
- Replaced the loose settings popover with a named modal that dims the page and closes when clicking outside it.
- Added accent, background blur, and collapsed-button size choices without changing saved tool data.
- Removed the redundant first-run card so the three tools open directly.
- Replaced the duplicated installer text with a three-step Tampermonkey guide and click-by-click images.

### Safety

- Follow, Unfollow, and DM Unsend behavior is unchanged. Each live run still requires its exact action confirmation and stops on an uncertain Instagram state.

## 3.0.0 - 2026-08-24

### Changed

- Prepared the public repository identity and release files for **Insta Toolbox**.
- Moved the userscript to `userscripts/insta-toolbox.user.js` and the stable GitHub release update channel.
- Reorganized the overlay around Mutual Checker, Follow / Unfollow, and DM Unsend while keeping the workspace app for imports, comparisons, reviewed plans, ledgers, and exports.
- Updated package metadata, offline cache generation, install documentation, and release automation for the 3.0 line.
- Raised the development and CI runtime to Node.js 24.

### Safety

- Live actions remain off until an action-specific confirmation mints a transient capability.
- Follow, Unfollow, and Unsend stop on changed targets, ambiguous controls, challenges, blocks, rate limits, expiry, or uncertain results.
- The `all` DM scope has no user quota; an internal watchdog only prevents an unbounded runaway process.

### Delivery

- Added a protected, artifact-promotion release workflow. It publishes the exact artifacts from a successful `main` CI run without rebuilding.
- Added SHA-pinned CodeQL, dependency review, Dependabot, weekly account-free compatibility, GitHub Pages deployment, SBOM generation, and provenance attestation.
- Added versioned compatibility and acceptance records.

### Breaking changes

- The 2.x userscript identity, old repository filenames, and raw-branch update URL are not retained as aliases.
- Version 3.0 starts with new local identifiers. It does not read, migrate, or
  delete 2.x browser or desktop state.
- Remove any enabled 2.x script before installing 3.0.

## 2.0.3 - 2026-08-24

- Unified public branding, icons, desktop packaging, and release filenames.
- Added universal macOS package verification and bounded desktop startup recovery.

## 2.0.2 - 2026-08-24

- Restored streaming DM traversal across virtualized conversations.
- Added compact overlay geometry, checksum manifests, and authenticated one-message Unsend acceptance.

Earlier development history is available through the repository tags and commit log.
