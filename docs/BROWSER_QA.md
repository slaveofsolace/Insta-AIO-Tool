# Browser QA

Last reviewed: 2026-08-02

## Scope and safety boundary

The production PWA source was served from the repository over the bounded
loopback development server. The desktop walkthrough used Google Chrome Profile
2. Deterministic responsive checks used the project's pinned Electron 43.2.0
Chromium in an isolated, non-persistent session because the Chrome controller
did not expose viewport resizing and the desktop controller rejected its window
binding. Only empty or synthetic local workspace data was used.

No Instagram action was armed or executed, no message menu was opened, and no
network-backed account mutation was attempted. The responsive harness navigates
only local PWA controls, denies browser permissions, and asserts that both live
settings remain unchecked.

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
| Responsive PWA layouts | Pass on Windows Chromium | Every primary view passed at 1134x700, 820x900, and 390x844 CSS pixels with no document/body horizontal overflow and visible bounded navigation/main regions. |
| Screenshot regression | Pass on Windows Chromium | Overview, Messages, and Settings were captured at all three sizes. A second run reproduced all nine SHA-256 hashes exactly. |
| Fresh service-worker origin | Pass | The final source was reassembled and loaded from a fresh loopback origin using cache generation `insta-aio-v10`. |
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
5. The PWA meta CSP included `frame-ancestors`, which Chromium ignores when it
   is delivered in a meta element and reports as a console error. The ineffective
   meta directive was removed; the loopback server now sends
   `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.
6. Initial hidden-window screenshots could retain an earlier rendered view. The
   harness now uses offscreen rendering and settles animation/compositor frames
   after every navigation before capture.

Focused regressions live in `tests/app-shell-safety.test.js`,
`tests/static-asset-policy.test.js`, and `tests/browser-qa-harness.test.js`. The
complete repository suite passes 103 of 103 tests.

## Representative screenshots

All screenshots contain empty or synthetic local data. The original interactive
desktop evidence remains available:

- [Overview](./evidence/browser-qa-2026-08-02/pwa-overview.png)
- [Action Queue](./evidence/browser-qa-2026-08-02/pwa-action-queue.png)
- [Messages](./evidence/browser-qa-2026-08-02/pwa-messages.png)
- [Activity](./evidence/browser-qa-2026-08-02/pwa-activity.png)

The deterministic Windows Chromium baseline is tracked under
[`tests/baselines/pwa/win32`](../tests/baselines/pwa/win32/manifest.json):

- [Desktop Overview](../tests/baselines/pwa/win32/desktop-overview.png)
- [Tablet Messages](../tests/baselines/pwa/win32/tablet-messages.png)
- [Mobile Settings](../tests/baselines/pwa/win32/mobile-settings.png)

Run `pnpm run qa:browser:check` to reproduce and hash-check all nine captures.
Run `pnpm run qa:browser:update` only when intentionally reviewing and accepting
a visual change. Baselines are platform-specific; macOS and Linux are not
claimed by the Windows manifest.

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
- Establish and visually accept native baselines on any additional release
  platform where screenshot hashes will be gated.
- Build, sign as appropriate, install, launch, and remove the macOS package on
  macOS.

These remaining checks prevent a claim of complete human browser or
cross-platform release acceptance.
