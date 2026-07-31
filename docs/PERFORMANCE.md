# Performance

## ZIP baseline

Command:

```bash
pnpm run benchmark:zip
```

Measured fixture:

- 100 JSON files
- 10,000 messages
- 116,282-byte archive
- 1,292,400 expanded bytes

Observed result on the development environment:

| Stage | Time |
|---|---:|
| Archive inspection | 1 ms |
| Extraction | 186 ms |
| Normalization | 6 ms |
| Total import | 192 ms |

The result produced 10,000 messages with no warnings.

This is a regression baseline for the fixture, not a universal device guarantee. Archive structure, storage performance, browser scheduling, compression ratio, and message size affect real imports.

## Responsiveness controls

- ZIP extraction runs in a worker.
- Progress updates are reported per supported entry.
- Cancellation uses `AbortController`.
- Extraction and normalization yield between batches.
- Queue and message views render bounded windows instead of the full collection.

The windowing unit case uses 100,000 records and renders a 20-record window at the tested scroll position.

## Limits

Archive entry counts, expanded sizes, compression methods, and path safety are validated before commit. Limits are intended to prevent accidental resource exhaustion and should be changed only with benchmark and malformed-archive coverage.
