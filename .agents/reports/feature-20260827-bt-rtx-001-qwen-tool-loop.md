# BT-RTX-001 — Bounded Qwen Tool Loop And RTX Preview

Date: 2026-08-27
Branch: `agent/bt-rtx-001-qwen-tool-loop`
Base: published `main` at `035e82d`
State: complete and validated; publication authorized separately by the user

## Product Outcome

Beat Twin now explicitly asks OpenAI-compatible model servers to disable
parallel tool calls. Qwen3-8B on the RTX llama.cpp server produced the intended
two-turn read/propose sequence, with `inspect_session` alone in step one and
`propose_song_patch` alone in step two. A real Gateway run then compiled the
validated 132 BPM patch into an immutable Bitwig-bound plan and side-effect-free
preview using a synthetic empty target.

## Generic Contract

- the model may call at most one tool per assistant turn;
- a read call must receive its result before another tool call;
- `propose_song_patch` remains the only allowed call in its model step;
- provider requests set `parallel_tool_calls: false` without weakening response
  validation;
- explicit musical constraints remain model instructions, while Beat Twin
  retains validation, compilation, IDs, policy, preview, confirmation,
  execution, idempotence, audit, and readback.

## Project-Specific Boundary

The model-visible registry remains exactly `list_daw_targets`,
`inspect_session`, and `propose_song_patch`. It contains no confirmation,
execution, preview, transport, raw Bitwig RPC, undo, or historical MCP tool.
The RTX server configuration and Bitwig controller were not changed.

## Changes

- strengthened the concise default system prompt with sequential-tool,
  isolated-proposal, explicit-constraint, exact top-level tempo, and
  no-execution rules;
- clarified the proposal tool description for explicitly requested tempo;
- added `parallel_tool_calls: false` to provider and official capture requests;
- extended deterministic request-body coverage for the sequential flag,
  `tool_choice`, exact tool registry, and default prompt;
- recorded BT-RTX-001 activation, evidence, gates, and completion in Orbit
  governance files.

## Verification

- `pnpm --filter @beat-twin/litert-provider build`: passed;
- focused provider test file: passed;
- `pnpm test`: 186 passed, 0 failed with loopback sockets permitted;
- `pnpm typecheck`: passed;
- `git diff --check`: passed;
- `pnpm capture:s25-tool-call` against `qwen3-8b`: API request, parser, and
  SongPatch validation passed with `parallel_tool_calls: false`;
- live `runAgent` against `http://192.168.1.141:8002/`: two steps, one call per
  step, valid `tempoBpm: 132`, and preview-only proposal handler;
- live Gateway composition with real provider, compiler, plan store, and
  `BitwigAdapter` over synthetic inspection: HTTP 201, five materialized
  commands, required scope `song.write`, and zero authentication/mutation calls.

All local commands ran on Node 26.4.0 and emitted the known unsupported-engine
warning because the repository supports Node 22 or 24. `package.json` was not
changed. The first sandboxed full test attempt reported three socket-suite file
failures; their 21 cases passed separately outside the network sandbox, and the
final full authorized run passed 186/186.

## Provider State

- `/v1/models` returned `qwen3-8b`;
- llama.cpp accepted `parallel_tool_calls: false` and returned HTTP 200;
- observed generation speed remained about 67-70 tokens/s;
- the successful 132 BPM run produced `inspect_session` in step one and an
  isolated valid proposal in step two;
- the official direct 120 BPM capture remained schema-valid but omitted
  `tempoBpm` even though Qwen mentioned it in reasoning. Prompt-only adherence
  is therefore not a deterministic semantic validator.

## Preview Evidence

The synthetic empty Bitwig target was track position 0, scene slot 0. The
Gateway preview materialized:

1. `CreateSong` named `Kick` at 132 BPM;
2. `CreateTrack` named `Kick`, kind `instrument`;
3. `CreateClip` named `Loop`, start 0, length 4 beats;
4. `AddNote` pitch 60, velocity 100, start 0, length 1 beat;
5. `AddNote` pitch 65, velocity 90, start 0.5, length 0.5 beat.

This preview used synthetic inspection. It is not authorization for or evidence
of a Bitwig write.

## Adversarial Review

- the existing multi-tool proposal guard was not removed or relaxed;
- `parallel_tool_calls: false` is an instruction, not a trust boundary; returned
  call arrays remain strictly parsed and guarded;
- no model-visible write tool was introduced;
- the Gateway proof wired `authenticate` and `mutate` to fail and observed zero
  calls to either method;
- no provider or bridge secret entered output or browser state;
- no retry, confirmation, execution, controller change, or DAW mutation ran;
- the failed tempo capture is retained as negative evidence rather than being
  reported as constraint compliance.

## Evidence Boundary

Bitwig Studio was not running, no matching process was detected, and TCP
`127.0.0.1:8888` returned connection refused. Real controller health,
`target.inspect`, real Bitwig snapshot delivery to Qwen, physical audio,
confirmation, execution, and readback are unproven.

The repository contains the Gateway, provider, protocol client, adapter,
compiler, preview, confirmation, execution, and readback pieces, but no packaged
runtime currently composes the RTX provider and Bitwig adapter. The successful
composition was an ephemeral validation harness only.

## Git

The branch is local, uncommitted, and unpublished. Commit, push, PR, merge,
deployment, and branch deletion remain separate human gates.

## Next Activation Signal

Bitwig is running in a disposable project, Beat Twin Controller is enabled, and
one empty launcher slot is explicitly selected. A successor read-only loop may
then add or run the smallest production composition, prove real inspection and
show the exact preview. It must stop before the first write for separate human
confirmation.
