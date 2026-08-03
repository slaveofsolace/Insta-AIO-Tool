# Overlay QA

Last updated: 2026-08-03

## Current status

The production-script overlay matrix is green on Windows. An explicit update
generated 38 baselines, every image was inspected in an agent visual review,
and a subsequent non-updating check reproduced all semantic, geometry,
collision, accessibility-tree, performance, and screenshot expectations. The
ordinary CI workflow now runs `qa:overlay:check` on `windows-latest`; CI never
updates baselines.

The reviewed evidence lives under
`docs/evidence/overlay-ui-2026-08-02/after/win32`. Its manifest SHA-256 at the
2026-08-03 checkpoint is
`42bdfd4daaad56aab0601078e3e795a12fc2218153f81c61dd7ae4a32cca0f81`.
This establishes synthetic-fixture and Windows-rendering evidence only. It does
not establish human visual or screen-reader acceptance, cross-platform pixel
parity, persistent-profile acceptance, or authenticated Instagram selector
compatibility.

## Safety boundary

The harness serves a synthetic Instagram shell over loopback and loads the
actual ordered content-script graph from the built extension manifest. It does
not use an authenticated Instagram session, export browser state, or contact a
live account.

Harness interactions are limited to overlay controls in the synthetic fixture:

- capture the currently rendered fixture rows;
- inspect visible fixture-message evidence;
- open or collapse the overlay launcher for performance measurement.

It does not arm an intent, invoke the content script's one-use page-control
activator, open a destructive Instagram menu, or execute Follow, Unfollow, or
Unsend. The fixture contains controlled-action states only so the overlay can
prove that `locked`, `ready`, `armed`, `expired`, and safe-stop presentations
are accurate.

## Commands

```bash
# Rebuild the production extension and intentionally replace reviewed baselines.
pnpm run qa:overlay:update

# Rebuild the production extension and compare against reviewed baselines.
pnpm run qa:overlay:check
```

The update command is a deliberate review operation. It must never run as an
automatic step in ordinary CI. The check command never changes the reviewed
baseline.

Both commands invoke `scripts/run-overlay-qa.mjs`. The runner uses a unique
disposable Electron user-data directory under `test-results/overlay-qa`, hides
the spawned window, and removes the directory afterward. A fixed five-minute
watchdog requests process termination, waits two seconds, escalates to forced
termination, waits another two seconds, and then fails. It never uses a broad
process-name kill.

## Harness architecture

| File | Responsibility |
| --- | --- |
| `scripts/overlay-qa-scenarios.mjs` | Immutable viewport and state matrix plus state-specific semantic expectations. |
| `scripts/run-overlay-qa.mjs` | Bounded Electron child lifecycle and disposable-profile cleanup. |
| `scripts/overlay-qa.mjs` | Loopback server, production-script loading, state settlement, semantic/geometry/accessibility checks, screenshots, performance measurements, and baseline comparison. |
| `tests/fixtures/overlay-preview.html` | Deterministic synthetic Instagram routes, dialogs, lists, messages, pairing modes, intents, and arms. |

The harness reads `dist/extension/manifest.json` after `build:extension` and
loads its Instagram content scripts in manifest order. A separate mock overlay
component is not used.

## Required state coverage

The 20 required states carry 63 state-specific semantic expectations that run
before any screenshot can be accepted:

| Area | Scenarios |
| --- | --- |
| Profile | `profile-not-following-no-match`, `profile-following-queue-match`, `profile-ambiguous-safe-stop` |
| Capture | `followers-first-capture`, `following-repeated-capture` |
| Queue | `queue-locked`, `queue-exact-target-ready`, `queue-armed-countdown`, `queue-arm-expired` |
| Messages | `messages-evidence-only`, `messages-exact-target-ready`, `messages-wrong-conversation`, `messages-armed-countdown` |
| Workspace | `workspace-unpaired`, `workspace-read-only`, `workspace-action-permission` |
| Collision | `native-dialog-coexistence` |
| Session safe stops | `session-expired`, `session-challenge`, `session-rate-limited` |

The semantic layer checks the exact selected view title and, by scenario:

- target and relationship copy;
- queue match or mismatch;
- capture type, total, additions, and duplicate count;
- live-gate title, badge, tone, control-disabled state, and immutable expiry;
- message identity readiness, wrong-conversation lockout, and countdown state;
- paired origin permission level and unpaired link state;
- session/challenge/rate-limit safe-stop copy;
- collision target and whether the strip reports an armed state or a visible
  native Instagram action surface.

A screenshot with the wrong state is therefore a failure even if its geometry
and hash happen to match a previously captured image.

## Viewport and presentation matrix

The full matrix contains 38 unique scenarios: the 20 required states above plus
18 presentation variants.

