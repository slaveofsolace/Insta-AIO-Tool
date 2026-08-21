# Browser QA

Last reviewed: 2026-08-20

## Scope and safety boundary

The production PWA source was served from the repository over the bounded
loopback development server. Deterministic responsive and production-script
checks use isolated, non-persistent Chromium sessions. A separate authenticated
Instagram session was inspected read-only against the public `@instagram`
profile. Only empty or synthetic local workspace data was used by local app and
extension automation.

No Instagram action was armed or executed, no message menu was opened, and no
network-backed account mutation was attempted. The responsive harness navigates
only local PWA controls, denies browser permissions, and asserts that both live
settings remain unchecked.

The authenticated Instagram diagnostic found one verified profile header and
exactly one owned `Follow` relationship control. It did not inject the extension,
arm an intent, or click the control. The real extension pairing gate instead
uses a disposable Chrome-for-Testing profile and the local PWA; it does not reuse
the authenticated Instagram session.

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
| Production account DOM chains | Pass in isolated Chromium | The actual content script resolved and executed bounded local Follow (one control) and Unfollow (relationship plus newly bound confirmation), then rejected token replay without another activation. |
| Production one-message DOM chain | Pass in isolated Chromium | The actual content script used one exact row action, one bound Unsend menu item, and one bound confirmation, proved retained row/identity disconnection plus exact absence, then rejected replay. |
| Sidecar accessibility | Pass in Chromium automation | Collapse/reopen focus restoration and named controls were verified in the full accessibility tree. This remains distinct from a human screen-reader result. |
| PWA installability and pairing defaults | Pass in isolated Chromium | Manifest, icon set, active service worker, and a read-only pairing-code flow were verified while both live settings and action permission remained off. |
| Authenticated Instagram profile selector | Pass, read-only | Current Instagram rendered one verified `@instagram` profile header with one owned `Follow` control. No action or extension injection occurred. |

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
7. An authenticated read-only userscript check found that the follower checker
   could accept profile-level suggestion rows when no Followers or Following
   dialog was open, then incorrectly label the capture complete. Current source
   requires the exact requested list dialog, quarantines earlier captures, and
   replaces quarantined rows on the first verified rescan instead of promoting
   them into a trusted comparison or action source.
8. A later authenticated Following scan reached the rendered list boundary with
   one fewer unique row than Instagram's exact profile total. Current source
   records the observable total before and after the scan and keeps the capture
   incomplete when the total changes or does not match the readable rows.
9. Reloading the corrected source exposed that the earlier false-complete result
   could remain trusted in local schema-3 state until the operator rescanned.
   Schema 4 preserves those rows for local export but quarantines their verified
   and complete flags, so they cannot drive comparisons or reviewed run sources.

Focused regressions live in `tests/app-shell-safety.test.js`,
`tests/static-asset-policy.test.js`, and `tests/browser-qa-harness.test.js`. The
complete repository suite passes 232 of 232 tests.

## Representative screenshots

All screenshots contain empty or synthetic local data. The original interactive
desktop evidence remains available:

- [Overview](./evidence/browser-qa-2026-08-02/pwa-overview.jpg)
- [Action Queue](./evidence/browser-qa-2026-08-02/pwa-action-queue.jpg)
- [Messages](./evidence/browser-qa-2026-08-02/pwa-messages.jpg)
- [Activity](./evidence/browser-qa-2026-08-02/pwa-activity.jpg)

The deterministic Windows Chromium baseline is tracked under
[`tests/baselines/pwa/win32`](../tests/baselines/pwa/win32/manifest.json):

- [Desktop Overview](../tests/baselines/pwa/win32/desktop-overview.png)
- [Tablet Messages](../tests/baselines/pwa/win32/tablet-messages.png)
- [Mobile Settings](../tests/baselines/pwa/win32/mobile-settings.png)

Run `pnpm run qa:extension` for production-script DOM and accessibility checks,
`pnpm run qa:chrome` with Chrome for Testing for real unpacked-extension pairing,
and `pnpm run qa:browser:check` to reproduce and hash-check all nine captures.
Run `pnpm run qa:browser:update` only when intentionally reviewing and accepting
a visual change. Baselines are platform-specific; macOS and Linux are not
claimed by the Windows manifest.

Branded Chrome removed command-line `--load-extension` support beginning with
Chrome 137. The acceptance harness therefore loads the unpacked package through
the DevTools `Extensions.loadUnpacked` command over `--remote-debugging-pipe`
with `--enable-unsafe-extension-debugging`. Those switches are confined to the
disposable QA child/profile; the harness exposes no TCP debugging port and does
not alter production extension permissions.

## Overlay-specific QA

The Instagram overlay has a separate 42-scenario harness that
loads the production-built content-script graph and checks state semantics,
geometry, target intersection, responsive presentations, accessibility-tree
names, and bounded performance before comparing screenshots. Its commands are
`pnpm run qa:overlay:update` and `pnpm run qa:overlay:check`.

All 42 Windows scenarios passed their semantic, geometry, collision,
accessibility-tree, and performance checks. The translucent, layout, and
live-lock states were inspected at full resolution; the reviewed baseline reproduced through
`qa:overlay:check`, and the non-updating Windows check is wired into CI. That is
runtime evidence for the synthetic fixture—not human screen-reader acceptance,
cross-platform visual proof, persistent-profile acceptance, or authenticated
Instagram selector acceptance. See [Overlay QA](./OVERLAY_QA.md) for the
matrix, evidence layout, measured results, and manual acceptance limits.

## Design judgment

The PWA now leads with a task-oriented three-tool overview instead of a uniform
metric-card wall. A warm neutral workspace, dark navigation rail, restrained
rose action signal, and compact status strip align it with the in-page tools
while preserving every existing page and local data function. The review also
covered rendering correctness, truthful state copy, focus behavior, and cache
delivery.

## Remaining target-environment acceptance

- Install the PWA and pair the unpacked extension in the operator's intended
  persistent Chrome profile; CI pairing uses a disposable profile.
- Repeat the authenticated Instagram walkthrough with the real sidecar loaded,
  without arming an action.
- Perform a human screen-reader walkthrough.
- Establish and visually accept native baselines on any additional release
  platform where screenshot hashes will be gated.
- Apply Apple Developer ID signing/notarization for a distributable macOS
  release; CI uses an ad-hoc signature only for lifecycle acceptance.

These remaining checks prevent a claim of complete human browser or
cross-platform release acceptance.
