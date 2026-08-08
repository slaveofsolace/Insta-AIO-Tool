# Persistent Chrome profile walkthrough

Date: 2026-08-08

This is a sanitized record of a read-only walkthrough in the operator's normal
Chrome profile while already authenticated on Instagram. No account name,
follower row, feed content, message, conversation identifier, cookie, token, or
session value is stored here.

## Proven in the installed profile

- Tampermonkey injected `#insta-aio-userscript-root` with an open shadow root on
  `instagram.com`.
- The compact AIO launcher opened the movable, translucent toolbox.
- The installed surface reported `Userscript mode · live actions locked`; the
  live-action checkbox was unchecked throughout the walkthrough.
- The authenticated home route produced the safe unsupported-route context.
- The authenticated profile route resolved its exact profile context.
- Opening a Followers dialog was read-only and exposed the current rendered
  list without arming or executing an Instagram action.

## Defects found and corrected for 0.10.4

1. **Start with the checker** dismissed the introduction but retained a
   previously selected Unsend tab. It now persists and renders the Checker tab
   before moving focus there.
2. A follower/following dialog opened without a route change, so the context
   strip did not refresh. Its generic scan action also depended on a stale list
   selector and could file Followers under Following. The observer now refreshes
   when dialog elements are added or removed, identifies Followers and Following
   separately, and binds the context action to the matching guided scan.

Both paths are reproduced in the production userscript fixture acceptance. The
generated userscript is rebuilt from its source modules rather than edited by
hand.

## Evidence boundary

The screenshot used for human inspection was intentionally not committed
because it contained the operator's private Instagram feed and account data.
Version 0.10.4 still requires installation/update in the persistent profile and
a repeat non-armed walkthrough before persistent-profile acceptance can close.
No Follow, Unfollow, message-menu click, confirmation, or Unsend occurred.
