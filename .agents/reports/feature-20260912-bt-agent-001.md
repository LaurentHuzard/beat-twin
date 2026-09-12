# BT-AGENT-001 — NanoDAW-only V2 agent and TWIN inbox

## Outcome and authorization

Implemented locally on `agent/nanodaw-agent-v2`, from
`dd6164352da3916045c28563015114e1b7273d28`, following the user's 2026-09-12
approval of the next NanoDAW agent slice. No publication, PR creation, merge,
deployment, branch deletion, real provider request or live DAW write.
Historical draft implementation PR #51 was inspected but not changed.

This is an offline-verified implementation, not a completed live acceptance.
`Orbit Ready` is empty again pending the human gate.

## Delivered

- `pnpm nanodaw:agent`: HTTP/WebSocket NanoDAW runtime with explicit provider
  endpoint/model, no Bitwig secret or controller dependency, default port 8787.
- Existing stdio MCP entrypoint remains structured-only without provider config;
  it can optionally host both MCP planning and the model-backed TWIN path.
- Opt-in provider V2 requires a bounded built-in instrument. Legacy/dual-target
  callers remain V1 by default. The model still sees only list/inspect/propose.
- Authenticated loopback/Origin-gated MCP discovery, at most 32 pending reviews,
  concurrency-safe admission, expiry/consumption cleanup. This is inbox retention,
  not global plan-store persistence or restart recovery.
- TWIN polls every ten seconds after pairing. The user chooses a proposal to
  review without Developer Mode or a mandatory plan-ID copy. Arrival never
  replaces an existing preview, confirms or executes it. Errors stop discovery;
  an older Gateway's 404 preserves its existing agent flow.
- Pending pairing/model results are ignored after disable/unmount. An uncertain
  execution no longer claims that nothing changed.
- README, status, roadmap, summary and NanoDAW MCP setup aligned with this flow.

## Verification

Environment: Node 24.19.0, Corepack/pnpm 11.10.0, clean clone before edits.
Dependencies installed from the existing frozen lockfile; its only final change
is one existing workspace dependency (`nanodaw-mcp` -> `litert-provider`).

| Check | Result |
| --- | --- |
| Baseline `pnpm test` | 198 passed |
| Updated `pnpm test` | 208 passed |
| `pnpm nanodaw:test` | 165 passed, 17 files |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed, including production Vite build |
| `pnpm smoke:packages` | Passed |
| `node --check index.js` / `git diff --check` | Passed |
| Rendered-browser QA | Blocked, not validated |
| Real MUE/model, audio listening, Bitwig, S25 | Not run / not authorized |

The composed-runtime tests use real local HTTP and WebSocket transports, a
synthetic browser command runtime and an injected provider response. They prove
V2 preview, no pre-confirm mutation, exact instrument/note readback, single-use
confirmation, stale-revision rejection, Origin/auth checks, review discovery,
consumed review removal and no redispatch after a lost execution reply.
They do not prove a real model's tool-call compliance or a rendered browser.

The lost-reply case records a completed **failed/partial report** in the current
Gateway store (`error.code = partial_execution`); `completed` describes report
recording, not verified successful mutation. The synthetic browser did mutate
once, no second dispatch occurred, and TWIN instructs inspection before a new plan.

## Rendered QA blocker

Target flow: open NanoDAW -> TWIN -> pair -> incoming external proposal -> exact
review -> explicit human application. A local Vite server started successfully
on `http://127.0.0.1:5173/`. The available Cloud Browser navigation attempt timed
out after 300 seconds. A subsequent documented state read returned an explicit
Cloud Browser URL-policy denial. No alternate browser, tunnel, raw protocol or
policy workaround was attempted. No screenshot, responsive layout, rendered
interaction, console-health or current Playwright E2E pass is claimed.

## Adversarial review

- Unknown instruments, V1 payloads in V2 mode, unknown fields and off-grid notes
  fail strict validation before proposal acceptance.
- V2 rejects Bitwig inspection before invoking a handler; composition exposes
  only the NanoDAW adapter. Existing Bitwig policy and 57-tool snapshot remain green.
- Model output has no confirm/execute capability. Inbox loading is read-only;
  exact plans retain digest, revision, scopes, expiry and one-shot authority.
- Concurrent preparations reserve capacity before asynchronous work; rejected
  or failed preparations release the reservation.
- Late pairing cannot open a browser socket after disconnect. Late proposals
  cannot revive disabled TWIN state. Newly discovered plans cannot replace the
  exact preview already under review.
- Polling is sequential, bounded to 32 summaries and stops on failure; tokens
  remain memory-only. No endpoint/credential values from a real user setup were read.

## Human gate and next slices

1. Review this local implementation and explicitly authorize branch publication
   if desired. Do not open a second implementation PR under current governance.
2. Run rendered desktop/mobile QA in an environment permitted to reach the local
   app, then a separately authorized real MUE request and human listening check.
3. Only after acceptance, consider merge. Variation/slot placement, audition,
   multi-clip generation and MIDI export remain separate contracts/slices.
4. Runtime extraction (#49), global bounded retention and restart recovery remain
   architecture follow-ups; this slice intentionally does not claim them solved.
