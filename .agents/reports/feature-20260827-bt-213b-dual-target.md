# BT-213B — One Patch, Two Independent Plans

Date: 2026-08-27
Branch: `agent/bt-213b-dual-target`
Base: merged `main` at `7a72231`
State: complete and validated locally; publication and writes not authorized

## Product Outcome

Beat Twin can now inspect the browser-owned NanoDAW and a bounded Bitwig target
in one model run, accept one validated portable `SongPatchV1`, and materialize
that exact patch into two independently reviewable immutable plans. Each target
keeps its own capabilities, revision, request ID, command IDs, plan ID, digest,
confirmation domain, execution report, and readback.

The supported loopback runtime starts with `pnpm gateway:rtx-dual-target`. The
side-effect-free preparation command is `pnpm preview:rtx-dual-target`.

## Generic Contract

- the model runs once and never invents a different patch per target;
- model-visible tools remain exactly `list_daw_targets`, `inspect_session`, and
  `propose_song_patch`;
- observations and capability checks are target-specific and precede plan
  creation;
- both preparations must validate before either immutable plan is stored;
- NanoDAW and Bitwig plans have distinct IDs, command IDs, digests, and exact
  confirmations;
- a confirmation token for one target cannot execute the other target;
- no automatic retry follows an uncertain mutation;
- preview creation performs no confirmation or execution.

## Project-Specific Boundary

NanoDAW state remains owned by the real browser command runtime over the
authenticated WebSocket proxy. Bitwig remains bound to the human-selected
launcher slot through the existing adapter and controller target identity.
Qwen never receives confirmation, execution, transport, raw Bitwig RPC, or the
historical MCP write tools.

## Provider Finding

The first live attempts timed out at 15 and 60 seconds before any tool call.
RTX logs proved Qwen was healthy at roughly 65–68 tokens/s but continued
unbounded reasoning until the HTTP client cancelled it. The live llama.cpp
server accepted the request-level `thinking_budget_tokens: 512` extension and
then emitted one `inspect_session` tool call in 8.3 seconds.

The provider now supports an optional non-negative `thinkingBudgetTokens`.
It omits the extension by default, preserving the LiteRT/S25 payload. RTX
runtimes explicitly default to 512 reasoning tokens and 60 seconds per model
step; both bounds are configurable through positive/non-negative environment
values.

## Live Evidence

The final request was:

`Inspecte NanoDAW et Bitwig puis propose la même boucle électronique minimale à 132 BPM.`

Qwen returned four strictly sequential steps:

1. `list_daw_targets`;
2. `inspect_session`;
3. `inspect_session`;
4. `propose_song_patch` alone.

The validated patch was SongPatchV1 at exactly 132 BPM with instrument track
`Kick Loop`, clip `Kick` of 4 beats, and four MIDI notes at pitch 36, velocity
127, beats 0, 1, 2, and 3, each one beat long.

NanoDAW preview:

- base revision: 0;
- create song `Kick Loop` at 132 BPM;
- create instrument track `Kick Loop`;
- create clip `Kick`, start 0, length 4 beats;
- add the four materialized notes;
- plan: `plan-2cc46ea2-effd-4239-b5ce-b95b4e2d1f98`;
- digest: `66fe5c7f893c819bf35e8305e6e5f9afc5ebcc80e2d4adf6f995ff78bc8176c8`.

Bitwig preview:

- project: `New 2`;
- track position: 0, track name `Electronic Loop`;
- scene slot: 2;
- target generation: 16;
- create song projection `Kick Loop` at 132 BPM;
- create instrument track projection `Kick Loop`;
- create clip `Kick`, start 0, length 4 beats;
- add the four materialized notes;
- plan: `plan-8e75813d-ae41-4127-9eea-9e9c0c3a260f`;
- digest: `3937292c0d0ad044328bd3c602580f296009b86dd2f305c726568223f45e5f25`.

The preview command reported `confirmationsCreated: 0` and
`executionsDispatched: 0`. These plans expired after two minutes.

Final readbacks proved NanoDAW still had 0 tracks, 0 clips, and 0 notes. Bitwig
retained the same project, track position, slot, generation, empty content,
empty note list, stopped transport, and 132 BPM tempo.

## Verification

- provider build: passed;
- focused provider/Gateway runtime tests: 30 passed, 0 failed;
- `pnpm test`: 198 passed, 0 failed;
- `pnpm typecheck`: passed;
- `pnpm smoke:packages`: passed for 9 packages;
- JavaScript syntax checks for the runtime and CLI: passed;
- real browser Agent mode pairing: passed;
- live RTX compatibility request with bounded reasoning: passed;
- live dual-target Qwen run: passed in 4 steps;
- live NanoDAW readback: passed, unchanged;
- live Bitwig readback: passed, unchanged;
- live NanoDAW or Bitwig write: not attempted.

Node 26.4.0 emitted the known unsupported-engine warning. Node 24 was not
installed and the declared engine range was not changed.

## Adversarial Review

- the current proof runtime deliberately used an invalid Bitwig bridge secret,
  so an accidental write could not authenticate;
- model output cannot choose executable IDs, digests, confirmation tokens, raw
  RPC methods, or execution routes;
- cross-target confirmation reuse fails authentication and dispatches neither
  adapter;
- a missing browser, stale Bitwig target, capability mismatch, malformed patch,
  model timeout, or invalid provider response fails before plan execution;
- the two observations are frozen for one run and target selection cannot drift
  during model steps;
- secrets and pairing tokens were not printed, persisted, or sent to Qwen;
- no new Bitwig or NanoDAW mutation occurred.

## Git

The work remains uncommitted on `agent/bt-213b-dual-target`. No push, PR,
merge, branch deletion, deployment, or remote RTX shutdown was performed.

## Remaining Risks

- the current SongPatchV1 remains intentionally narrow, so Qwen's musical
  result is a simple kick pattern rather than a rich arrangement;
- live confirmation and execution of both targets still require two fresh
  non-expired plans, the real bridge secret, exact human review, and two
  explicit confirmation gates;
- Node 24 CI remains the engine-authoritative proof; the local live run used
  unsupported Node 26.4.0.

## Next Activation Signal

Activate a bounded execution slice only when a disposable NanoDAW song and
Bitwig project are ready for two fresh previews and two separately stated human
confirmations. Packaging remains `BT-214` and is not activated by this report.
