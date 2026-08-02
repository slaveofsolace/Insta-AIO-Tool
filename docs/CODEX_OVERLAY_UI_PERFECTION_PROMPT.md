# Codex Task — Perfect the Insta AIO Overlay UI and Close the Remaining Quality Gaps

Continue development in:

`slaveofsolace/Insta-AIO-Tool`

Active branch and pull request:

- Branch: `codex/issue-3-controlled-account-action`
- Pull request: `#8 — Add Instagram Field Desk and controlled account/DM actions`

Do **not** replace the repository, reset the branch, reopen completed architecture decisions, merge the pull request, or weaken the existing controlled-action model. Treat the current branch as the working product and perform a bounded refinement pass.

## Mission

Bring the codebase—especially the injected **Insta AIO Field Desk** overlay—to release-quality engineering and product-design standards.

The overlay must become a genuinely lightweight, unobtrusive, precise operator surface that feels native beside Instagram rather than a second full dashboard floating on top of it. Preserve the PWA as the durable workspace and preserve every existing account/DM safety invariant.

This is not a broad visual refresh of the PWA. Concentrate on:

1. Overlay usability and visual quality
2. Overlay architecture and maintainability
3. Runtime performance on Instagram’s single-page application
4. Accessibility and responsive behavior
5. Overlay-specific visual regression coverage
6. Remaining correctness and encoding defects discovered during review

## Read first

Read these files before editing:

1. `README.md`
2. `docs/PROJECT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/INSTAGRAM_SIDECAR.md`
5. `docs/BROWSER_QA.md`
6. `docs/SECURITY_REVIEW.md`
7. `extension/instagram-overlay.js`
8. `extension/content-instagram.js`
9. `extension/background.js`
10. `extension/popup.html`
11. `extension/popup.css`
12. `src/adapters/extension-bridge-client.js`
13. `src/adapters/reviewed-action-adapter.js`
14. `src/adapters/reviewed-dm-adapter.js`
15. `tests/instagram-overlay.test.js`
16. `tests/fixtures/overlay-preview.html`
17. `scripts/extension-acceptance.mjs`
18. `scripts/chrome-pairing-acceptance.mjs`
19. `.github/workflows/ci.yml`

## Baseline first

