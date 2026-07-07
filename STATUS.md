# Beat Twin Status

## Current State

Beat Twin is a local Bitwig Studio + MCP proof of concept.

The repository has been renamed and cleaned for public open-source release under:

```text
git@github.com:LaurentHuzard/beat-twin.git
```

## Working Surfaces

- MCP server entrypoint: `index.js`
- Bitwig controller script: `bitwig-controller/BeatTwin/BeatTwin.control.js`
- Offline tests: `tests/*.test.js`
- Manual live checklist: `docs/BITWIG_MANUAL_SMOKE_CHECKLIST.md`
- Bitwig API reference: `bitwig-api-docs/`

## Verification Baseline

Offline validation should pass without Bitwig Studio:

```bash
pnpm test
node --check index.js
```

Manual live validation still requires Bitwig Studio, the Beat Twin controller, and a disposable project.

## Open Risks

- Runtime behavior depends on Bitwig Studio and local controller-script installation.
- Write tools can change DAW state and must remain explicitly policy-gated.
- This is still an experimental integration, not a mature product.
