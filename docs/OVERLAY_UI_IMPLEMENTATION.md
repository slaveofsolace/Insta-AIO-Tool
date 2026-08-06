# Overlay UI implementation

## Current checkpoint

The current implementation is based on main commit `8f853d4` and the bounded
2026-08-05 overlay usability update. It preserves the modular production graph,
PWA, migrations, existing exchange contracts, and signed one-item bridge while
adding the operator-facing behavior requested from the installed Chrome build:

- draggable header and two resize corners on desktop;
- fitted mobile/bottom-sheet geometry with no horizontal overflow;
- persisted 55–100% surface opacity with an 88% default;
- an explicit three-tool landing surface;
- the same three-tool engine in the generated Tampermonkey script; and
- default-locked local batches plus an expiry-enforcing thread Unsend runner.

This is runtime-tested synthetic-fixture evidence, not authenticated Instagram
mutation or human accessibility acceptance.

## Runtime surfaces

The PWA remains the durable workspace. The Manifest V3 companion injects the
full Instagram overlay and owns these in-page surfaces:

| Surface | In-page responsibility | Durable authority |
| --- | --- | --- |
| Now | Route, session, exact profile relationship, queue match, next safe step | None |
| Capture | Merge rendered rows or deliberately scan the open Followers/Following dialog to completion | PWA after explicit import |
| Queue | Navigate local items, compare follower drafts, run phrase-gated paced account batches, and show signed summaries | PWA reviewed jobs/ledgers for signed runs; extension-local state for toolbox batches |
| Messages | Capture visible fragments, expose a phrase-gated thread Unsend runner, and show the exact signed DM gate when available | PWA reviewed job/ledgers for signed one-message work; tab-scoped authorization for thread runs |
| Workspace | Show sanitized pairing facts and link to the exact paired origin | PWA |

The generated Tampermonkey script embeds the same exact-label and Instagram
engine sources behind a userscript-specific three-tab shell. It supports full
list scanning/comparison, no-click review, paced Follow/Unfollow, and thread DM
Unsend. Destructive controls start disabled and need a typed, non-persistent
15-minute authorization plus a separate run confirmation. It does not receive
the signed extension bridge, PWA one-item arms, or durable workspace ledgers.

## Module graph

The manifest loads classic content scripts in a deterministic order:

```text
action-labels.js
content-instagram.js
overlay/shared.js
overlay/preferences.js
overlay/route-observer.js
overlay/theme.js
overlay/bridge.js
overlay/downloads.js
overlay/accessibility.js
overlay/collision.js
overlay/icons.js
overlay/shell.js
overlay/views/now.js
overlay/views/capture.js
overlay/views/queue.js
overlay/views/messages.js
overlay/views/workspace.js
instagram-overlay.js
```

`instagram-overlay.js` is now the lifecycle owner. It creates the closed shadow
root, loads storage, applies preferences, refreshes sanitized bridge state,
coordinates focus and keyboard events, owns persistence, starts and tears down
observers, updates the immutable-expiry countdown, and revokes resources. View
modules render or handle their bounded tool interaction but do not directly call
Chrome storage.

## Preference migration

The stored record is now `instaAioOverlayPreferencesV3`. V1 and V2 records are
migrated additively.

| Field | Fresh V3 default | Prior-record migration |
| --- | --- | --- |
| `open` | `false` | Preserve a valid V1 boolean |
| `section` | `now` | Preserve a valid V1 section |
| `dock` | `right` | Add default |
| `width` | `standard` | Add default |
| `theme` | `auto` | Add default |
| `density` | `comfortable` | Add default |
| `firstRunComplete` | `false` | Set `true` for a migrated V1 operator |
| `position` | `null` | Add bounded default |
| `panelWidth` | `null` | Add bounded 320–560 px custom size |
| `panelHeight` | `null` | Add bounded 280–1200 px custom size |
| `opacity` | `0.88` | Add/clamp to 0.55–1.00 |

