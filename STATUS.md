# Beat Twin Status

## Current State

Beat Twin is a public-ready proof of concept for bridging Bitwig Studio with the Model Context Protocol.

The repository currently contains:

- a Node.js MCP server entrypoint in `index.js`;
- a Bitwig controller script under `bitwig-controller/BeatTwin/`;
- a local TCP bridge between the MCP server and Bitwig;
- protocol smoke tests under `tests/`;
- public documentation for setup, roadmap, and agent-assisted workflow notes.

## Verification Baseline

Automated protocol smoke tests can be run with:

```bash
npm test
```

Full runtime verification still requires a local Bitwig Studio installation with the Beat Twin controller script enabled.

Suggested manual checks:

1. Install dependencies with `npm install`.
2. Start the MCP server with `node index.js`.
3. Enable the Beat Twin controller script in Bitwig Studio.
4. Verify transport controls and selected-track status through an MCP client.

## Current Risks

- Runtime behavior depends on Bitwig Studio and local controller-script installation.
- The MCP tool surface should stay conservative until permission boundaries are stronger.
- Device, clip, and arrangement workflows are intentionally out of scope for the current baseline.

## Public Release Posture

This repository is suitable to read as a technical showcase and proof of concept.

It should not be presented as a finished product or production-hardened Bitwig integration yet.
