# Agent Setup Guide

This guide is for coding agents setting up Beat Twin on a user's workstation.

The agent may install files, configure the MCP client, and run read-only
validation commands. The agent must not pretend to operate the Bitwig UI unless
it has an explicit UI automation capability and user approval.

## What The Agent Can Do

From the repository root, the agent can:

1. Install Node dependencies:

```bash
pnpm install
```

2. Register the MCP server for Codex in read-only mode:

```bash
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 -- node /absolute/path/to/beat-twin/index.js
```

3. Copy the Bitwig controller script into the likely controller directory:

```bash
mkdir -p "$HOME/Bitwig Studio/Controller Scripts/BeatTwin"
cp bitwig-controller/BeatTwin/BeatTwin.control.js "$HOME/Bitwig Studio/Controller Scripts/BeatTwin/BeatTwin.control.js"
```

If that directory does not exist, check these common locations:

```text
~/Bitwig Studio/Controller Scripts/
~/Documents/Bitwig Studio/Controller Scripts/
%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\
```

4. Check whether Bitwig is running and whether the controller bridge is
   listening:

```bash
nc -vz 127.0.0.1 8888
```

5. Run the short read-only smoke:

```bash
pnpm smoke:read-only
```

This returns JSON with a `tcp-connectivity` phase when the controller is not
reachable, or a compact `read-only-inspection` summary when the bridge is live.

6. Run a full read-only session inspection when deeper session detail is needed:

```bash
node --input-type=module -e "import('./index.js').then(async m => { const r = await m.inspectBitwigSession(); console.log(JSON.stringify(r, null, 2)); process.exit(r.connected ? 0 : 2); })"
```

7. Run a plan-only arrangement smoke:

```bash
node --input-type=module -e "import('./index.js').then(async m => { const r = await m.planBitwigArrangement({ goal: 'Turn the current loop into a safe arrangement outline', style: 'club', targetLengthBars: 64 }); console.log(JSON.stringify(r, null, 2)); process.exit(r.scope === 'plan-only' ? 0 : 2); })"
```

## What The Agent Must Ask The User To Do

The agent must clearly ask the user to perform this manual Bitwig step:

```text
Open Bitwig Studio, go to the controller settings, and add or enable:

Beat Twin -> Beat Twin
```

If Bitwig was already open when the controller file was copied, ask the user to
restart Bitwig or reload the controller settings before testing again.

The expected result after the user completes the manual step:

```text
Connection to 127.0.0.1 8888 port [tcp/*] succeeded!
```

## Safety Boundary

Default setup is read-only. Do not enable these environment variables during
setup:

```bash
BITWIG_MCP_WRITE_POLICY=...
BITWIG_MCP_ENABLE_WRITES=1
```

Only enable write policies after the user explicitly asks for write testing and
confirms they are using a disposable Bitwig project or a copy of real work.

## Enabling Write Tools

Beat Twin hides write tools from MCP `listTools` until the server process starts
with an explicit write policy. If an agent cannot see tools such as
`application_create_instrument_track`, the MCP client is probably still running
the default read-only server.

To expose every currently implemented write tool for an explicit write test:

```bash
codex mcp remove beat-twin
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 --env BITWIG_MCP_ENABLE_WRITES=1 -- node /absolute/path/to/beat-twin/index.js
```

To expose only track-creation tools:

```bash
codex mcp remove beat-twin
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 --env BITWIG_MCP_WRITE_POLICY=application_write -- node /absolute/path/to/beat-twin/index.js
```

After changing MCP environment variables, restart or reload the MCP client
session. Some clients keep the old MCP server and tool list in memory; in that
case, the updated tools will not appear until a new session starts.

Before calling any write tool, tell the user which write policy is active and
which Bitwig action will be attempted.

## Success Criteria

Setup is complete when:

- the MCP client lists `beat-twin`;
- `127.0.0.1:8888` accepts TCP connections;
- `inspectBitwigSession()` returns `connected: true`;
- `inspectBitwigSession()` returns `scope: read-only`;
- read errors are either absent or explicitly reported;
- no Bitwig transport, clip, scene, mixer, or device mutation occurred.

If the port check returns `Connection refused`, the controller file may be
installed but Bitwig has not loaded the controller instance. Ask the user to add
or enable `Beat Twin -> Beat Twin` in Bitwig.
