# Partial mutual comparisons

Results stay available when Instagram returns fewer accounts than expected. Browse or search the comparison in the panel, download the readable report, or use **Advanced → Download machine-readable JSON**.

- **Mutuals:** accounts found in both captured lists.
- **Not found in followers:** captured following accounts absent from the captured followers list. If that list is partial, these accounts may still follow you.
- **Not found in following:** captured followers absent from the captured following list. If that list is partial, you may still follow them.

The report and JSON keep the partial status and warning. They do not turn missing records into confirmed relationship changes. Captured results can supply Follow / Unfollow targets even when partial. Review and confirmation show that some targets may still be mutuals. Each profile's current relationship is checked before acting. Older unverified captures need a fresh scan, and captures must belong to the signed-in account.

## Why a list can be partial

The checker follows each returned page cursor, removes duplicates, and checks collected counts against the exact profile totals. It marks a list partial when Instagram reports a limit, stops supplying a next-page cursor before the expected total, changes the totals during the check, or returns data that cannot be reconciled. It does not invent missing accounts or repeat the whole scan to fill the gap.

One documented cause is viewer-age filtering. In [Instaloader issue #1021](https://github.com/instaloader/instaloader/issues/1021), a maintainer reproduced a complete 1,666-account result with a birthday on the signed-in viewer account and a 1,646-account result without one. The setting belongs to the account running the check, not the profiles missing from the list. For a partial result, check the signed-in account's birthday in [Accounts Center](https://accountscenter.instagram.com/personal_info), reload Instagram, and run the check again.

That workaround is not universal. The original reporter later confirmed that their signed-in account was already age-verified and still had missing followers. Insta Toolbox therefore keeps the captured comparison visible, labels it partial, and presents age filtering as a possible cause rather than a diagnosis.

Instagram moderates spam and fake followers. [Meta describes those controls](https://about.fb.com/news/2024/06/protecting-athletes-and-fans-on-our-apps-during-major-sporting-events-this-summer/). That does **not** establish why any particular capture is short. Deactivated or otherwise unavailable accounts are possible explanations, not identified causes: a missing record contains neither an account identity nor its status. The checker cannot distinguish those possibilities from a server-side omission using a count mismatch alone.

Rate limiting is a separate condition. The checker honors supplied reset times and shows its fallback wait when Instagram supplies none. See [cooldowns](MUTUAL_CHECKER_COOLDOWNS.md). No request pattern can guarantee that Instagram will expose every relationship.
