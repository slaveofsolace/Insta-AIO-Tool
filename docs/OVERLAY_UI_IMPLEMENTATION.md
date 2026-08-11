# Overlay UI implementation

## Current behavior

The overlay uses the modular production graph while preserving the PWA,
migrations, exchange contracts, and signed one-item bridge. It provides:

- draggable header and one lower-right resize handle on desktop;
- fitted mobile/bottom-sheet geometry with no horizontal overflow;
- persisted 55–100% surface opacity with an 88% default;
- an explicit three-tool landing surface;
- a first-open walkthrough that distinguishes read-only checks from locked live
  actions;
- the same three-tool engine in the generated Tampermonkey script; and
- guided Following/Followers comparison and review-before-start account runs;
- local category and username filtering for captured follower comparisons;
- a simplified, primary thread-Unsend card whose history loader does not keep
  repositioning an already settled conversation; and
- default-locked local batches plus an expiry-enforcing thread Unsend runner.

Automated tests use synthetic Instagram fixtures. Authenticated selector checks,
live account changes, and human screen-reader review require separate operator
acceptance.

## Runtime surfaces

The PWA remains the durable workspace. The Manifest V3 companion injects the
full Instagram overlay and owns these in-page surfaces:

| Surface | In-page responsibility | Durable authority |
| --- | --- | --- |
| Now | Route, session, exact profile relationship, queue match, next safe step | None |
| Capture | Guide separate Following and Followers full scans, compare only when both are present, and retain manual capture under secondary controls | PWA after explicit import |
| Queue | Keep one primary profile-navigation action, freeze exact targets in Review run, reveal Start only for a matching review, and show signed summaries | PWA reviewed jobs/ledgers for signed runs; extension-local state for toolbox batches |
| Messages | Keep thread Unsend primary, capture visible fragments secondarily, and show the exact signed DM gate when available | PWA reviewed job/ledgers for signed one-message work; tab-scoped authorization for thread runs |
| Workspace | Show sanitized pairing facts and link to the exact paired origin | PWA |

The generated Tampermonkey script embeds the same exact-label and Instagram
engine sources behind a userscript-specific three-tab shell. It supports guided
full-list scanning/comparison, review-before-start paced Follow/Unfollow, and thread DM
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
- The first opened panel introduces all three tools once; migrated preferences
  skip it, and completion is stored only in the V3 preference record.
- Completed follower comparisons expose category and text filters with a
  100-row DOM cap; filtering reads only normalized local capture data.
- Standard width is 380 pixels, with 336- and 480-pixel presets, left/right
  docking, bounded custom size, persisted desktop position, and reset control.
- The five tools remain visible in a 48-pixel semantic rail; Arrow keys plus
  Home and End move between tabs.
- Auto theme follows rendered Instagram light/dark state without reloading.
- At 600 pixels or narrower the panel becomes a bounded bottom sheet.
- Surface opacity is adjustable from 55% to 100%; backdrop blur and stronger
  inner surfaces preserve legibility while Instagram remains visible below.
- One lower-right resize handle avoids duplicate grip controls while preserving
  bounded pointer and keyboard resizing.
- Short-height, reduced-motion, forced-color, focus-restoration, and closed
  shadow-root rules are part of the production shell.
- Route changes use Navigation API, `popstate`, and debounced URL comparison;
  there is no recurring location poll.
- The PWA service worker is registered with `updateViaCache: 'none'`, checks for
  an update on startup, and uses network-first handling for successful
  same-origin GET responses. A stale cache cannot indefinitely pin old
  safety-sensitive application code when the current origin is reachable.

## Execution boundary

Overlay views do not own Instagram selectors or synthetic event sequences. They
can request or cancel one exact 90-second signed arm, request an exact phrase for
a local account batch, or create a separate `UNSEND ALL DMS` tab arm. Execution
remains in the audited background/content drivers. The thread runner itself
requires a future authorization expiry and rechecks it before every message;
the first unlock never opens a menu or removes anything.

Local account execution requires a review signature over the selected source,
action, limit, and exact target list. Editing any of those inputs discards the
draft and hides Start; live authority is checked only after review succeeds.

While an arm is active, or for a bounded ten-second transition after the bridge
consumes one, the full panel is suspended. A measured status strip is placed on
a non-intersecting edge when possible. Relevant native dialogs or menus keep the
overlay in this collision-safe state. If no safe rectangle exists, overlay
controls stay hidden; Instagram is never moved or restyled.

Pending intents and arms are sanitized again in the overlay and discarded when
expired. Dynamic Instagram, queue, message, pairing, and run text is written
with `textContent`. One audited static shell assignment is the only overlay
`innerHTML` use. Object URLs are revoked on replacement and teardown.

## Verification

The repository checks every production overlay module, the extension package,
preference migration, and runtime module graph. The overlay matrix contains 40
scenarios with state-specific assertions, selector contracts, a child-process
watchdog, geometry checks, accessibility-tree checks, and screenshot comparison.
The benchmark also verifies that a 2,000-item queue renders only the current
item instead of expanding the overlay DOM without a limit.

The complete command set and platform boundary are recorded in
[`OVERLAY_QA.md`](./OVERLAY_QA.md).

## Manual checks

- Authenticated Instagram routes and selectors.
- Any explicitly authorized live Follow, Unfollow, or Unsend action.
- Human visual and screen-reader review.
- Screenshot baselines for platforms other than the tracked Windows set.
