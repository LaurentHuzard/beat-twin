# Beat Twin Execution Queue

Updated: 2026-07-20
Branch: `agent/architecture-boundaries-retention`
Worktree: isolated architecture implementation checkout

This queue keeps standalone NanoDAW work separate from the S25 gateway branch
and from live Bitwig validation. Detailed tickets live in
`docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md`.

Armada launch prompt:
`.agents/prompts/ARMADA_BEAT_TWIN_NANODAW_ROADMAP_2026-07-14.md`.

Statuses: `Ready`, `In progress`, `Blocked`, `Done`, `Parked`.

Under Orbit Program Kit governance, the legacy status `Ready` means eligible
candidate (`later`), not implementation authorization. Only the section below
may authorize a bounded product loop.

## Orbit Ready

No new implementation item is activated. BT-ARCH-101 through BT-ARCH-104 /
GitHub #46, #47, #49, and #48 are implemented and deterministically verified;
their stacked draft PR awaits review. Merge, deployment, live DAW writes, and
branch deletion remain human gates. BT-AUDIO-200 remains an eligible candidate,
not an authorization.

## NanoDAW Live sequence

| Order | ID | GitHub | Task | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | BT-LIVE-101 | #26 | Separate the ephemeral performance runtime | Done | - |
| 2 | BT-LIVE-102 | #27 | Add one persistent clock and per-track audio graph | Done | BT-LIVE-101 |
| 3 | BT-LIVE-103 | #28 | Prove a 2 x 2 quantized launcher vertical slice | Done | BT-LIVE-102 |
| 4 | BT-LIVE-105 | #30 | Add the playable 16-step editor and variations | Done | BT-LIVE-103 |
| 5 | BT-LIVE-106 | #31 | Add quantized MIDI loop recording and overdub | Done | BT-LIVE-105 |

## Standalone NanoDAW MCP

| ID | Task | Status |
| --- | --- | --- |
| BT-MCP-001 | Prepare one built-in instrument track and MIDI clip through MCP, then require browser-owned human confirmation before the atomic NanoDAW write | Done |

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
| Q2-L | Does a human listening run confirm the Deck's clarity or reveal stronger musical pull in the Mutation Instrument? | Done | Q1-D |

## Next - Honest Bitwig Dependency Health

| Order | ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | BT-206 | Detect the Bitwig desktop process and return a structured local status | P0 | M | Done | - |
| 7 | BT-207 | Distinguish app stopped, controller missing, TCP unavailable, MCP unavailable, and ready | P0 | M | Done | BT-206 |
| 8 | BT-208 | Expose the dependency state to TwinPilot without giving TwinPilot Beat Twin-specific logic | P1 | M | Done | BT-207, TP-202 |

## Later - Connected Agent Mode

| ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| BT-209 | Capture the exact three-tool payload against the live S25 | P1 | M | Done | - |
| BT-210 | Implement the authenticated browser WebSocket proxy over `BrowserNanoDawPort` | P1 | L | Done | BT-204 |
| BT-211 | Add explicit connected Agent mode while preserving browser-owned state | P1 | L | Done | BT-210, BT-209 |
| BT-212 | Implement the authenticated bounded `BitwigAdapter` | P1 | XL | Done | BT-207, BT-211 |
| BT-213 | Prove separately confirmed NanoDAW and Bitwig execution flows | P2 | XL | Ready | BT-211, BT-212 |
| BT-214 | Package the gateway, adapters, controller, and NanoDAW install flow | P2 | L | Parked | BT-213 |

## Later - Audio clips and samples

This is the next indispensable product tranche after GitHub #31. BT-LIVE-102
provides only the source-neutral engine and adapter boundary; none of the
payload, import, decode, UI, or persistence work below is implemented here.

| ID | Task | Priority | Size | Status | Depends on |
| --- | --- | --- | --- | --- | --- |
| BT-AUDIO-200 | Open the bounded audio-clip and sample playback tranche | P0 | XL | Ready | GitHub #31 |
| BT-AUDIO-201 | Define versioned browser-owned audio asset references and validation | P0 | M | Parked | BT-AUDIO-200 |
| BT-AUDIO-202 | Add explicit local import, decode, and asset lifecycle boundaries | P0 | L | Parked | BT-AUDIO-201 |
| BT-AUDIO-203 | Implement a prepared-buffer material adapter on the live engine registry | P0 | L | Parked | BT-AUDIO-202 |
| BT-AUDIO-204 | Prove non-warped clip offset, loop, replacement, and track-local stop timing | P0 | L | Parked | BT-AUDIO-203 |
| BT-AUDIO-205 | Add bounded sample/audio slot UI with honest loading and failure states | P1 | L | Parked | BT-AUDIO-204 |
| BT-AUDIO-206 | Prove save/reload, cleanup, memory bounds, browser playback, and listening gates | P0 | L | Parked | BT-AUDIO-205 |

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