Before changing source:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
pnpm run qa:extension
pnpm run qa:chrome
pnpm run qa:browser:check
git diff --check
```

Record the baseline results and preserve the last passing state. Capture current overlay screenshots from the actual production content scripts in the deterministic Instagram fixture before redesigning them.

## Existing work that must remain intact

The current branch already has substantial engineering work. Preserve it:

- Signed exact-origin extension pairing
- Separate read and action permissions
- Live account and DM execution disabled by default
- One reviewed account action or one reviewed sent message per live capability
- Exact confirmation phrases
- Ten-minute reviewed-intent freshness
- Ninety-second tab-scoped one-use arms
- Independent PWA and extension-side reservations
- Duplicate and daily-limit enforcement
- Exact profile/message revalidation immediately before mutation
- Safe stops on wrong targets, stale state, ambiguous controls, restrictions, challenges, or expired sessions
- No-click dry-run routes that cannot reach the page-control activator
- Postcondition verification and durable activity evidence
- Closed Shadow DOM in production
- Local-only imported data
- Existing PWA, migrations, desktop shell, Tampermonkey fallback, tests, and documentation

The UI refinement must not move destructive page-control logic into the overlay. `instagram-overlay.js` must continue to contain no Instagram control activator, `.click()` path, synthetic mutation event path, or hidden auto-execution route.

## Review findings that must be addressed

Treat the following as concrete work items, not optional suggestions.

### 1. Overlay visual QA is incomplete

The PWA has tracked desktop/tablet/mobile screenshot baselines, but the overlay is currently accepted mostly through DOM, focus, accessibility-tree, and action-fixture assertions. There is no complete overlay screenshot matrix proving composition, occlusion, native-dialog coexistence, dark mode, or small-height behavior.

Add a first-class overlay visual QA suite and evidence package.

### 2. The current overlay is too visually dominant

The existing first-load desktop behavior can open a fixed panel automatically. The panel is approximately 462 pixels wide, contains a 104-pixel text rail, occupies nearly the full viewport height, uses maximum z-index, and presents a high-contrast cream/black/acid-lime industrial shell.

That visual language is acceptable for the full PWA, but too heavy for an always-available Instagram field overlay. Replace it with a quieter, compact, high-end utility surface.

### 3. The overlay source is monolithic

`extension/instagram-overlay.js` currently owns static markup, all CSS, state, persistence, bridge calls, view renderers, downloads, routing, dialogs, and event handling in one large file.

Refactor the source into focused testable modules while keeping the packaged output deterministic and lightweight. Do not add React, Vue, Svelte, a runtime CSS framework, remote assets, or a large UI dependency to the content script.

### 4. Theme handling is incomplete

The overlay forces a light color scheme. It must support `auto`, `light`, and `dark`, with `auto` matching Instagram’s rendered theme. Theme changes must not require a page reload.

### 5. Navigation semantics are incomplete

The five view controls use `aria-selected` without a complete tablist/tab/tabpanel contract. Implement correct semantics and keyboard behavior, or use a different semantic navigation pattern without misusing `aria-selected`.

### 6. The overlay can compete with Instagram controls and dialogs

The current fixed maximum-z-index surface can cover page content or native action dialogs. The overlay must never obscure the exact Instagram control or confirmation surface being reviewed.

Add explicit collision/coexistence behavior. When a relevant Instagram menu or dialog appears, or when a controlled action enters its execution phase, collapse the panel to a minimal non-obstructive status strip or move it away from the target. Do not modify Instagram’s layout or suppress its UI.

### 7. SPA route observation uses recurring polling

The overlay checks `location.href` every 1.5 seconds. Replace this with a low-impact route observer using the best available combination of the Navigation API, `popstate`, and a bounded/debounced DOM observer. Do not leave an always-running location polling loop.

### 8. Small-height behavior is not adequately constrained

The current desktop panel uses a fixed top/bottom inset plus a `min-height`. It must not overflow, clip actions, or create unreachable controls on short laptop windows, browser side panels, 200% zoom, or mobile landscape.

### 9. Preferences are too limited

Persist a versioned overlay preference record with migration from the current preference key. Support at least:

- Open/collapsed state
- Last view
- Dock side: left or right
- Width preset: compact, standard, or wide
- Theme: auto, light, or dark
- Density: comfortable or compact
- Optional first-run completion state

Do not persist sensitive Instagram content in preferences.

### 10. Two correctness defects require explicit remediation

- Fix the mojibake string `zurÃ¼cknehmen`. Audit the repository for other broken UTF-8/localization strings and add regression coverage.
- The resolution-token fallback must fail closed if a cryptographically secure random source is unavailable. It must never silently return predictable all-zero or low-entropy tokens.

Also isolate locale-dependent action labels into a reviewed normalization module with fixture coverage. Do not expand selector guessing merely to increase apparent compatibility.

## Product direction

### Core principle

**Instagram is the context; Insta AIO is the precise next-step layer.**

The overlay should answer, in order:

1. Where am I?
2. Is this the exact reviewed target?
3. What is the single next safe action?
4. Why is anything locked?
5. Where is the durable record?

Do not make the operator read a second dashboard before performing a simple review.

### Visual character

Use a quiet, professional extension aesthetic:

- Neutral surfaces that match Instagram’s current light or dark theme
- One restrained brand accent; acid lime may remain as a small status/accent signal, not the dominant surface color
- Clear hierarchy, generous but efficient spacing, and high legibility
- Subtle borders and shadows instead of hard offset shadows and clipped-corner decoration
- Consistent 8–12 pixel radii
- Minimum 12-pixel secondary text and deliberate 14-pixel control text
- Production-quality inline SVG icons with consistent stroke weight
- No decorative marketing cards, feature numbering, oversized branding, or filler copy
- No remote fonts, images, analytics, or CDNs

The overlay should look polished in both themes while remaining visually subordinate to Instagram.

## Required shell behavior

### Collapsed launcher

- Default to **collapsed on first install**, including desktop.
- Use a compact 40–44 pixel launcher or narrow labeled pill.
- Place it within safe viewport insets and avoid Instagram’s primary bottom/right controls.
- Provide a clear accessible name and visible focus state.
- Show only meaningful state indicators: attention required, ready intent, armed countdown, or safe stop.
- Do not animate continuously or pulse for ordinary states.

### Open panel

- Default width: approximately 380 pixels.
- Supported range: approximately 336–500 pixels, capped to a sensible viewport percentage.
- Replace the 104-pixel text rail with either:
  - a 44–52 pixel icon rail with accessible labels/tooltips, or
  - a compact top tab bar.
- Support left/right docking and width presets.
- Make the header and critical footer/action area sticky when content scrolls.
- Use `100dvh`, safe-area insets, and short-height media queries.
- Never rely on a minimum height that can exceed the available viewport.
- Opening, closing, docking, and resizing must not shift or rewrite Instagram’s DOM.

### Narrow and mobile behavior

- At narrow widths, use a bottom sheet or compact full-width drawer rather than immediately forcing a permanent full-screen takeover.
- Keep a visible close/collapse affordance.
- Respect `env(safe-area-inset-*)`.
- Verify portrait, landscape, and 200% zoom.
- Touch targets must be at least 44 by 44 CSS pixels where practical.

## Information architecture

Keep the five capabilities, but make **Now** route-aware and reduce unnecessary navigation.

### Now

The first view must adapt to the current Instagram context.

#### Profile page

Show:

- Exact username
- Current relationship
- Whether identity is verified or ambiguous
- Queue match and protection state
- The single next safe action
- Concise route/session warnings

#### Followers/following dialog

Show:

- Detected list type
- Visible rows in the current batch
- Unique rows already in the draft
- Duplicate rows ignored
- Primary `Capture visible rows` action

#### Direct-message thread

Show:

- Conversation identity status
- Visible evidence count
- Whether an exact reviewed target is available
- The single next safe review action

#### Unsupported/neutral route

Show a concise no-context state and the relevant navigation choices. Do not display a dense empty ledger.

### Capture

Required states:

- No supported list open
- List detected, nothing captured
- Capture completed
- Repeated capture with duplicate count
- Maximum/bounded capture state
- Storage failure

Show batch count, unique total, duplicates ignored, last-captured time, and a compact preview. Keep manual scrolling and explicit capture. Never auto-scroll.

### Queue

Make the current reviewed item the focal object:

- Username and action
- Status and schedule
- Protection reasons
- Remaining actionable count
- Open profile
- Complete
- Skip
- Controlled live gate, collapsed until relevant

Move verbose signed-run history behind an expandable disclosure or secondary subview. Do not combine the current queue item, large safety explanation, live gate, and long run history into one undifferentiated page.

Required live-gate states:

- Locked
- Waiting for exact profile
- Exact target ready
- Arming dialog open
- Armed with visible countdown
- Expired
- Canceled
- Executing in PWA
- Completed
- Safe stop/uncertain

Arming remains separate from execution. The overlay must never imply that `Arm` itself performs the follow/unfollow.

### Messages

Render visible evidence in a compact thread-like presentation rather than an unstructured text list.

- Distinguish `sent`, `received`, and `ownership unknown` only when the available evidence supports that classification.
- Never visually label ownership as certain when it is not.
- Highlight only the exact reviewed message when stable identity is available.
- Keep generic visible-text capture explicitly marked as evidence-only.
- Put exact identity, ownership, timestamp, and digest details behind a disclosure.

Required states:

- No conversation open
- Evidence-only fragments available
- Exact target unavailable
- Wrong conversation
- Exact sent target ready
- Armed with countdown
- Expired/canceled
- Removed and verified
- Uncertain safe stop

### Workspace

Replace the current feature-marketing list with operational status:

- Paired/unpaired
- Exact paired origin
- Read/action permissions
- Extension version
- Last successful bridge contact
- Open workspace
- Re-pair or revoke guidance

Keep privacy boundaries concise and accessible through a disclosure.

## Copy and state communication

- Replace long technical paragraphs in the primary workflow with concise operator copy.
- Use progressive disclosure for protocol details and safety explanations.
- Always distinguish `locked`, `ready`, `armed`, `executing`, `completed`, and `uncertain`.
- Do not use color alone.
- Show absolute target identity beside every destructive state.
- Use an accurate countdown derived from `expiresAt`; do not extend the arm by rerendering.
- Announce only major state transitions through `aria-live`; do not announce every countdown tick.
- Error copy must state the safe next step and must not encourage retry loops against an Instagram restriction.

## Overlay architecture

Refactor the hand-maintained monolith into source modules. One acceptable structure is:

```text
extension/src/overlay/
├── index.js
├── model.js
├── preferences.js
├── route-observer.js
├── bridge.js
├── downloads.js
├── accessibility.js
├── render.js
├── tokens.css
├── overlay.css
├── ui/
│   ├── icons.js
│   ├── status.js
│   ├── disclosure.js
│   └── arm-dialog.js
└── views/
    ├── now.js
    ├── capture.js
    ├── queue.js
    ├── messages.js
    └── workspace.js
