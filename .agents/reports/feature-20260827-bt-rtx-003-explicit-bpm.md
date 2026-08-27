# BT-RTX-003 — Explicit BPM Constraint and Real Preview

Date: 2026-08-27
Branch: `agent/bt-rtx-001-qwen-tool-loop`
Base: published `main` at `035e82d`
State: complete and live read-only validated; publication authorized separately by the user

## Product Outcome

An explicit numeric `N BPM` request now reaches a strict request-scoped
`propose_song_patch` schema that requires `tempoBpm` and constrains it to the
exact requested value. Requests without explicit `BPM` retain the unchanged
generic optional-tempo schema.

The real Gateway, Qwen RTX, compiler, plan store, `BitwigAdapter`, controller,
and selected empty Bitwig target produced a side-effect-free 132 BPM preview.

## Changes

- extract one distinct explicit signed numeric BPM value from the user request;
- reject conflicting, non-finite, or out-of-range explicit values before the
  model request;
- make `tempoBpm` required with an exact enum only in the request-local proposal
  tool schema;
- reject a validated patch that omits or changes the explicit value, even if a
  server ignores the schema;
- preserve the three-tool boundary and `parallel_tool_calls: false`;
- share one in-flight read observation between concurrent Bitwig adapter health
  and inspection calls, which the real Gateway performs in parallel.

## Deterministic Verification

- `pnpm --filter @beat-twin/litert-provider build`: passed;
- provider tests: passed, including exact schema, unchanged no-BPM behavior,
  mismatch/omission rejection, conflicting/out-of-range rejection, and the
  signed negative adversarial case;
- `pnpm --filter @beat-twin/bitwig-adapter build`: passed;
- adapter tests: passed, including concurrent read-only observation sharing;
- `pnpm test`: 191 passed, 0 failed with loopback access;
- `pnpm typecheck`: passed;
- controller syntax check: passed;
- `git diff --check`: passed.

Node 26.4.0 emitted the known unsupported-engine warning. The declared Node
22/24 range was not changed.

## Live RTX and Bitwig Read-only Evidence

Final request:

`Inspecte ma session Bitwig puis propose une boucle électronique minimale à 132 BPM.`

Result:

- Gateway HTTP 201;
- model `qwen3-8b`;
- step 1: one `inspect_session` call;
- step 2: one `propose_song_patch` call;
- patch `tempoBpm: 132`;
- target: project `New 2`, track `Inst 1`, track position 0, scene slot 0,
  generation 8, empty and available;
- transport before preview: 110 BPM and stopped;
- authentication calls: 0;
- mutation calls: 0.

Materialized preview commands:

1. `CreateSong`: title `Electronic Loop`, BPM 132.
2. `CreateTrack`: instrument track `Electronic Loop`.
3. `CreateClip`: `Kick-Snare Pattern`, start 0, length 4 beats.
4. `AddNote`: pitch 36, velocity 127, start 0, length 1 beat.
5. `AddNote`: pitch 48, velocity 127, start 2, length 1 beat.
6. `AddNote`: pitch 50, velocity 100, start 0.5, length 0.5 beat.

The proof plan was created in an ephemeral harness and expired after two
minutes. It is not an executable pending authorization.

## Failure Evidence and Minimal Runtime Fix

Before read coalescing, the real Gateway launched adapter `health()` and
`inspect()` concurrently. One controller inspection succeeded while the other
timed out, yielding Gateway HTTP 500 before the provider ran. With one shared
in-flight observation, the same composition reached HTTP 201. Removing that
change reproduced the timeout; restoring it restored the successful live run.

## Adversarial Review

- the model still sees only `list_daw_targets`, `inspect_session`, and
  `propose_song_patch`;
- the existing proposal-only-step guard is unchanged;
- a missing, divergent, conflicting, negative, or out-of-range explicit BPM
  cannot be silently compiled with a fallback tempo;
- no BPM is invented when the request contains no explicit `BPM` token;
- the adapter shares only reads and does not retry uncertain mutations;
- no confirmation, authentication, execution, readback-after-write, commit,
  publication, merge, deployment, or branch deletion occurred.

## Next Human Gate

Any first live Bitwig write requires a new fresh preview against the still
selected disposable target, followed by explicit human confirmation of its
exact materialized commands.
