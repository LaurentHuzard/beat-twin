# Active Beat Twin Orbit

## Loop

No item is Orbit Ready. BT-WEB-001 is complete locally on
`agent/bt-web-001-react-bitwig-controller` from published `main` at `306fb23`.

## Target Outcome

From the existing Beat Twin web app, a musician can open an honest Bitwig Remote
surface, inspect current dependency/session state through a loopback server-side
bridge, and invoke a small supported command set only after an explicit browser
confirmation. Provider and Bitwig authentication secrets never enter browser
state or bundles.

## Planned Changes

- add a loopback-only Vite development bridge that delegates tool availability
  and execution to the current Beat Twin MCP policy layer;
- add a Bitwig Remote React surface inside the existing playground with clear
  disconnected, read-only, confirmation, success, and failure states;
- start with session inspection and bounded transport commands supported by the
  current bridge; do not reintroduce archive-only tool claims;
- keep NanoDAW first-run and browser-owned song state independent from Bitwig;
- cover the bridge contract and controller behavior with synthetic tests, then
  perform browser QA without issuing a live Bitwig write.

## Product Contract

- The browser remains the only owner of NanoDAW song state.
- Bitwig connection and session state are fetched through same-origin loopback
  endpoints; browser code receives neither provider keys nor bridge secrets.
- The server derives visible and executable tools from the current MCP policy.
- Every mutating browser action requires an explicit per-action confirmation.
- Standalone NanoDAW remains useful with no Bitwig, Gateway, MCP, or S25.
- Bitwig writes remain hidden and blocked by default.
- Archived `llm2Bitwig` components are design/behavior references only; missing
  or unproven tools are not advertised as current capabilities.

## Verification Plan

- focused bridge and React component tests using synthetic clients;
- `pnpm nanodaw:test`;
- `pnpm --filter @beat-twin/playground build`;
- Playwright desktop and 390px mobile disconnected/read-only controller proof;
- screenshot inspection and console checks;
- `git diff --check`;
- adversarial review for leaked secrets, policy bypass, stale confirmations,
  accidental live writes, duplicate song ownership, and false capability claims.

## Current State

The secure Bitwig Remote, loopback server bridge, synthetic coverage, docs, and
runtime read-only proof are complete. Current live dependency truth remains
separate: Bitwig Studio is stopped and the controller TCP endpoint is unavailable
on this workstation. The reviewed branch is locally committed and remains
unpublished.

## Human Gates

- The user explicitly supplied `Orbit Ready BT-WEB-001` on 2026-08-26.
- The selected slice may change Beat Twin source and deterministic tests only.
- Starting Bitwig, installing or changing its controller, exercising a live
  write, publication, merge, deployment, and branch deletion remain separate
  human gates.

## Exit Condition

Met locally. The Bitwig Remote is reachable from the current playground; it
reports dependency and policy state honestly; no secret enters the browser
bundle; unsupported archive tools are absent; mutating commands require fresh
confirmation; 148 NanoDAW tests, 177 root unit tests, the production build, 10
Playwright cases, visual inspection, console health, diff check, and adversarial
review pass without a live Bitwig write.

## Next Activation Signal

Orbit Ready is empty. Publication, live Bitwig validation, merge, deployment,
branch deletion, and any successor Orbit remain separate gates.