| Coverage | Scenario IDs |
| --- | --- |
| Dark desktop | `profile-dark-desktop`, `queue-dark-desktop` |
| Short laptop | `profile-short-laptop`, `queue-short-laptop-dark` |
| Narrow tablet | `profile-narrow-tablet`, `messages-narrow-tablet-dark` |
| Mobile portrait | `profile-mobile-portrait`, `queue-mobile-portrait-dark` |
| Mobile landscape | `profile-mobile-landscape`, `queue-mobile-landscape-dark` |
| 200% zoom | `profile-zoom-200-light`, `profile-zoom-200-dark`, `queue-zoom-200-light`, `queue-zoom-200-dark` |
| Forced colors | `profile-forced-colors`, `queue-forced-colors` |
| Collapsed launcher | `collapsed-desktop`, `collapsed-mobile` |

The configured CSS viewports are 1440×900, 1280×720, 820×900, 390×844,
and 844×390. The harness also checks panel, scroller, selected-view, document,
and body overflow; target intersection; 44-pixel launcher geometry; visible
touch-target sizing; collision placement; and a bounded accessibility-tree
smoke check.

## Performance checks

After screenshot scenarios, the harness measures:

- collapsed idle task time;
- open idle task time;
- one SPA route transition;
- a 2,000-item queue update;
- total overlay DOM nodes after the large queue update.

The current thresholds are under 100 ms for each sampled idle task window,
under 500 ms for the route transition, under 1,000 ms for the 2,000-item queue
update, exactly one rendered current item, and fewer than 400 overlay nodes. The
2026-08-03 Windows update measured 4.694 ms collapsed idle task time, 5.743 ms
open idle task time, a 97.8 ms route transition, and a 25.9 ms 2,000-item queue
update that rendered one current item with 234 overlay nodes.

## Evidence layout

Unreviewed run output is ignored and belongs under:

```text
test-results/overlay-qa/
├── actual/<platform>/*.png
├── actual/<platform>/manifest.json
└── runner.log
```

An explicit update copies candidate evidence to:

```text
docs/evidence/overlay-ui-2026-08-02/after/<platform>/
├── <scenario>.png
├── manifest.json
└── fidelity-ledger.json
```

The manifest records the platform, built extension version, scenario data,
geometry metrics, and SHA-256 for every capture. Hashes are platform-specific;
a Windows manifest is not evidence for Linux or macOS.

## Baseline review procedure

1. Restore a working local command host and run the complete pre-update matrix.
2. Run `pnpm run qa:overlay:update` only when the changed pixels are intentional.
3. Inspect every generated image, not only its hash. Reject clipping,
   obstruction, unreadable copy, wrong state, theme mismatch, unsafe collision
   placement, or a screenshot that does not show the named scenario.
4. Review `fidelity-ledger.json` against the before evidence and the selected
   quiet-operator specification.
5. Record the reviewer and platform in the delivery handoff.
6. Run `pnpm run qa:overlay:check` without changing the baseline and require an
   exact pass.
7. Only after the reviewed platform baseline is committed, add the corresponding
   non-updating CI check. Do not generate or accept baselines in ordinary CI.

The Windows procedure was completed on 2026-08-03. The agent inspected all four
contact sheets and representative full-resolution desktop, messages, mobile,
200% zoom, forced-colors, native-dialog, armed, and safe-stop captures. No
clipping, target obstruction, unreadable state, incorrect theme, or unsafe
collision placement was found. This is recorded as agent visual review, not
independent human acceptance.

## Required runtime matrix before acceptance

At minimum, the final checkpoint must record fresh results for:

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

The overlay check does not replace the extension controlled-action acceptance,
the disposable Chrome pairing test, the PWA screenshot suite, or the repository
test suite.

## Remaining acceptance and nonclaims

Completed at this checkpoint:

- generated and agent-reviewed all 38 Windows baselines;
- reproduced them with the non-updating check and added the Windows CI gate;
- ran the complete command matrix above with 153 repository tests passing; and
- reviewed the diff and permission boundary: production extension permissions
  did not expand, target-aware adaptation creates no action token, the Chrome
  debugging pipe is confined to disposable QA, and the overlay harness denies
  permissions and external navigation on a loopback-only fixture.

Remaining:

- Perform a human screen-reader walkthrough before making a human accessibility
  claim.
- Install and inspect the sidecar in the operator's intended persistent Chrome
  profile without arming an intent.
- Repeat read-only selector acceptance against the intended authenticated
  Instagram account before any operator-selected live action.

Authenticated Follow, Unfollow, or Unsend acceptance remains `Codex-Handoff`.
No real Instagram mutation belongs to this overlay UI pass.
