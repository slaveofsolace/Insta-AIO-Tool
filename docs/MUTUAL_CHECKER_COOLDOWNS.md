# Mutual Checker cooldowns

When Instagram rate-limits a read, the checker waits before retrying the same request. Completed pages stay in memory; a retry does not restart the lists.

- **Instagram supplies Retry-After:** wait at least the supplied number of seconds or until the supplied HTTP date.
- **No usable Retry-After:** wait five minutes, then ten, then twenty for repeated rate limits. This is automatic backoff, not a prediction of Instagram's reset time.
- **Stop:** cancel the pending retry immediately. Restarting in the same tab still honors its outstanding cooldown.
- **Login, challenge, account restriction, or profile change:** stop without retrying.

The countdown identifies whether the wait came from Instagram. There are no requests during the wait. A check retains its 20-minute overall deadline and permits at most eight automatic rate-limit retries. If a wait would exceed the deadline, it stops and reports the earliest retry time instead of shortening Instagram's delay. Even a zero-second header gets a one-second minimum wait.

Cooldown state lasts for the current page. It is not synchronized between tabs or persisted across reloads. Do not open another scan or reload to skip a restriction. A stopped or failed check does not replace saved comparison data. A successful request does not by itself prove that Instagram returned complete lists.

These retries cannot recover records that Instagram omits or guarantee that an account, session, endpoint, or IP restriction will clear.

[Retry-After reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After)
