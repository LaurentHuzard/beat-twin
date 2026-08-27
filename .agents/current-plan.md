# Active Beat Twin Orbit

## Loop

`BT-213A` is complete locally on `agent/bt-213a-rtx-bitwig-runtime` from
merged `main` at `2edf207`. Orbit Ready is empty.

## Target Outcome

Add the smallest supported local runtime that composes the existing loopback
Gateway, OpenAI-compatible LiteRT provider, and bounded Bitwig adapter so an
operator can run health, real session inspection, Qwen proposal generation,
compilation, and preview without an ephemeral harness.

## Product Contract

- listen only on an explicit loopback host;
- use the existing provider, Gateway, plan store, compiler, and Bitwig adapter;
- expose only `list_daw_targets`, `inspect_session`, and `propose_song_patch` to
  the model;
- keep confirmation and execution outside the model;
- omit plan status, confirmation, and execution routes in this runtime;
- make the Bitwig transport itself incapable of authentication or mutation;
- validate configuration without starting Bitwig or llama.cpp;
- never print operator or Bitwig bridge secrets;
- preserve the historical MCP path and NanoDAW browser ownership unchanged.

## Current State

The repository now provides `pnpm gateway:rtx-bitwig-preview` for the supported
daemon and `pnpm smoke:rtx-bitwig-preview` for one disposable diagnostic run.
Both compose the existing Gateway, provider, compiler, plan store, and
`BitwigAdapter`; neither can confirm or execute a plan.

The live smoke used `qwen3-8b`, the real Bitwig controller, and project `New 2`
with track position 0, scene slot 1, target generation 14, and an empty target.
Qwen completed two model steps and returned a valid 132 BPM patch. Beat Twin
materialized four commands and an immutable preview. No authentication or
mutation call occurred, and the target remained empty.

## Verification

- focused Gateway suite: 15 passed, 0 failed;
- `pnpm test`: 195 passed, 0 failed;
- `pnpm typecheck`: passed;
- `pnpm smoke:packages`: passed;
- JavaScript/controller syntax checks: passed;
- `git diff --check`: passed;
- live RTX `/v1/models`: `qwen3-8b`, passed after starting the existing remote
  llama.cpp command;
- live Bitwig controller inspection: passed;
- live Gateway-to-Qwen-to-Bitwig preview: passed;
- live Bitwig write: not attempted and unavailable in this runtime.

All local commands ran on Node 26.4.0 with the known unsupported-engine warning;
the supported Node range remains unchanged.

## Human Gates

- The user explicitly activated `BT-213A` on 2026-08-27.
- The user authorized starting the existing llama.cpp setup through the `rtx`
  SSH target.
- The user explicitly selected a new empty Bitwig slot for the read-only proof.
- No live DAW write, commit, push, PR, merge, deployment, remote server stop, or
  branch deletion was authorized or performed.

## Exit Condition

The supported loopback runtime starts from a repository command, deterministic
evidence proves its preview-only boundary, and live RTX plus Bitwig evidence
reached an exact immutable preview without exposing or invoking a write path.

## Next Activation Signal

`BT-213B` may prove one portable patch through separately previewed and
confirmed NanoDAW and Bitwig plans. It requires a new Orbit Ready activation;
any Bitwig write additionally requires a fresh exact preview and confirmation.
