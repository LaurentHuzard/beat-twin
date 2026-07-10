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
- Pure runtime packages: `packages/core`, `packages/commands`, `packages/audio-tone`, `packages/daw-contract`, `packages/agent-contract`
- Transactional NanoDAW adapter: `packages/adapters/nanodaw`
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

## Open Risks

- Runtime behavior depends on Bitwig Studio and local controller-script installation.
- Write tools can change DAW state and must remain explicitly policy-gated.
- This is still an experimental integration, not a mature product.
- The S25 `tool_calls` fixture gate is not yet captured, so no provider loop or Gateway is implemented.
- The browser WebSocket proxy and authenticated Bitwig write bridge are not implemented.
