# Overlay UI specification

- Specification date: 2026-08-02
- Input build: `ff8b4b8c9587114273e45d28e8bac14ec1d3f643`
- Selected direction: **Quiet professional operator panel**

This specification implements the acceptance contract in
`docs/CODEX_OVERLAY_UI_PERFECTION_PROMPT.md`. It does not reopen the PWA,
pairing, exact-intent, reservation, one-item, or page-driver architecture.

## Concept decision

Both required concepts were rendered through the same deterministic Instagram
fixture in light and dark:

- Compact Instagram-native utility: 356 × 588 px, 16.15% viewport area
- Quiet professional operator panel: 380 × 680 px, 19.94% viewport area

Neither concept intersected the fixture's native profile relationship control.
The measurements and SHA-256 receipts are in
`docs/evidence/overlay-ui-2026-08-02/concepts/concept-metrics.json`.

| Criterion | Weight | Instagram-native | Operator panel |
|---|---:|---:|---:|
| Occlusion and footprint | 20 | 5.0 | 4.0 |
| Target and next-action clarity | 18 | 4.0 | 5.0 |
| Cognitive load | 14 | 4.5 | 4.5 |
| Accessibility potential | 16 | 3.5 | 5.0 |
| Light and dark fit | 10 | 5.0 | 5.0 |
| Implementation risk | 8 | 4.5 | 3.5 |
| Safety-state visibility | 14 | 4.0 | 5.0 |
| **Weighted score** | **100** | **86.6** | **92.2** |

The operator direction wins because it keeps every tool family reachable,
separates extension ownership from Instagram, gives the exact target and safety
state the strongest hierarchy, and naturally reduces to an icon/status strip.
Its default Now state remains content-bounded; it must not become a permanent
full-height rail.

The rejected Instagram-native concept remains useful evidence. Its compact
footprint informs mobile and collision states, but its five compressed text tabs
and `More` bucket weaken navigation and could make the extension look like a
native Instagram control.

## Design direction

- Profile: app-component/dashboard.
- Aesthetic: restrained Swiss grid with quiet utilitarian instrumentation.
- Signature detail: a small lime **signal pin**—a 6–8 px state dot and a 3 px
selected-edge mark—used only when state warrants attention.

Defining moves:

- System UI typography with real weight and spacing hierarchy; no remote fonts.
- Neutral adaptive surfaces; no black branding slab or cream dashboard shell.
- A 48 px tool rail with consistent inline SVG icons and accessible labels.
- Exact target, state, and next safe action above protocol explanation.
- Motion limited to one short open/close transition and collision-mode change.
- Safety detail, imports, downloads, and history behind disclosures when they are
  not the current task.

## Tokens

### Light

| Role | Value |
|---|---|
| Shell | `#f7f8f5` |
| Raised surface | `#ffffff` |
| Tool rail | `#eef0eb` |
| Primary ink | `#1d211b` |
| Secondary ink | `#687064` |
| Boundary | `#d8ddd4` |
| Signal pin | `#b9ef35` |
| Focus | `#168cff` |

### Dark

| Role | Value |
|---|---|
| Shell | `#151714` |
| Raised surface | `#1c1f1b` |
| Tool rail | `#10120f` |
| Primary ink | `#f3f5ef` |
| Secondary ink | `#a9afa3` |
| Boundary | `#343a31` |
| Signal pin | `#b9ef35` |
| Focus | a high-contrast system-adjusted blue or forced-color highlight |

Warning, danger, success, and uncertain states require icon/label changes in
addition to color. Final tokens must pass WCAG AA at their actual text size.

## Typography and controls

- Body and control text: 14 px minimum.
- Secondary/supporting text: 12 px minimum.
- View title: 18 px, semibold.
- Target identity: 17–18 px, semibold, wrapping safely.
- Protocol/detail disclosures: 12–13 px with at least 1.45 line height.
- Tooltips are supplemental; every icon button has an accessible name.
- Primary touch targets: at least 44 × 44 CSS px.
- Radii: 8 px controls, 10 px cards, 12 px shell; pills only for compact state
  labels where the shape carries meaning.
- Borders establish grouping. Shadows indicate the one floating shell only.

