# Security policy

## Supported version

Security fixes are applied to the latest `main` branch and the most recent published release.

## Reporting

Please report suspected vulnerabilities privately through GitHub's security-advisory feature for this repository. Do not include Instagram credentials, browser-session values, exported message content, or another person's private data in a report.

Include:

- Affected version or commit
- Reproduction steps using synthetic data
- Expected and actual behavior
- Security impact
- A suggested fix, if available

## Security boundaries

Insta AIO Tool:

- Processes imports locally
- Does not request an Instagram password
- Does not export Instagram session state
- Does not include analytics or telemetry
- Rejects bridge payload fields associated with credentials or authorization
- Keeps live execution locked off by default
- Keeps dry runs no-click and permits only a fresh, signed, reviewed batch of
  exactly one Follow or Unfollow item through the short-lived Instagram arm,
  PWA and extension-side durable ledgers, verified profile-header ownership,
  target-bound confirmation dialog, and one-use DOM-token boundary
- Permits one exact sent-message Unsend only after two fresh confirmations, a
  signed one-item intent, a tab-scoped 90-second arm, exact conversation,
  message, timestamp, content-digest, and sent-ownership revalidation, PWA and
  extension-side reservations, one-use DOM-token consumption, structurally
  bound interactive menu/dialog controls, and same-thread exact-removal proof
  with stable identity coverage
- Permits a local thread-wide Unsend only after a no-click full-history check
  proves a finite eligible count, followed by an exact thread/scope/count/
  digest/expiry plan, a count-specific typed phrase, and a final confirmation.
  The count and full-history completeness are revalidated before the first
  message menu opens; the finite plan is reserved against a persistent daily
  allowance and uses bounded pacing; capped or incomplete checks cannot create
  a live plan
- Requires reviewed job digests and explicit confirmations
- Uses transactional duplicate and finite-limit enforcement, including restored state
- Safe-stops on uncertain browser state

Exported workspace and job files can contain imported personal data and
extension pairing secrets. Store them as sensitive files. Revoke pairings
before sharing a workspace export, and do not publish real exports as issue
attachments or test fixtures.

## Out of scope

The project does not support:

- Challenge or CAPTCHA bypass
- Proxy rotation
- Browser fingerprint spoofing
- Arbitrary endpoint discovery or mutation-capable private endpoint clients
- Unreviewed destructive execution
- Attempts to evade Instagram restrictions

Reports requesting or depending on those behaviors will not be implemented.

The follower checker is the narrow exception for authenticated web reads. It
uses a fixed allowlist of the exact search, Followers, and Following GET routes
reviewed from the supplied legacy checker, a fixed application header, bounded
pagination, and browser-managed credentials. It does not read or export cookies,
accept arbitrary routes, or expose a mutation method. Instagram can change or
remove these unsupported web routes at any time; errors, challenges, blocks, and
rate limits stop the read.

The latest dependency and application-boundary review is documented in
[`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md).
