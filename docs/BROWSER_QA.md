# Browser QA

Last reviewed: 2026-08-02

## Scope and safety boundary

The production PWA was served from the repository over the loopback development
server and exercised in Google Chrome Profile 2. Only empty or synthetic local
workspace data was used. No Instagram action was armed or executed, no message
menu was opened, and no network-backed account mutation was attempted.

The authenticated extension workflow is not included in this result. The
available Chrome profile was signed out of Instagram and did not have the
unpacked extension installed.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| Primary PWA views | Pass | Overview, Relationships, Action Queue, Messages, Import / Export, Settings, and Activity rendered and were inspected in the actual application. |
| Keyboard navigation | Pass | Tab and Shift+Tab traversed real controls; Enter activated Activity; rendered-view navigation focused the new page heading. |
| Rerender focus | Pass | Relationship tab changes restored focus to the selected tab, and primary navigation restored focus to the rendered `h1`. |
| Automated accessibility tree | Pass | The inspected view exposed one `main`, one primary `nav`, one `h1`, named controls, and the expected status and empty-state text. This is not a human screen-reader result. |
| Desktop viewport | Pass | Chrome content viewport measured 1134 by 569 CSS pixels. |
| Fresh service-worker origin | Pass | The final source was reassembled and loaded from a fresh loopback origin using cache generation `insta-aio-v9`. |
| No-click safety | Pass | The walkthrough used local PWA state only; live settings stayed disabled and no extension action path was available. |

## Defects found and closed

1. A closing `section` tag was split across source fragments, so the assembler
   inserted a newline and the Overview rendered literal markup. The closing tag
   now lives in one fragment and has regression coverage.
2. An empty message collection claimed it was rendering rows `1-0 of 0`. The
   Messages view now displays `No messages to render.`
3. Whole-view rerenders discarded keyboard focus. Primary navigation now moves
   focus to the rendered page heading, and relationship tabs restore focus to
   the selected tab.
4. The service-worker cache generation was advanced so an existing installation
   does not retain the defective shell.

Focused regressions live in `tests/app-shell-safety.test.js`. The complete
repository suite passes 99 of 99 tests.

## Representative screenshots

All screenshots contain empty or synthetic local data.

- [Overview](./evidence/browser-qa-2026-08-02/pwa-overview.png)
- [Action Queue](./evidence/browser-qa-2026-08-02/pwa-action-queue.png)
- [Messages](./evidence/browser-qa-2026-08-02/pwa-messages.png)
- [Activity](./evidence/browser-qa-2026-08-02/pwa-activity.png)

These are review artifacts, not automated screenshot-regression baselines.

## Design judgment

The PWA retains its existing industrial workspace direction: dense information
hierarchy, rigid panels, a dark neutral base, one acid-lime action signal, and
functional status colors. The review did not justify a new scaffold or visual
theme. Changes were limited to rendering correctness, truthful state copy,
focus behavior, and cache delivery.

## Remaining target-environment acceptance

- Install the PWA in the intended Chrome profile.
- Load and pair the unpacked extension with action permission still disabled.
- Repeat the walkthrough while authenticated on Instagram and verify the
  real sidecar/selector surface without arming an action.
- Perform a human screen-reader walkthrough.
- Exercise the production PWA at tablet and mobile viewport widths; the browser
  client used for this pass exposed a fixed desktop viewport. The Instagram
  sidecar already has separate desktop/mobile fixture evidence.
- Establish deterministic screenshot-regression baselines if required for
  release gating.
- Build, sign as appropriate, install, launch, and remove the macOS package on
  macOS.

These remaining checks prevent a claim of complete human browser or
cross-platform release acceptance.