## Shell

### Launcher

- First install defaults collapsed on every viewport.
- 44 × 44 px neutral button with the AIO mark and an accessible `Open Insta AIO`
  name.
- Safe-area inset plus 12–16 px viewport inset.
- Optional signal pin only for exact ready intent, armed countdown, attention,
  or safe stop; no ordinary pulse or continuous animation.
- Dock preference moves the launcher and panel together.

### Desktop panel

- Width presets: compact 336 px, standard 380 px, wide 480 px.
- Width is capped to the available viewport minus safe insets.
- Default Now height is content-bounded with a 680 px maximum at 1440 × 900.
- Dense views may grow only to `calc(100dvh - safe insets)` and then scroll their
  content region.
- No minimum height may exceed the available viewport.
- Header, tool rail, and critical footer remain fixed while the view scrolls.
- Left and right docking use the same DOM; only logical inset properties change.

### Tool rail

- 48 px wide with five 44 px tab controls: Now, Capture, Queue, Messages,
  Workspace.
- Correct `tablist`, `tab`, and `tabpanel` roles.
- Arrow keys move focus; Home and End select the first/last tab.
- Selected state uses weight, surface, and the signal edge—not color alone.
- Visible labels appear through accessible tooltips on pointer/focus delay; the
  accessible name never depends on a tooltip.

### Narrow/mobile

- At narrow effective widths, use a bottom sheet rather than a full-screen page.
- Width follows the viewport; maximum height is approximately 78 `dvh` in
  portrait and the available short dimension in landscape.
- Tool navigation becomes a five-item bottom bar or horizontally scroll-free
  compact rail with 44 px targets.
- Header and close control remain visible.
- Safe-area environment insets apply to every edge.
- At 200% zoom, CSS viewport breakpoints naturally select the narrow layout; no
  required action may need horizontal scrolling.

## Preferences V2

Storage key: `instaAioOverlayPreferencesV2`

```json
{
  "schemaVersion": 2,
  "open": false,
  "section": "now",
  "dock": "right",
  "width": "standard",
  "theme": "auto",
  "density": "comfortable",
  "firstRunComplete": false
}
```

Migration rules:

1. A valid V2 record is normalized field by field.
2. If only `instaAioOverlayPreferencesV1` exists, preserve its valid `open` and
   `section`, apply safe defaults for new fields, and mark the record as migrated.
3. A fresh install receives `open: false` regardless of desktop width.
4. Invalid values fall back independently; one bad field does not erase valid
   preferences.
5. Preferences contain no username, message content, pairing secret, token,
   origin history, or imported queue data.
6. Storage failures reject visibly and preserve the in-memory safe default.

## Theme behavior

- `light` and `dark` are explicit.
- `auto` follows Instagram's rendered surface, with system preference only as a
  fallback.
- Observe relevant `class`/`style` changes on `html` and `body` and the system
  color-scheme media query; do not poll.
- Theme changes update token attributes without rebuilding the view or losing
  focus.
- Forced colors removes decorative shadows, uses system colors, and preserves
  state with text and borders.

## Route-aware information architecture

### Now

Profile routes show exact username, identity confidence, relationship, queue
match/protection, session warning, and one next safe action. List dialogs show
detected list type and capture counts. DM routes show conversation identity,
evidence count, exact-target availability, and one review action. Unsupported
routes show a short neutral state, not an empty ledger.

### Capture

Preserve explicit, rendered-row-only capture and manual scrolling. Show detected
list, current batch, unique total, duplicates ignored, last capture, bounded
preview, maximum state, and storage failure. Render at most a small preview even
for 2,000 stored accounts.

### Queue

The current username/action/status is focal. Open, Complete, and Skip remain the
primary loop. Import/export and signed history are disclosures. The live gate is
one compact state row while locked and expands only for a relevant exact intent,
arming phrase, armed countdown, execution, completed result, or safe stop.

### Messages

Render a compact evidence thread. Sent, received, and unknown ownership labels
appear only when supported. Exact ID, ownership, time, and digest are a
disclosure. The controlled gate remains secondary until a matching intent exists.

### Workspace

