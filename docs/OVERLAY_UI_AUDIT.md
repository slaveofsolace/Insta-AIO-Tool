# Overlay UI audit

- Audit date: 2026-08-02
- Audited build: `ff8b4b8c9587114273e45d28e8bac14ec1d3f643`
- Surface: production `extension/instagram-overlay.js` rendered in the deterministic Instagram fixture at 1440 × 900
- Mode: gray-box cold-eye review followed by source inspection

This audit does not grant human visual acceptance. The first screenshot pass was
performed before this refinement batch changed overlay source, but the reviewer
had already encountered implementation details during recovery. Findings are
therefore labeled gray-box rather than represented as a blind human reaction.

## Verdict

`REVISE` — The overlay is functionally real and visually intentional, but it is
calibrated like a full operator dashboard rather than a subordinate Instagram
utility. Its shell, contrast, and explanation density compete with the exact
Instagram context the operator is meant to inspect.

The existing industrial visual language is not generic AI output. It has no
purple gradient, gradient headline, stock three-card grid, untouched component
library, or decorative glass. The problem is contextual fit: a successful PWA
language was reused at full intensity in an injected surface.

## Frozen evidence

The preserved production-script captures are:

- `docs/evidence/overlay-ui-2026-08-02/before/profile-open.png`
- `docs/evidence/overlay-ui-2026-08-02/before/profile-collapsed.png`
- `docs/evidence/overlay-ui-2026-08-02/before/queue-ready-open.png`
- `docs/evidence/overlay-ui-2026-08-02/before/messages-open.png`

The scored observation ledger is
`docs/evidence/overlay-ui-2026-08-02/human-eye-observations.json`. Its generated
priority table is
`docs/evidence/overlay-ui-2026-08-02/human-eye-priority.md`.

## Measured current shell

| Property | Current implementation | Consequence |
|---|---:|---|
| Desktop panel width | 462 px | 32.1% of a 1440 px fixture before accounting for shadow |
| Rail width | 104 px | 22.5% of the panel is persistent navigation/branding |
| Vertical bounds | top 68 px, bottom 14 px | 818 px, or 90.9% of a 900 px viewport |
| Minimum height | 520 px | Can exceed available short-height or zoomed space |
| Launcher | 62 × 62 px | Larger and louder than the required 40–44 px utility control |
| First desktop run | open at widths of 860 px or more | Instagram is covered before the operator asks for the tool |
| Theme | forced light | Does not follow Instagram dark mode |
| Mobile at 540 px or less | full viewport takeover | Loses the requested bottom-sheet relationship to Instagram |
| Route lifecycle | 1.5-second recurring poll | Persistent idle work and no explicit teardown |
| Layer | maximum integer z-index | Can compete with native menus and confirmation dialogs |

## Prioritized findings

### S — release gates

1. `MEASURED` — Responsive, theme, navigation, and lifecycle contracts are
   incomplete. The source forces light mode, uses a fixed minimum height,
   defaults desktop open, applies `aria-selected` without a complete tab
   contract, takes over mobile, polls location every 1.5 seconds, and exposes no
   unified teardown. This blocks the committed acceptance contract.

2. `MEASURED` — The open shell displaces Instagram as the primary surface. The
   fixed panel covers the fixture's right side, including space adjacent to the
   reviewed relationship control and message content. A controlled execution
   needs a deterministic non-intersection mode, not only a high z-index.

### A — major workflow and presentation defects

1. `OBSERVED` — Queue safety detail competes with the current reviewed item.
   Import/export, queue controls, a large live gate, protocol prose, and run
   history share one scrolling column. The username and one next safe action do
   not dominate.

2. `OBSERVED` — Messages presents the destructive gate more strongly than the
   evidence. The locked gate remains a large default block even when no reviewed
   target exists, while the read-only evidence area is visually secondary.

3. `OBSERVED` — The full-height black rail and acid-lime accent win the first
   fixation in every open state. Ordinary read-only readiness looks urgent.

4. `OBSERVED` — The collapsed launcher is loud but ambiguous. Its clipped tile,
   offset shadow, and tiny `FIELD DESK` label read as a badge before they read as
   an expandable tool.

## Attention and task hierarchy

The current frame asks the eye to resolve these competing high-contrast regions:

1. black overlay rail;
2. acid brand and active rule;
3. cream panel and hard black boundaries;
4. native Instagram identity/control;
5. current queue item or message evidence.

For this product, the intended order is almost the reverse:

1. exact Instagram target or conversation;
2. verified/ambiguous state;
3. one safe next action;
4. concise lock or warning reason;
5. navigation, branding, protocol detail, and durable-history links.

## Workflow audit

### Now — `REVISE`

The ledger is accurate but generic. It shows the same five rows regardless of
route and asks the operator to read a dense state table before acting. The new
view should become route-aware and omit inapplicable rows.

### Capture — `KEEP / REVISE`

Manual scrolling, explicit capture, bounded storage, duplicate merging, and
download behavior are correct and must remain. The view needs detected-list
state, batch/unique/duplicate counts, a short preview, and storage-failure
feedback without rendering an unbounded list.

### Queue — `REVISE`

The familiar Open / Complete / Skip loop is the right migration. Make the
current username/action/state the focal object. Import/export, signed history,
and protocol detail should be disclosures. A ready or armed exact target may
expand the live gate; a generic locked gate should remain compact.

### Messages — `REVISE`

The existing split between visible evidence and exact reviewed identity is
correct. Present fragments as compact message rows with explicit evidence-only
language. Ownership, identity, timestamp, and digest belong in a disclosure.
The controlled gate should appear only when a matching intent makes it relevant.

### Workspace — `REVISE`

The current capability list reads like feature marketing. Replace it with
pairing origin, permissions, extension version, bridge contact status, and one
workspace action. Keep privacy/protocol detail in a disclosure.

## Accessibility and runtime audit

| Contract | Current status | Required outcome |
|---|---|---|
| First-run state | Fails | V2 defaults collapsed and migrates V1 open/view state |
| Navigation semantics | Fails | Real tablist/tab/tabpanel behavior with arrows, Home, and End |
| Focus restoration | Partial pass | Preserve close/dialog behavior and add deterministic route/collision handling |
| Theme | Fails | Auto/light/dark; auto reacts without reload |
| Reduced motion | Partial pass | Preserve and extend to every new transition |
| Forced colors | Missing | State remains readable without background/color assumptions |
| 200% zoom | Unknown | Required controls remain reachable with no horizontal overflow |
| Short height | Fails contract | No minimum height; sticky header/action area inside available `100dvh` |
| Mobile | Fails direction | Bottom sheet or compact drawer, not unconditional full-screen takeover |
| Route observation | Fails | Navigation API, popstate, bounded debounced observer, and teardown |
| Collision mode | Missing | Main panel cannot intersect target control, row, menu, or dialog |
| Object URL lifecycle | Partial | Replacement works; teardown must revoke every retained URL |
| Storage failure | Missing | Surface a safe next step when extension storage fails |

## AI-tell catalog pass

Profile: `app-component` / `dashboard`; surgical rigor, not decorative novelty.

### P0

None. The current UI is distinctive and deliberately industrial.

### P1

- `K4` contextual instance: colored left rules recur in safety blocks and active
  navigation. They flatten state into the same accent treatment. Replace them
  with compact icon/text state rows and reserve accent for state meaning.
- `K7` code-certain: theme, forced-color, mobile, short-height, storage-failure,
  and collision states are incomplete.
- `K9` judgment call: the black rail resembles a dark-tool default only when
  transplanted into Instagram. The PWA context may keep it; the injected shell
  should not.

### P2

- `T5` code-certain: repeated uppercase overlines add protocol texture to nearly
  every block. Keep one compact context label and remove the rest.
- `S1` render-observed: equal border weight, rules, and stacked spacing make
  current item, gate, explanation, and history feel equally important.

## Design constraints carried into concepts

- No destructive page-control path enters overlay code.
- First run is collapsed.
- Standard width targets 380 px; compact and wide presets remain available.
- One restrained lime state signal remains, never as a dominant surface.
- Instagram-adaptive neutral surfaces work in light and dark.
- The current target and next safe action lead every route-aware state.
- Protocol and history use progressive disclosure.
- A sticky header and compact status/action footer remain reachable.
- Mobile uses a bottom sheet; short-height and 200% zoom stay bounded.
- Collision/execution mode reduces the panel to a movable status strip.
- All preference, route, observer, URL, and listener lifecycle behavior has a
  deterministic teardown and direct runtime coverage.

## Human-acceptance boundary

Automated pixels, geometry, contrast checks, and accessibility trees can reject
regressions; they cannot accept subjective visual quality or a screen-reader
experience for the user. Authenticated selector fit and any real Instagram
mutation remain `Pending verification` items.