```

Adapt the exact structure to the existing extension build system, but preserve these boundaries:

- Pure state and normalization logic must be directly unit-testable.
- Bridge calls must be isolated from visual rendering.
- View rendering must not own persistence.
- Static style tokens must not be duplicated across views.
- Dynamic Instagram text must enter the DOM through `textContent` or equivalent safe node creation.
- Packaged content scripts may remain deterministic single-file outputs if the build step produces them.
- Generated bundles must not be hand-edited.
- Build output must be reproducible and validated by `build-extension.mjs`.

Do not add a runtime framework just to split the file.

## Route and lifecycle behavior

Replace the recurring 1.5-second route poll.

Implement one bounded route/context observer that:

- Uses `window.navigation` events when available
- Handles `popstate`
- Detects SPA route changes through a debounced, narrowly scoped observer when needed
- Does not inspect or rerender on irrelevant high-frequency DOM mutations
- Refreshes only the context-dependent view
- Clears stale message/profile evidence immediately on route change
- Never installs duplicate hosts, observers, timers, or listeners
- Provides teardown for test/runtime cleanup

Also:

- Revoke all generated object URLs on replacement and teardown.
- Avoid full overlay rerenders for countdown ticks or unrelated page mutations.
- Pause expensive page inspection while collapsed unless an exact signed intent requires monitoring.
- Keep idle CPU effectively negligible.
- Record a basic performance measurement for collapsed idle state, open idle state, route transition, and a 2,000-item imported queue.

## Collision and execution presentation

Add a dedicated execution-safe presentation mode.

When an exact Instagram menu/dialog is expected or currently visible:

- Collapse the main panel to a small status strip away from the target.
- Keep `Cancel`, current target, and state visible when safe.
- Do not cover the target control, menu, confirmation, or message row.
- Do not synthesize clicks from the visual overlay.
- Do not move, hide, restyle, or intercept Instagram controls.
- Restore the prior panel state only after the native surface closes and context is revalidated.

Add deterministic geometry tests that prove the overlay does not intersect the fixture’s target control, message row, menu, or confirmation dialog during each controlled workflow.

## Accessibility requirements

Implement and test:

- Correct navigation semantics
- Arrow-key, Home, and End behavior when using tabs
- Visible focus for every control
- Focus restoration after collapse and dialogs
- Native dialog focus containment and Escape behavior
- No keyboard trap between the closed Shadow DOM and Instagram
- Descriptive labels for icon-only controls
- `aria-current`, `aria-selected`, `aria-expanded`, and live-region use only where semantically correct
- Reduced motion
- Forced-colors/high-contrast support
- 200% browser zoom
- Logical reading order
- Minimum contrast meeting WCAG AA for ordinary text and controls
- Major states understandable without color
- Human-readable timestamps and countdowns

Run automated accessibility-tree checks, but do not claim human screen-reader acceptance unless a person actually performs it.

## Visual QA requirements

Create a dedicated deterministic overlay harness using the actual production-built content scripts and a more faithful synthetic Instagram shell.

### Required fixture scenarios

At minimum:

1. Profile / not following / no queue match
2. Profile / following / queue match
3. Profile / ambiguous safe stop
4. Followers dialog / first capture
5. Following dialog / repeated capture with duplicates
6. Queue / locked
7. Queue / exact target ready
8. Queue / armed countdown
9. Queue / expired or canceled
10. Messages / evidence only
11. Messages / exact sent target ready
12. Messages / wrong conversation safe stop
13. Messages / armed countdown
14. Workspace / unpaired
15. Workspace / read-only paired
16. Workspace / action permission paired
17. Instagram native menu/dialog coexistence
18. Session expired/challenge/rate-limit states

### Required visual matrices

Capture representative scenarios at:

- 1440 × 900 desktop
- 1280 × 720 short laptop
- 820 × 900 narrow desktop/tablet
- 390 × 844 mobile portrait
- Mobile landscape or another short-height viewport
- Light theme
- Dark theme
- 200% zoom for at least the core profile and queue workflows

Capture both collapsed and open states where relevant.

### Visual regression implementation

Add commands such as:

```bash
pnpm run qa:overlay:update
pnpm run qa:overlay:check
```

Requirements:

- Test the built production extension source, not a separate mock component.
- Use a pinned browser and deterministic fixture data.
- Use platform-specific baselines or a reviewed perceptual-diff threshold; do not pretend raw screenshot hashes are cross-platform proof.
- Never update visual baselines automatically in ordinary CI.
- Require an explicit baseline-update flag or command.
- Fail on clipping, overlap, unreadable text, missing focus, incorrect state, horizontal overflow, or unexpected visual drift.
- Store reviewed evidence under a dated `docs/evidence/overlay-ui-*` directory.
- Write a fidelity ledger comparing the old and new overlay across shell size, hierarchy, theme, navigation, queue, messages, collision handling, mobile, and accessibility.

## Runtime and behavioral tests

Expand tests beyond source-text regular expressions.

Add direct runtime coverage for:

- Preference V1 → V2 migration
- Default-collapsed first run
- Dock-side and width persistence
- Theme auto/light/dark switching
- No duplicate host after repeated SPA navigation
- No recurring location polling
- Correct route/context refresh
- Correct tab semantics and keyboard navigation
- Arm countdown expiration without TTL extension
- Native-dialog collision mode
- Mobile/small-height layout
- 200% zoom containment
- High-contrast state legibility
- Storage failures
- Bridge unavailable/reconnected
- 2,000 queue items without unbounded DOM output
- Object-URL cleanup
- Exact UTF-8 action labels
- CSPRNG failure-safe behavior
- No overlay `.click()` or synthetic destructive-event path
- Live settings and permissions remaining off by default
- Dry-run routes remaining unable to reach the page-control activator

Keep all existing controlled Follow, Unfollow, Unsend, replay-rejection, pairing, installation, and packaging tests passing.

## Permission and security review

Audit the extension manifest and runtime requests again:

- Confirm whether `tabs`, `scripting`, and the broad optional host patterns are all necessary.
- Narrow permissions when the same behavior can be preserved.
- Request optional origin access only for the exact PWA origin.
- Do not add remote code, remote fonts, analytics, telemetry, or broad content access.
- Preserve closed Shadow DOM in production.
- Preserve signed messages, nonce replay protection, and secret isolation.
- Do not expose cookies, session material, pairing secrets, signatures, or destructive tokens to the page.
- Fail closed on unavailable cryptographic randomness.

Run a diff-focused security review after implementation. Use CodeRabbit when authenticated and available; otherwise record the manual review method honestly. Do not attribute a manual review to CodeRabbit.

## Exact safety constraints

These are non-negotiable:

- No proxy rotation
- No fingerprint spoofing
- No CAPTCHA solving
- No login-challenge bypassing
- No private endpoint reverse engineering
- No cookie or session export
- No password collection or logging
- No hidden credential storage
- No auto-scroll
- No mass action exposed through the overlay
- No action without explicit reviewed intent and exact target
- No received-message Unsend path
- No guessed click when identity or UI is ambiguous
- No retry loop after restriction, challenge, rate limit, or action block
- No weakening of one-item limits, intent freshness, arm TTL, dual reservations, or postcondition verification

## Implementation sequence

1. Run and record the full baseline.
2. Capture the current overlay visual matrix.
3. Write `docs/OVERLAY_UI_AUDIT.md` with concrete current-state problems and measurements.
4. Produce two rendered shell concepts in the deterministic fixture:
   - Compact Instagram-native utility
   - Quiet professional operator panel
5. Score them against occlusion, clarity, cognitive load, accessibility, dark/light fit, implementation risk, and safety-state visibility.
6. Select one direction and write `docs/OVERLAY_UI_SPEC.md` before final implementation.
7. Refactor source boundaries without changing behavior.
8. Add preference migration and the new shell.
9. Implement route-aware Now, Capture, Queue, Messages, and Workspace states.
10. Implement collision/execution-safe mode.
11. Replace route polling and complete lifecycle cleanup.
12. Add accessibility behavior.
13. Add runtime and visual regression tests.
14. Run the full verification matrix.
15. Perform the diff-focused security and permissions review.
16. Update documentation, screenshots, README status, and PR #8’s body.
17. Leave PR #8 in draft until all automated and visual gates pass and the final evidence is attached.

Do not ask for design approval during this pass. Make the selection using the documented scorecard and preserve the rejected concept evidence for comparison.

## Final verification commands

At minimum, the final branch must pass:

```bash
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
pnpm run qa:extension
pnpm run qa:chrome
pnpm run qa:browser:check
pnpm run qa:overlay:check
pnpm run benchmark:zip
git diff --check
```

Run desktop packaging checks only when affected by the changes, but verify that extension build/package contents remain correct on every pass.

## Acceptance gates

Do not mark the refinement complete until all of the following are true:

### Visual and interaction

- First-run overlay is collapsed.
- Open overlay is visibly lighter and less obstructive than the current implementation.
- Light and dark modes both match Instagram’s surrounding theme.
- The panel does not cover target profile controls, message rows, menus, or confirmation dialogs.
- Short laptop, mobile, landscape, and 200% zoom states have no clipped required actions.
- Every primary state has reviewed screenshot evidence.
- No primary text is unreadably small or over-dense.
- Queue and message workflows expose one obvious next action.
- Safety protocol details remain available without dominating the default view.

### Architecture and performance

- Overlay source is split into testable modules or generated from modular source.
- There is no recurring 1.5-second location poll.
- Route changes do not duplicate the host, listeners, observers, or state.
- Preference migration preserves existing open/view state.
- Collapsed idle work is effectively negligible.
- A 2,000-item queue does not create 2,000 rendered rows at once.

### Accessibility

- Navigation semantics and keyboard behavior are correct.
- Focus remains deterministic through open, close, route change, and arming dialog flows.
- Automated accessibility checks pass.
- Reduced motion, forced colors, dark mode, mobile, and 200% zoom are covered.
- No human screen-reader claim is made without human verification.

### Correctness and security

- Mojibake is removed and tested.
- Resolution tokens fail closed without CSPRNG.
- The overlay still has no destructive activator.
- Existing controlled account/DM tests pass.
- Live settings remain disabled by default.
- Permissions are no broader than required.
- All destructive ambiguities still safe-stop.

## Authenticated acceptance boundary

Do not execute an authenticated Instagram Follow, Unfollow, or Unsend action as part of this UI pass.

A read-only authenticated walkthrough with the sidecar loaded is acceptable only when it does not arm an intent or open a destructive menu. Any step requiring the user’s persistent profile, selected target, or actual message must remain labeled exactly:

`Codex-Handoff`

Provide a bounded operator checklist for that step; do not claim it was completed.

## Final deliverables

Commit:

- Refined overlay source and deterministic build output
- Preference schema migration
- Route observer and teardown
- Overlay visual QA scripts and baselines
- Expanded runtime/accessibility tests
- `docs/OVERLAY_UI_AUDIT.md`
- `docs/OVERLAY_UI_SPEC.md`
- `docs/OVERLAY_QA.md`
- Dated screenshot evidence
- Updated `docs/INSTAGRAM_SIDECAR.md`
- Updated `docs/BROWSER_QA.md`
- Updated README status
- Updated PR #8 body

Use logical commits. Do not squash away the design-audit and test evidence while the PR remains under review.

## Final report format

Return:

1. Branch head SHA
2. Commit list
3. Current-state defects fixed
4. Chosen design direction and scorecard rationale
5. Before/after overlay dimensions and behavior
6. Architecture changes
7. Accessibility results
8. Performance measurements
9. Visual-regression matrix and evidence paths
10. Complete test-command results
11. Security/permission review result
12. Remaining `Codex-Handoff` items
13. Explicit nonclaims

Do not say the overlay is “perfect,” “production ready,” or “fully verified” unless every gate above has direct evidence.