Invalid fields are repaired independently. Storage failures keep the in-memory
safe defaults and surface an error instead of pretending a preference was
saved. Capture and queue contracts remain V1 and import-compatible.

## Interaction and visual behavior

- Fresh installs start as a 44-pixel launcher; the panel does not take over the
  Instagram page on first load.
- Standard width is 380 pixels, with 336- and 480-pixel presets, left/right
  docking, bounded custom size, persisted desktop position, and reset control.
- The five tools remain visible in a 48-pixel semantic rail; Arrow keys plus
  Home and End move between tabs.
- Auto theme follows rendered Instagram light/dark state without reloading.
- At 600 pixels or narrower the panel becomes a bounded bottom sheet.
- Surface opacity is adjustable from 55% to 100%; backdrop blur and stronger
  inner surfaces preserve legibility while Instagram remains visible below.
- Short-height, reduced-motion, forced-color, focus-restoration, and closed
  shadow-root rules are part of the production shell.
- Route changes use Navigation API, `popstate`, and debounced URL comparison;
  there is no recurring location poll.

## Execution boundary

Overlay views do not own Instagram selectors or synthetic event sequences. They
can request or cancel one exact 90-second signed arm, request an exact phrase for
a local account batch, or create a separate `UNSEND ALL DMS` tab arm. Execution
remains in the audited background/content drivers. The thread runner itself
requires a future authorization expiry and rechecks it before every message;
the first unlock never opens a menu or removes anything.

While an arm is active, or for a bounded ten-second transition after the bridge
consumes one, the full panel is suspended. A measured status strip is placed on
a non-intersecting edge when possible. Relevant native dialogs or menus keep the
overlay in this collision-safe state. If no safe rectangle exists, overlay
controls stay hidden; Instagram is never moved or restyled.

Pending intents and arms are sanitized again in the overlay and discarded when
expired. Dynamic Instagram, queue, message, pairing, and run text is written
with `textContent`. One audited static shell assignment is the only overlay
`innerHTML` use. Object URLs are revoked on replacement and teardown.

## Verification recorded at this checkpoint

Lightweight checks completed after the implementation:

- Syntax checks for every production overlay module and bootstrap: pass
- `tests/instagram-overlay.test.js`, `tests/extension-package.test.js`,
  `tests/overlay-preferences.test.js`, and
  `tests/overlay-runtime-modules.test.js`: 27 passed, 0 failed
- `node scripts/build-extension.mjs --check`: 25 controlled-live safety tests
  passed and package validation passed
- Overlay source scan: no `.click()`, `dispatchEvent()`, or `setInterval()`

The QA sources cover 39 unique scenarios, state-specific assertions on all 20
required states, selector contracts, child-process watchdog escalation, and
rejection of a deliberately wrong semantic state. On Windows, all scenarios
rendered through the production content-script graph and passed semantics,
geometry, collision, accessibility-tree, and screenshot checks. The changed key
states were inspected at full resolution, and the complete matrix was reproduced
by the non-updating baseline check.

The 2026-08-05 guarded matrix also passed assembly, all 186 repository tests,
production extension fixture acceptance, real Chrome pairing,
nine PWA screenshot baselines, the 39-state overlay update/check, the ZIP
benchmark, and whitespace validation. The measured overlay probe rendered one
bounded current item after a 2,000-item queue update in 25.9 ms with 234 overlay
nodes; route transition was 97.8 ms. The review procedure and platform boundary
are recorded in [`OVERLAY_QA.md`](./OVERLAY_QA.md).

## Nonclaims

- No authenticated Instagram mutation was attempted.
- Agent visual review is not a human visual or screen-reader acceptance claim.
- Deterministic fixture checks do not prove current authenticated Instagram DOM
  compatibility.
- Automated accessibility checks do not replace human screen-reader review.
- Windows screenshot hashes do not establish Linux or macOS visual parity.
