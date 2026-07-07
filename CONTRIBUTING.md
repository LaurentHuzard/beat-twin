# Contributing

Thanks for looking at Beat Twin.

## Development Setup

```bash
pnpm install
pnpm test
node --check index.js
```

The default test suite is offline and does not require Bitwig Studio.

## Safety Expectations

- Keep read-only behavior as the default.
- Add or update policy tests for every new write tool.
- Do not expose broad DAW mutations without an explicit policy gate.
- Test live Bitwig changes only in disposable projects or copies of real sessions.

## Documentation

Public docs should describe behavior that exists, behavior covered by tests, or clearly marked future direction.
