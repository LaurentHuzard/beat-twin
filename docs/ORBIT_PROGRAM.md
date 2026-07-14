# Beat Twin Orbit Program

## Adapter

- default branch: `main`;
- readiness projection: `.agents/queue.md`;
- canonical authorization section: `Orbit Ready`;
- legacy queue status `Ready`: eligible candidate mapped to Orbit `later`;
- implementation branches: `agent/{slug}`;
- reports: `.agents/reports/`.

## Verification Evidence

Offline baseline:

```text
pnpm test
pnpm typecheck
node --check index.js
```

`pnpm smoke:read-only`, Bitwig interaction, controller checks, Gateway/S25
captures, and any write validation are live checks. They must be explicitly
requested and reported separately from deterministic offline CI.

## Readiness And Concurrency

The existing execution tables may contain multiple `Ready` candidates. They do
not authorize implementation. Only one ticket may appear under `Orbit Ready`,
and only one implementation PR may be open.

## Product Gates

- product constitution or safety-model change;
- movement into `Orbit Ready`;
- live DAW or provider access;
- any write-capable test or execution;
- merge, publication, deployment, credential change, or branch deletion.

## Kill Switch

Stop when readiness disappears, the target changes, user work overlaps planned
files, live evidence is required but unavailable, write safety is ambiguous, or
the requested action exceeds the current plan.
