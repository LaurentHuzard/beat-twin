# Beat Twin Status

## Current State

Restored locally after reformat and renamed from the previous `llm2Bitwig` checkout to `beat-twin`.

The local repository is ready to push to:

```text
git@github.com:LaurentHuzard/beat-twin.git
```

That GitHub repository does not exist yet at the time of this status note.

## Working Surfaces

- MCP server entrypoint: `index.js`
- Bitwig controller script: `bitwig-controller/BitwigPOC`
- API reference: `bitwig-api-docs/`
- Agent workflow notes: `agents-team/`

## Verification Baseline

No full runtime verification has been run after restore because Bitwig Studio integration requires the local DAW/controller environment.

Recommended first checks after dependency install:

```bash
npm install
node index.js
```

Then enable the Bitwig controller script from Bitwig and verify transport read/write operations manually.

## Open Risks

- GitHub repo `LaurentHuzard/beat-twin` still needs to be created.
- Runtime behavior depends on Bitwig Studio and local controller script installation.
- Current README still reflects the proof-of-concept posture and should be expanded before claiming product maturity.
