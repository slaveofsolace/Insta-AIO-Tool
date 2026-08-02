# Instagram sidecar

## Product role

The **Insta AIO Field Desk** restores the original in-page operating model:
Instagram is the place where the operator sees the current account, list, or
conversation, while the separate PWA remains the durable workspace for imports,
comparisons, protections, reviewed jobs, ledgers, and backups.

The sidecar is intentionally not a copy of the PWA. It is a narrow field layer
for context and the next manual step.

## Tool surfaces

### Now

Reads the current route, session warnings, normalized profile username, and one
unambiguous relationship label. It also reports whether the current profile
matches the next actionable manual-queue item.

### Capture

Reads only account anchors currently rendered in an Instagram dialog or the
main page. Each user-selected capture merges by normalized username into the
current follower or following draft. It never scrolls the page.

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
pending, ready, paused, or failed item and exposes three deliberate controls:

- Open the exact normalized profile
- Mark the extension-local item complete
- Skip the extension-local item

Completion and skip do not mutate the PWA automatically. The sidecar can
download `insta-aio-companion-state` JSON for review or archiving. Signed dry-run
and controlled live results sent through the PWA bridge appear in a separate
read-only history.

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

### Workspace

Shows sanitized pairing status and links to the exact paired PWA origin. The
Instagram page receives the origin, permissions, pairing time, extension
version, bounded run summaries, and sanitized live intent/arm fields only. It
never receives the pairing secret, signed messages, signatures, replay nonces,
Instagram cookies, or credentials.

## Interaction and accessibility

- The sidecar opens by default on desktop and remembers the operator's last state.
- **Alt + Shift + I** toggles it.
- Escape collapses it while focus is inside.
- Focus indicators are visible and status changes use an `aria-live` region.
- The layout becomes a full-height mobile work surface below 540 pixels.
- Motion is removed when `prefers-reduced-motion` is enabled.
- Dynamic Instagram text is inserted with `textContent`, not HTML.
- Production UI and extension-local queue data remain inside a closed shadow root.

## Safety invariants

- Dry-run routing never calls the page-control activator.
- `instagram-overlay.js` contains no page-control or synthetic-event path.
- `content-instagram.js` contains one isolated control activator, reachable only
  after the signed intent, exact phrase, live arm, PWA authorization check,
  ledger reservation, and short-lived DOM token all match.
- All Instagram reading is limited to the visible DOM.
- The sidecar does not auto-scroll.
- Live settings remain off by default; the extension accepts at most one
  reviewed account or DM item and consumes its arm before mutation.
- Reviewed DM dry runs resolve only a stable exact identity. Controlled Unsend
  additionally requires two fresh confirmations, the matching Messages gate,
  independent reservations, a one-use row token, newly surfaced ARIA-bound
  interactive menu/dialog controls, repeated row revalidation, and same-thread
  exact-removal proof while another stable identity remains available.
- Session expiry, challenges, restrictions, rate limits, wrong profiles,
  stale confirmations, replayed tokens, ambiguous relationships, and missing
  message identity remain safe stops.

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
