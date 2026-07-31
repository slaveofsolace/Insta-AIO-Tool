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
results sent through the PWA bridge appear in a separate read-only history.

### Messages

Reads bounded text fragments already visible in the open Instagram conversation.
It does not open a message menu. Visible fragments do not provide stable export
message IDs or reliable sender ownership, so the sidecar always records
`exactIdentityAvailable: false` and `ownershipAvailable: false` in this release.
The extension therefore keeps DM action jobs at the existing
`exact-message-identity-unavailable` safe stop.

### Workspace

Shows sanitized pairing status and links to the exact paired PWA origin. The
Instagram page receives the origin, permissions, pairing time, extension
version, and bounded dry-run summaries only. It never receives the pairing
secret, signed messages, signatures, replay nonces, Instagram cookies, or
credentials.

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

- `content-instagram.js` and `instagram-overlay.js` contain no `.click()` or
  synthetic mouse-event path.
- All Instagram reading is limited to the visible DOM.
- The sidecar does not auto-scroll.
- Live Follow, Unfollow, and Unsend controls are absent.
- The background worker still rejects every non-dry-run reviewed job.
- Session expiry, challenges, restrictions, rate limits, wrong profiles,
  ambiguous relationships, and missing message identity remain safe stops.

## Verification boundary

`tests/fixtures/overlay-preview.html` loads the actual production content scripts
with deterministic profile, list, queue, pairing, dry-run, and message states.
It supports `?mode=messages` for the conversation fixture.

That fixture validates runtime behavior and visual composition without account
access. It does not establish authenticated Instagram selector acceptance,
screen-reader acceptance, or authorization for live execution. Those remain
separate controlled checks.
