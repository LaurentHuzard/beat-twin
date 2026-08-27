# Active Beat Twin Orbit

## Loop

`BT-RTX-003` is complete and validated on
`agent/bt-rtx-001-qwen-tool-loop`, continuing BT-RTX-001/002 from publication
base `035e82d`. The user explicitly authorized commit, push, and merge on
2026-08-27. Orbit Ready is empty.

## Target Outcome

When the user writes one explicit `N BPM` constraint, the bounded provider
requires that exact `tempoBpm` in the request-scoped `propose_song_patch` tool
schema and rejects a divergent proposal. Requests without explicit `BPM` keep
the existing optional-tempo contract.

## Product Contract

- only an explicit numeric value immediately qualified by `BPM` is extracted;
- one valid distinct value dynamically makes `tempoBpm` required and constrains
  it to that exact value in the model-facing proposal schema;
- absent explicit BPM leaves the exported tool schema and behavior unchanged;
- conflicting or out-of-range explicit BPM values fail before a model call;
- a server ignoring the schema cannot pass a divergent patch;
- the model still sees only the three bounded tools;
- no live Bitwig mutation is authorized by this loop.

## Current State

The BT-RTX-002 controller remains installed and live. Real `target.inspect`
reported project `New 2`, track `Inst 1` at position 0, scene slot 0, generation
8, `available: true`, `hasContent: false`, and `clipExists: false`.

The provider now derives one request-local proposal schema only when the user
writes an explicit numeric `BPM` value. It makes `tempoBpm` required, constrains
it with an exact enum, and verifies the validated patch against the same value.
The exported generic schema remains unchanged.

Live composition also exposed concurrent `health()` and `inspect()` controller
reads. The adapter now shares only the in-flight read observation; no mutation
or mutation retry behavior changed.

## Verification

- focused provider and adapter builds/tests passed;
- `pnpm test`: 191 passed, 0 failed when rerun with loopback access;
- `pnpm typecheck`: passed;
- controller syntax and `git diff --check`: passed;
- live Gateway-to-Bitwig-to-Qwen run: HTTP 201, two model steps, exact 132 BPM,
  and zero authentication or mutation calls.

All local commands ran on Node 26.4.0 with the known unsupported-engine warning;
the supported Node range remains unchanged.

## Human Gates

- The user explicitly supplied `Orbit Ready BT-RTX-003` on 2026-08-27.
- The user explicitly authorized commit, push, and merge on 2026-08-27.
- No Bitwig authentication, confirmation, execution, deployment, or branch
  deletion was authorized or performed.

## Exit Condition

The exit condition is met. The real target was project `New 2`, track `Inst 1`
at position 0, scene slot 0, generation 8. The final preview contained exact
132 BPM, one four-beat clip, and three notes. `inspect_session` was alone in
step 1 and `propose_song_patch` alone in step 2. No write occurred.

## Next Activation Signal

Any first live write requires a fresh plan because the captured proof plan was
ephemeral and has expired, followed by separate human confirmation. No write is
authorized by this completed loop.
