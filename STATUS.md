# Beat Twin Status

## Current State

Beat Twin is a local Bitwig Studio + MCP proof of concept with a browser NanoDAW
for command-driven song sketches.

The repository has been renamed and cleaned for public open-source release under:

```text
git@github.com:LaurentHuzard/beat-twin.git
```

## Working Surfaces

- MCP server entrypoint: `index.js`
- Bitwig controller script: `bitwig-controller/BeatTwin/BeatTwin.control.js`
- Browser NanoDAW: `apps/playground`
- Standalone NanoDAW MCP planning server: `packages/mcp`
- NanoDAW-only model runtime: `pnpm nanodaw:agent` (explicit provider, SongPatchV2)
- TWIN automatically discovers pending MCP proposals; review and confirmation remain human actions.
- Pure runtime packages: `packages/core`, `packages/commands`, `packages/audio-tone`, `packages/daw-contract`, `packages/agent-contract`
- Transactional NanoDAW adapter: `packages/adapters/nanodaw`
- LiteRT-LM provider and bounded model loop: `packages/litert-provider`
- Pairing, plan, confirmation, quota, policy, and audit core: `packages/gateway-core`
- Loopback-only paired Agent HTTP API: `apps/gateway`
- Node 22/24 CI and compiled package smoke: `.github/workflows/ci.yml`
- Offline tests: `tests/*.test.js`
- Read-only live smoke: `pnpm smoke:read-only`
- Manual live checklist: `docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md`
- Bitwig API placeholder note: `bitwig-api-docs/README.md`

## Verification Baseline

Offline validation should pass without Bitwig Studio:

```bash
pnpm test
node --check index.js
pnpm test:playground
```

Read-only live validation can start with `pnpm smoke:read-only`. Manual write
validation still requires Bitwig Studio, the Beat Twin controller, and a
disposable project.

The calm NanoDAW first run and its focus-recovery follow-up are on `main`
through PR #55 (`9944ff8`) and PR #56 (`2a59406`). BT-UX-002 is also complete
on `main` through PR #58 (`a3dba85`): voluntary inline shortcut help closes
with Escape and Inspector density changes without stopping active preview
state. Deterministic browser proof and exact-head CI cover desktop and
390-pixel mobile interaction without claiming live Bitwig, Gateway, MCP, S25,
device audio, or subjective listening evidence.

## Open Risks

- The Bitwig surfaces depend on Bitwig Studio and local controller installation; NanoDAW does not.
- Write tools can change DAW state and must remain explicitly policy-gated.
- This is still an experimental integration, not a mature product.
- Natural-language runs depend on the explicitly configured provider (native llama.cpp/MUE or another compatible server); MCP-only planning does not.
- The authenticated browser proxy and bounded Bitwig bridge are implemented. This NanoDAW-only slice does not establish new live provider or Bitwig evidence.
- MCP inbox discovery is bounded and process-local. Global retention, restart recovery, richer variations/slot placement and listening acceptance remain follow-ups.
