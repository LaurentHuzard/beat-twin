# BT-213A — Supported RTX-to-Bitwig Preview Runtime

Date: 2026-08-27
Branch: `agent/bt-213a-rtx-bitwig-runtime`
Base: merged `main` at `2edf207`
State: complete and validated locally; publication not authorized

## Product Outcome

Beat Twin now has a supported repository runtime that composes the real
loopback Gateway, OpenAI-compatible Qwen provider, bounded `BitwigAdapter`,
compiler, plan store, and immutable preview. Operators no longer need an
ephemeral Node harness for the RTX-to-Bitwig read/propose path.

The daemon starts with `pnpm gateway:rtx-bitwig-preview`. The disposable live
diagnostic starts with `pnpm smoke:rtx-bitwig-preview`, creates an in-memory
operator secret and ephemeral Gateway port, prints the inspection and preview,
then closes.

## Preview-Only Boundary

- the Gateway listens only on `127.0.0.1` or `::1`;
- Qwen sees exactly `list_daw_targets`, `inspect_session`, and
  `propose_song_patch`;
- provider requests retain `parallel_tool_calls: false`;
- pairing omits `plan.confirm` and `plan.execute`;
- plan status, confirmation, and execution routes return
  `404 route_not_found`;
- the injected Bitwig port implements `target.inspect` only and throws before
  authentication or mutation;
- the operator secret and pairing token are not printed;
- the historical MCP runtime and browser-owned NanoDAW state are unchanged.

## Live Evidence

The existing llama.cpp setup was started through the configured `rtx` SSH
target without changing its installation or arguments. `/v1/models` returned
`qwen3-8b` with context 8192.

The final live smoke inspected a human-selected empty target in project
`New 2`, track position 0, scene slot 1, target generation 14. The local
controller identifier is intentionally omitted from this durable report.
Before and after the smoke the target had no content, clip, or notes, and its
transport was stopped at 132 BPM.

Request:

`Inspecte ma session Bitwig puis propose une boucle électronique minimale à 132 BPM.`

Result:

- Gateway health: healthy;
- model: `qwen3-8b`;
- model steps: 2;
- patch: SongPatchV1 with exact `tempoBpm: 132`;
- track: instrument `Electronic Loop`;
- clip: `Main Loop`, 8 beats;
- notes: one C4, velocity 100, beat 0, duration 1 beat;
- plan scopes: `song.write` for accurate materialization only;
- write availability: false.

Materialized preview:

1. create song projection `Electronic Loop` at 132 BPM;
2. create instrument track `Electronic Loop`;
3. create clip `Main Loop`, start 0, length 8 beats;
4. add MIDI note 60, velocity 100, start 0, length 1 beat.

The ephemeral plan expired after two minutes. It cannot be confirmed or
executed through this runtime.

## Failure Evidence

- the first live attempt exposed and fixed a deterministic URL/string
  normalization bug before any RTX or Bitwig request;
- the next attempt reported the RTX endpoint unavailable; direct inspection
  confirmed connection refusal;
- after the existing remote server was started, a run against the filled
  BT-RTX-004 slot failed closed during capability validation;
- read-only inspection confirmed that slot still contained its four-note clip;
- selecting a distinct empty slot allowed the final live preview to pass.

No guard was relaxed to make these attempts pass.

## Verification

- focused Gateway suite: 15 passed, 0 failed;
- `pnpm test`: 195 passed, 0 failed;
- `pnpm typecheck`: passed;
- `pnpm smoke:packages`: passed;
- runtime, CLI, smoke, and controller JavaScript syntax checks: passed;
- `git diff --check`: passed;
- live RTX models check: passed;
- live Bitwig read-only inspection: passed;
- live bounded preview: passed;
- live Bitwig write: not attempted.

Node 26.4.0 emitted the known unsupported-engine warning. Node 24 was not
installed, and the declared engine range was not changed.

## Adversarial Review

- a pairing token cannot acquire confirmation or execution scopes;
- knowing a plan ID cannot reveal an execution status or reach confirm/execute
  routes in preview mode;
- even an internal accidental adapter execution cannot authenticate or mutate
  through the read-only port;
- non-loopback Gateway or controller hosts fail configuration validation;
- malformed provider, controller, and DAW state remain strictly validated;
- model output cannot supply IDs, confirmation, execution, raw RPC, or target
  replacement;
- no automatic retry follows any mutation because this runtime cannot dispatch
  one;
- secrets are absent from logs, model messages, plans, and durable evidence.

## Next Activation Signal

`BT-213B` may use one portable patch for separate NanoDAW and Bitwig plans with
separate human confirmations. A new exact preview, disposable target, bridge
secret, and explicit confirmation remain mandatory before any Bitwig write.
