# Beat Twin Execution Queue

Updated: 2026-07-14
Branch: `dev/nanodaw-standalone`
Worktree: `/home/lolo/Workspace/lolOS/Projects/beat-twin-nanodaw-standalone`

This queue keeps standalone NanoDAW work separate from the S25 gateway branch
and from live Bitwig validation. Detailed tickets live in
`docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md`.

Armada launch prompt:
`.agents/prompts/ARMADA_BEAT_TWIN_NANODAW_ROADMAP_2026-07-14.md`.

Statuses: `Ready`, `In progress`, `Blocked`, `Done`, `Parked`.

## Today - Standalone NanoDAW

| Order | ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | BT-201 | Create the isolated NanoDAW development worktree from `main` | P0 | S | Done | - |
| 2 | BT-202 | Prove the offline package, typecheck, and NanoDAW test baseline | P0 | M | Done | BT-201 |
| 3 | BT-203 | Run a real-browser NanoDAW smoke without Bitwig, MCP, gateway, or S25 | P0 | M | Done | BT-202 |
| 4 | BT-204 | Prove edit, audition, save/load, undo/redo, and reload persistence in standalone mode | P0 | L | Done | BT-203 |
| 5 | BT-205 | Make Standalone mode and unavailable external targets explicit in the UI | P1 | M | Done | BT-203 |

## Evidence Quest - Two Costumes, One Clock

These are spike steps, not committed product backlog. They activate only after
BT-204 proves the current standalone loop.

| Step | Evidence question | Status | Depends on |
| --- | --- | --- | --- |
| Q1-A | Can one headless clock and transition ledger express intent, target beat, execution, failure, cancellation, and independent stop? | Done | BT-204 |
| Q1-B | Does a disposable two-track Session Deck make the next gesture obvious? | Done | Q1-A |
| Q1-C | Does a disposable two-track Mutation Instrument create clearer musical momentum? | Done | Q1-A |
| Q1-D | Which costume is promoted, paused, or killed after one shared performance scenario? | Done | Q1-B, Q1-C |

## Next - Listening Gate

| Step | Evidence question | Status | Depends on |
| --- | --- | --- | --- |
| Q2-L | Does a human listening run confirm the Deck's clarity or reveal stronger musical pull in the Mutation Instrument? | Ready | Q1-D |

## Next - Honest Bitwig Dependency Health

| Order | ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | BT-206 | Detect the Bitwig desktop process and return a structured local status | P0 | M | Done | - |
| 7 | BT-207 | Distinguish app stopped, controller missing, TCP unavailable, MCP unavailable, and ready | P0 | M | Done | BT-206 |
| 8 | BT-208 | Expose the dependency state to TwinPilot without giving TwinPilot Beat Twin-specific logic | P1 | M | Ready | BT-207, TP-202 |

## Later - Connected Agent Mode

| ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| BT-209 | Capture the exact three-tool payload against the live S25 | P1 | M | Done | - |
| BT-210 | Implement the authenticated browser WebSocket proxy over `BrowserNanoDawPort` | P1 | L | Ready | BT-204 |
| BT-211 | Add explicit connected Agent mode while preserving browser-owned state | P1 | L | Blocked | BT-210, BT-209 |
| BT-212 | Implement the authenticated bounded `BitwigAdapter` | P1 | XL | Blocked | BT-207, BT-211 |
| BT-213 | Prove separately confirmed NanoDAW and Bitwig execution flows | P2 | XL | Blocked | BT-211, BT-212 |
| BT-214 | Package the gateway, adapters, controller, and NanoDAW install flow | P2 | L | Parked | BT-213 |

## Guardrails

- NanoDAW standalone must start and remain useful with no Bitwig process, no
  Beat Twin MCP server, no gateway, and no S25 endpoint.
- The browser remains the only owner of NanoDAW song state.
- Standalone tests must not silently start an MCP or gateway process.
- Bitwig writes remain blocked until authentication, strict bounds, target
  identity, and note readback are proven.
- Live external checks are reported separately from deterministic offline CI.

## Execution Rule

Finish BT-202 through BT-204 before opening connected-mode implementation.
BT-206 and BT-207 may run in parallel because they touch the external dependency
diagnostic path rather than the browser song state.
