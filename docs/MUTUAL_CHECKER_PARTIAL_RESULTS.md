# Partial mutual comparisons

Results stay available when Instagram returns fewer accounts than expected. Browse or search the comparison in the panel, download the readable report, or use **Advanced → Download machine-readable JSON**.

- **Mutuals:** accounts found in both captured lists.
- **Not found in followers:** captured following accounts absent from the captured followers list. If that list is partial, these accounts may still follow you.
- **Not found in following:** captured followers absent from the captured following list. If that list is partial, you may still follow them.

The report and JSON keep the partial status and warning. They do not turn missing records into confirmed relationship changes. Saved rows from older captures remain viewable; a fresh, complete check is required before comparison-based Follow / Unfollow runs.

## Why a list can be partial

The checker follows each returned page cursor, removes duplicates, and checks collected counts against the exact profile totals. It marks a list partial when Instagram reports a limit, stops supplying a next-page cursor before the expected total, changes the totals during the check, or returns data that cannot be reconciled. It does not invent missing accounts or repeat the whole scan to fill the gap.

Instagram moderates spam and fake followers. [Meta describes those controls](https://about.fb.com/news/2024/06/protecting-athletes-and-fans-on-our-apps-during-major-sporting-events-this-summer/). That does **not** establish why any particular capture is short. Deactivated or otherwise unavailable accounts are possible explanations, not identified causes: a missing record contains neither an account identity nor its status. The checker cannot distinguish those possibilities from a server-side omission using a count mismatch alone.

Rate limiting is a separate condition. The checker honors supplied reset times and shows its fallback wait when Instagram supplies none. See [cooldowns](MUTUAL_CHECKER_COOLDOWNS.md). No request pattern can guarantee that Instagram will expose every relationship.