Show paired state, exact origin, read/action permissions, extension version, last
bridge contact, and Open Workspace. Pair/revoke and privacy guidance use concise
disclosures; remove feature-marketing cards.

## State language

Primary state vocabulary is fixed:

- `locked`
- `waiting for target`
- `ready`
- `arming`
- `armed` with a countdown derived from immutable `expiresAt`
- `executing in PWA`
- `completed`
- `expired`
- `canceled`
- `safe stop`
- `uncertain`

Countdown updates do not extend the arm and do not announce every second.
`aria-live` announces only major state transitions. Every destructive state shows
the absolute username or exact message identity beside it. Arming copy always
states that arming alone does not perform the action.

## Collision and execution-safe mode

The overlay never moves or restyles Instagram. When a relevant native target
menu, confirmation dialog, or controlled execution surface appears:

1. record prior shell state;
2. reduce the panel to a compact status strip on the opposite safe edge;
3. show exact target and current state, plus Cancel only while cancellation is
   still semantically valid;
4. prove no rectangle intersection with the target control, message row, menu,
   or dialog;
5. restore only after the native surface closes and the page context revalidates.

If no safe strip placement exists, collapse to the launcher and announce the
safe stop. The overlay never synthesizes a click, hides a native control, or
claims cancellation rolled back an already-dispatched action.

## Architecture

Use ordered classic content-script modules under `extension/overlay/`; do not add
a framework or remote asset:

```text
extension/overlay/
├── shared.js
├── preferences.js
├── route-observer.js
├── theme.js
├── bridge.js
├── downloads.js
├── accessibility.js
├── icons.js
├── shell.js
├── collision.js
└── views/
    ├── now.js
    ├── capture.js
    ├── queue.js
    ├── messages.js
    └── workspace.js
extension/instagram-overlay.js   # lifecycle bootstrap only
```

Boundaries:

- normalization and preference migration are pure and directly tested;
- bridge calls never render;
- views never persist;
- downloads own every object URL and revoke them on replacement/teardown;
- shell owns static markup, tokens, and safe `textContent` insertion;
- route observer compares URLs through Navigation API, `popstate`, and one
  bounded/debounced DOM observer—never a recurring location timer;
- collision module only observes and measures; it never activates Instagram;
- bootstrap owns listeners and one idempotent teardown;
- the isolated-world namespace exposes no secret or destructive token to the
  page;
- build/package validation scans every ordered module for forbidden `.click()`,
  synthetic dispatch, polling, remote assets, and unsafe dynamic HTML.

## Performance budgets

- Collapsed idle: no recurring timer; zero context inspection without a pending
  exact intent; mutation callbacks only compare route/theme/surface signals.
- Open idle: no full rerender on unrelated Instagram mutations.
- Route transition: one debounced context refresh, target under 50 ms in fixture.
- Countdown: update one text node at most once per second and stop at expiry.
- 2,000-item queue: bounded normalization and no more than the current item plus
  a small history/preview window in the DOM.
- Teardown: remove listeners/observers/timers and revoke every object URL.

## Required verification

Direct runtime tests must cover V1→V2 migration, fresh collapsed default,
dock/width/theme/density persistence, semantic tab keyboard behavior, route
deduplication and teardown, theme changes, immutable expiry, collision mode,
storage failures, bridge reconnect, bounded 2,000-item rendering, and object URL
cleanup.

Visual QA must use the built production scripts across the committed scenario,
viewport, theme, 200% zoom, mobile-landscape, forced-color, and native-surface
matrix. Geometry assertions are separate from screenshot comparison. Baselines
are explicitly updated and platform-specific.

## Nonclaims and handoff

The concept score is an engineering selection, not human visual acceptance. The
final implementation still requires automated matrix evidence and a user review.
Authenticated persistent-profile fit, human screen-reader acceptance, and any
real Follow, Unfollow, or Unsend remain `Codex-Handoff` items.

Implementation is now tracked in [OVERLAY_UI_IMPLEMENTATION.md](./OVERLAY_UI_IMPLEMENTATION.md).
The source checkpoint satisfies the modular and static safety design, while the
required production runtime visual/geometry matrix and human acceptance remain
open.
