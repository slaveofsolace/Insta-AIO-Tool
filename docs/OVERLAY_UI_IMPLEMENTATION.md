# Overlay UI implementation

## Current checkpoint

The selected quiet-operator design is implemented on
the overlay work branch in these local commits:

- `6da61d8` — modular production overlay, ordered packaging, V1-to-V2
  preferences, fixture wiring, and focused contracts
- `6f8bc7b` — lifecycle-owned persistence plus package checks for polling,
  remote UI assets, and unsafe dynamic markup
- `75de3b2` — documented modular overlay checkpoint and acceptance boundary
- `b88f926` — preserved expired/canceled/executing arm outcomes in the overlay

The working tree also contains the uncommitted overlay QA harness described in
[`OVERLAY_QA.md`](./OVERLAY_QA.md). It is intentionally not listed as a commit
or as runtime-accepted evidence.

This is an implementation checkpoint, not visual or release acceptance.

## Runtime surfaces

The PWA remains the durable workspace. The Manifest V3 companion injects the
full Instagram overlay and owns these in-page surfaces:

| Surface | In-page responsibility | Durable authority |
| --- | --- | --- |
| Now | Route, session, exact profile relationship, queue match, next safe step | None |
| Capture | Merge only rendered follower/following rows into a local draft | PWA after explicit import |
| Queue | Navigate one local item, complete/skip local state, show signed summaries | PWA reviewed job and ledgers |
| Messages | Capture visible read-only fragments; show an exact signed DM gate only when available | PWA reviewed DM job and ledgers |
| Workspace | Show sanitized pairing facts and link to the exact paired origin | PWA |

The Tampermonkey userscript remains the preserved read-only fallback for visible
list capture and manual queue navigation. It does not receive the signed
extension bridge, exact one-item arms, or the complete modular overlay. Operators
who need all five in-page tools must use the browser extension.

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

The stored record moves from `instaAioOverlayPreferencesV1` to
`instaAioOverlayPreferencesV2`.

| Field | Fresh V2 default | V1 migration |
| --- | --- | --- |
| `open` | `false` | Preserve a valid V1 boolean |
| `section` | `now` | Preserve a valid V1 section |
| `dock` | `right` | Add default |
| `width` | `standard` | Add default |
| `theme` | `auto` | Add default |
| `density` | `comfortable` | Add default |
| `firstRunComplete` | `false` | Set `true` for a migrated V1 operator |

Invalid fields are repaired independently. Storage failures keep the in-memory
safe defaults and surface an error instead of pretending a preference was
saved. Capture and queue contracts remain V1 and import-compatible.

## Interaction and visual behavior

- Fresh installs start as a 44-pixel launcher; the panel does not take over the
  Instagram page on first load.
- Standard width is 380 pixels, with 336- and 480-pixel presets and left/right
  docking.
- The five tools remain visible in a 48-pixel semantic rail; Arrow keys plus
  Home and End move between tabs.
- Auto theme follows rendered Instagram light/dark state without reloading.
- At 600 pixels or narrower the panel becomes a bounded bottom sheet.
- Short-height, reduced-motion, forced-color, focus-restoration, and closed
  shadow-root rules are part of the production shell.
- Route changes use Navigation API, `popstate`, and debounced URL comparison;
  there is no recurring location poll.

## Execution boundary

The overlay contains no Instagram activator, `.click()` call, synthetic event,
or auto-execution route. It can request or cancel one exact 90-second arm through
the existing signed bridge. Execution remains in the background/content driver
after independent PWA and extension reservations.

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

The QA sources cover 38 unique scenarios, state-specific assertions on all 20
required states, selector contracts, child-process watchdog escalation, and
rejection of a deliberately wrong semantic state. On Windows, all scenarios
rendered through the production content-script graph and passed semantics,
geometry, collision, accessibility-tree, and screenshot checks. The full image
set was inspected in an agent visual review and reproduced by the non-updating
baseline check.

The 2026-08-03 guarded matrix also passed frozen installation, assembly, all 153
repository tests, production extension fixture acceptance, real Chrome pairing,
nine PWA screenshot baselines, the 38-state overlay update/check, the ZIP
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
