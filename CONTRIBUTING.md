# Contributing

Contributions should preserve the local-first data model and safety defaults.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run assemble
pnpm test
```

## Pull requests

- Keep changes focused.
- Add fixtures and tests for data-contract changes.
- Preserve all import dispositions.
- Document new sources with an exact revision or artifact hash and license.
- Keep state migrations additive.
- Keep live settings disabled by default.
- Do not commit generated `src/app.js`, `dist`, exported user data, or local configuration.
- Update relevant documentation and third-party notices.

Run the full required gate before opening a pull request:

```bash
pnpm run assemble
pnpm test
```

Use `pnpm run benchmark:zip` for archive-path changes and build the relevant extension or desktop artifact for delivery-layer changes.

## Code style

- Prefer small browser-neutral core modules.
- Escape imported strings before display.
- Return structured errors and migration reports.
- Treat all imported files and page observations as untrusted.
- Keep browser drivers behind narrow interfaces.
- Stop on ambiguity instead of guessing.

## Security

Do not include credentials, session state, personal exports, private screenshots, or private endpoints in issues, fixtures, commits, or pull requests. Use synthetic fixtures.
