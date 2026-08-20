# Instagram sidecar

## Product role

The **Insta AIO Field Desk** restores the original in-page operating model:
Instagram is the place where the operator sees the current account, list, or
conversation, while the separate PWA remains the durable workspace for imports,
comparisons, protections, reviewed jobs, ledgers, and backups.

The sidecar is intentionally not a copy of the PWA. It is the in-page toolbox
for follower comparison, reviewed account work, and DM Unsend, while the PWA
keeps durable imports, history, signed jobs, and ledgers.

## Tool surfaces

### Now

Reads the current route, session warnings, normalized profile username, and one
unambiguous relationship label. It also reports whether the current profile
matches the next actionable manual-queue item.

### Capture

The primary checker workflow is deliberately sequential: open Following and
choose **Scan Following**, open Followers and choose **Scan Followers**, then
choose **Compare**. Each scan scrolls only the currently open matching dialog
until it reaches the end or a bounded safe stop. The manual visible-row capture,
download, and reset controls remain under the secondary disclosure. Both paths
merge normalized usernames into the selected local draft and report partial
completion instead of silently under-counting. Once both lists exist, the
result browser switches among mutuals and both non-mutual groups and filters by
captured username or display name. Filtering stays in memory and renders at
most 100 matching rows at once.

The downloaded record remains import-compatible:

```json
{
  "schemaVersion": 1,
  "kind": "insta-aio-visible-list",
  "capturedAt": "2026-07-31T00:00:00.000Z",
  "following": [],
  "note": "Only rows rendered in Instagram were captured."
}
```

### Queue

Imports the existing `insta-aio-manual-queue` JSON export. It selects the next
pending, ready, paused, or failed item. **Open profile** is the single primary
control; secondary options expose:

- Open the exact normalized profile
- Mark the extension-local item complete
- Skip the extension-local item

Completion and skip do not mutate the PWA automatically. The sidecar can
download `insta-aio-companion-state` JSON for review or archiving. Signed dry-run
and controlled live results sent through the PWA bridge appear in a separate
read-only history.

The local Follow / Unfollow runner also has an explicit **Review run** phase.
Review freezes the exact targets and reports duplicates and omissions. **Start**
is rendered only while the review signature still matches the selected source,
action, limit, and target list; any change invalidates it.

Queue also contains the **Controlled live gate**. It remains locked until the
paired PWA sends a fresh signed live intent containing exactly one reviewed
Follow or Unfollow item. The sidecar then requires:

1. The exact target profile to be open and named by one visible profile header.
2. One relationship control inside that verified header matching the requested action.
3. The exact `ARM FOLLOW @username` or `ARM UNFOLLOW @username` phrase.

Arming lasts 90 seconds and performs no Instagram action. The operator must
return to the PWA and continue the same reviewed job. The PWA reinspects the
profile and arm, reserves the attempt transactionally, and only then sends the
one-use execution request. The background worker creates its own durable mirror
reservation and consumes the arm before the page-control request. Follow may
activate one exact Follow control. Unfollow stops if any dialog was already
visible and accepts only a newly surfaced confirmation that names the reviewed
username.
The relationship is inspected again before the PWA marks success.

### Messages

Reads bounded text fragments already visible in the open Instagram conversation.
It does not open a message menu. Visible fragments do not provide stable export
message IDs or reliable sender ownership, so the sidecar always records
`exactIdentityAvailable: false` and `ownershipAvailable: false` for this general
evidence capture.

A separate signed reviewed-DM dry-run route can resolve one item without a
click only when all of these visible-DOM facts match:

- The open `/direct/t/` thread ID matches the stable reviewed conversation ID.
- Exactly one rendered row exposes the reviewed message ID through a bounded
  stable-attribute allowlist.
- Its exact timestamp and content digest match the reviewed item.
- The row is proven sent by the operator through an explicit ownership marker
  or the source-audited sent-message layout signal.

Missing attributes, unknown ownership, duplicate candidates, changed content,
or a wrong thread remain safe stops. The deterministic `messages-exact` fixture
proves this no-click boundary; whether the intended authenticated Instagram DOM
currently exposes every required identity field is still an acceptance blocker.
Dry run never opens a menu. A separately signed one-message intent can appear in
the Messages gate only after the PWA's two confirmations. The sidecar enables
arming only when the open thread resolves the exact sent-message identity; the
background repeats that check before creating the 90-second arm.

The independent local thread tool starts with **Check conversation**. That
no-click pass loads history without opening a message menu and must prove a
complete finite eligible count before the plan controls appear. The operator
chooses `all`, `newest N`, or `oldest N`, then reviews the exact thread, scope,
count, digest, and 15-minute expiry. A count-specific typed phrase and final
permanent-action confirmation are required. The source-audited runner
revalidates completeness and count before the first menu, accepts only rows
proven sent by the current account, follows the rendered menu/dialog sequence,
reserves the finite plan against the daily Unsend allowance, uses the saved
delay range, and checks expiry before every next message. Incomplete or capped
checks, expiry, Stop, session loss, challenge, block, rate limit, or repeated
failure end or prevent the run.

### Workspace

