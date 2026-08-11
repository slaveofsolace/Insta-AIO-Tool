# Operator acceptance runbook

This runbook closes the checks that automated fixtures and disposable browser
profiles cannot prove. Complete it in the intended persistent browser profile.
Keep Instagram live actions locked until the read-only and screen-reader
sections pass.

## Acceptance record

- Date and time:
- Operator:
- Operating system:
- Browser and version:
- Companion: Tampermonkey / unpacked extension
- Companion version:
- PWA installed and paired: yes / no / not tested
- Instagram account identifier: record privately; do not commit it
- Result: pass / revise / stopped
- Findings or evidence location:

Do not place account names, messages, conversation identifiers, cookies,
tokens, or private Instagram screenshots in the repository.

## 1. Install and prove the safe default

1. Follow [Installation](./INSTALLATION.md) and update the companion.
2. In Tampermonkey, confirm **Insta AIO Instagram Toolbox 0.10.5** or later. If
   Chrome is used, open Tampermonkey's extension details and enable
   **Allow User Scripts**.
3. Reload `https://www.instagram.com/`, then press **Alt + Shift + I**.
4. Confirm the toolbox reports **Userscript mode · live actions locked**, or
   the extension's equivalent live-off state.
5. Confirm the live-action setting is off. Do not enable it during sections 1–4.
6. Move the panel, resize it from the lower-right corner, and change its
   translucency. Confirm Instagram remains visible beneath it and every control
   remains reachable.
7. Reload once and confirm the intended position, size, translucency, and
   live-off state restore without covering a native Instagram dialog.

Stop if the version is older, the lock is absent, a control is unreachable, or
the panel interferes with a native confirmation surface.

## 2. Authenticated read-only route walkthrough

No menu, confirmation, Follow, Unfollow, or Unsend control may be activated.

1. On Instagram home, confirm the context says that there is no supported
   read-only workflow on that route.
2. Open the intended account profile. Confirm the profile context names the
   visible profile and offers only a no-click inspection until a reviewed run
   exists.
3. Open **Following**. Confirm the toolbox says **Following list open** and the
   contextual action is **Scan Following**.
4. Run the scan. It may scroll the open list to read rows; it must not activate
   an account relationship control. Record discovered, deduplicated, and
   completion counts.
5. Close that dialog, open **Followers**, and confirm **Followers list open**
   with **Scan Followers**. Run the same read-only scan.
6. Choose **Compare**. Confirm mutuals, not-following-me-back, and
   I-do-not-follow-back filters work locally.
7. Open an exact direct-message thread. Confirm the toolbox identifies the
   conversation route. Choose the quieter **Check conversation** action and
   confirm it opens no message menu and no confirmation dialog.
8. Return to each tool and confirm live actions are still locked.

Stop immediately on a challenge, checkpoint, action block, session expiry,
ambiguous target, wrong route, or unexpected Instagram control activation.

## 3. Human screen-reader walkthrough

A person must perform and record this section. An accessibility tree or
automated audit is not a substitute.

1. Start the platform screen reader, then navigate only with the keyboard.
2. Open and close the toolbox. Confirm focus enters a named region and returns
   to the launcher when the panel closes.
3. Move through the three tool tabs. Confirm one tab is announced as selected,
   each tab has a useful name, and its matching panel is read in logical order.
4. Confirm headings, context, live-lock status, form labels, buttons, progress,
   counts, warnings, and stop reasons are announced once and in task order.
5. Expand and collapse advanced settings. Confirm hidden controls are not read
   or focusable.
6. Trigger read-only scan progress and safe empty states. Confirm status changes
   are announced without moving focus unexpectedly.
7. Repeat at 200% zoom and with the browser's dark theme. If the platform
   supports forced colors, repeat the lock, tabs, and primary-action checks
   there.
8. Record every confusing label, missing announcement, duplicate announcement,
   focus loss, or reading-order problem. Mark this section passed only after a
   person has reviewed the findings.

## 4. Persistent-profile PWA pairing

If the extension and PWA are part of the intended workflow:

1. Install the PWA using [Installation](./INSTALLATION.md).
2. Pair only the exact local PWA origin with the unpacked extension.
3. Confirm read permission and action permission are separate.
4. Leave action permission and every live setting off.
5. Run the pairing ping and one signed read-only inspection.
6. Confirm no cookie, session token, password, or private endpoint data appears
   in the PWA, bridge history, downloads, or logs.

## 5. Separately authorized one-item live acceptance

Do not begin this section from a general approval to test the application. The
operator must provide a new, execution-time authorization naming exactly one
target and one action.

### Follow or Unfollow

Record privately:

- exact account:
- exact action: Follow / Unfollow
- authorization time:
- expected relationship before:

Review a batch of exactly one, capture sanitized before-state evidence, complete
the typed arm, execute once, and capture the returned result plus both durable
ledger records. Stop if the relationship, account, route, arm, permission,
limit, protection, or reviewed digest changes.

### One-message Unsend

Record privately:

- exact conversation:
- exact sent message:
- authorization time:
- expected message identity before:

Use only the reviewed one-message path. Confirm sent ownership twice, complete
the exact thread arm, execute once, and capture sanitized before/after DOM
evidence plus both durable ledger records. Never target a received or ambiguous
message. Do not use a successful one-item acceptance as permission for a
thread-wide run.

## Completion

Issues #3 and #4 can close only after their matching one-item live record exists.
Issue #5 can close only after sections 1–4 and any selected release-signing
requirements pass. Issue #12 can close only after the human screen-reader
findings are recorded and the corrected persistent-profile UI is accepted.