Shows sanitized pairing status and links to the exact paired PWA origin. The
Instagram page receives the origin, permissions, pairing time, extension
version, bounded run summaries, and sanitized live intent/arm fields only. It
never receives the pairing secret, signed messages, signatures, replay nonces,
Instagram cookies, or credentials.

## Interaction and accessibility

- A fresh V3 install starts collapsed as a 44-pixel launcher. Migration from
  V1/V2 preserves valid prior choices and adds bounded layout defaults.
- Opening a fresh install shows one compact walkthrough naming the checker,
  Follow / Unfollow, and DM Unsend boundaries. Starting with the checker or
  dismissing the walkthrough persists `firstRunComplete` locally.
- **Alt + Shift + I** toggles it.
- Escape collapses it while focus is inside.
- Arrow keys plus Home and End move through the semantic five-tool tab rail.
- Focus indicators are visible and status changes use an `aria-live` region.
- On desktop the header is draggable, one lower-right grip resizes the panel,
  and keyboard arrows work on the move and resize handles.
- Dock side, 336/380/480-pixel presets, custom bounded size/position, 55–100%
  surface opacity, auto/light/dark theme, and comfortable/compact density are
  stored in the V3 preference record.
- The layout becomes a bounded bottom sheet at 600 pixels and narrower, with a
  separate short-height rule.
- Motion is removed when `prefers-reduced-motion` is enabled.
- Dynamic Instagram text is inserted with `textContent`, not HTML.
- Production UI and extension-local queue data remain inside a closed shadow root.

When a relevant native confirmation surface is visible, or while an exact arm
is active/being consumed, the full panel yields to a compact measured status
strip. If no non-intersecting placement is available, overlay controls remain
hidden. Instagram controls are never moved, hidden, or restyled.

## Extension and userscript availability

The Manifest V3 companion implements Now, Capture, Queue, Messages, Workspace,
signed dry-run summaries, exact one-item arm gates, and locally phrase-gated
batch tools. The Tampermonkey companion injects the same three user-facing tools
through the same Instagram engine, including paced Follow/Unfollow and DM
Unsend. It starts live-locked and has no signed PWA bridge or durable workspace
ledger.

## Safety invariants

- Dry-run routing never calls the page-control activator.
- `instagram-overlay.js` contains no Instagram selector or synthetic-event
  implementation; it delegates authorized work to the isolated shared drivers.
- `content-instagram.js` contains one isolated control activator, reachable only
  after the signed intent, exact phrase, live arm, PWA authorization check,
  ledger reservation, and short-lived DOM token all match.
- All Instagram reading is limited to the visible DOM.
- Only the explicit full-list scanner scrolls, and only inside the open account
  list dialog; normal inspection and visible capture do not scroll Instagram.
- Live settings remain off by default. Signed PWA execution still accepts at
  most one reviewed account or DM item and consumes its arm before mutation.
  Local batches require an exact typed arm; thread-wide Unsend additionally
  requires a 15-minute authorization checked inside the runner before every
  message.
- Discarding the matching PWA reviewed job aborts its in-flight pre-driver work.
  Any completed reservation is finalized `canceled`, missing-job checkpoints
  reject, and no new page driver is dispatched. A mutation already dispatched
  remains subject to postcondition and durable outcome verification because it
  cannot be recalled.
- Reviewed DM dry runs resolve only a stable exact identity. Controlled Unsend
  additionally requires two fresh confirmations, the matching Messages gate,
  independent reservations, a one-use row token, newly surfaced ARIA-bound
  interactive menu/dialog controls, repeated row revalidation, and same-thread
  exact-removal proof while another stable identity remains available.
- Session expiry, challenges, restrictions, rate limits, wrong profiles,
  stale confirmations, replayed tokens, ambiguous relationships, and missing
  message identity remain safe stops.
- Relationship and localized Unsend text use one reviewed exact-label module.
  Unicode is normalized before comparison; unavailable secure randomness stores
  no profile/message capability and reports `secure-random-unavailable`.

## Verification boundary

`tests/fixtures/overlay-preview.html` loads the actual production content scripts
with deterministic profile, list, queue, pairing, dry-run, and message states.
It supports `?mode=messages` for fragment-only evidence,
`?mode=messages-exact` for one stable exact sent-message identity,
`?mode=live-follow` for an exact one-control Follow transition, and
`?mode=live-unfollow` for an exact relationship-plus-confirmation transition.

That fixture validates runtime behavior and visual composition without account
access. It does not establish authenticated Instagram selector acceptance,
screen-reader acceptance, or a successful real-account action. Those remain
separate controlled checks. Issue #3 requires exact account before/after and
ledger evidence; issue #4 requires one exact sent-message removal plus both
durable ledger records, each from a user-selected authenticated run.

See [Overlay UI implementation](./OVERLAY_UI_IMPLEMENTATION.md) for the ordered
module graph, V1/V2-to-V3 preference migration, current verification,
and runtime limits. See
[Overlay QA](./OVERLAY_QA.md) for the production-script screenshot/state matrix,
baseline acceptance procedure, measured Windows performance, reviewed
post-redesign evidence, and remaining target-environment checks.
