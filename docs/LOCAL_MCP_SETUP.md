# Local MCP Setup

This note describes the expected local setup for using Beat Twin from an MCP
client against a running Bitwig Studio instance.

Coding agents should also read [`AGENT_SETUP.md`](AGENT_SETUP.md), which
separates automated setup steps from the manual Bitwig UI step that must be
requested from the user.

## 1. Install Dependencies

```bash
pnpm install
```

## 2. Register The MCP Server

For Codex:

```bash
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 -- node /absolute/path/to/beat-twin/index.js
```

For generic MCP clients, adapt [`../llm-mcp/mcp.example.json`](../llm-mcp/mcp.example.json)
and keep local secrets or machine-specific paths in an untracked file such as
`llm-mcp/mcp.json`.

Beat Twin is read-only by default. Do not add `BITWIG_MCP_WRITE_POLICY` unless
you are working in a disposable Bitwig project.

## 3. Install The Bitwig Controller

Copy the controller folder into Bitwig's controller scripts directory.

On Linux, Bitwig commonly uses:

```text
~/Bitwig Studio/Controller Scripts/
```

The expected installed file is:

```text
~/Bitwig Studio/Controller Scripts/BeatTwin/BeatTwin.control.js
```

On other machines, common locations are:

```text
~/Bitwig Studio/Controller Scripts/
~/Documents/Bitwig Studio/Controller Scripts/
%USERPROFILE%\Documents\Bitwig Studio\Controller Scripts\
```

## 4. Activate The Controller In Bitwig

If Bitwig was already open when the file was copied, restart Bitwig or open the
controller settings and add the controller manually:

```text
Beat Twin -> Beat Twin
```

The controller must be enabled before the MCP server can connect. Installing the
file is not enough: Bitwig only opens the TCP bridge after it loads the
controller instance.

## 5. Verify The Bridge

Check whether the controller is listening:

```bash
nc -vz 127.0.0.1 8888
```

Expected result after the controller is active:

```text
Connection to 127.0.0.1 8888 port [tcp/*] succeeded!
```

Then run a read-only inspection from the repository:

```bash
node --input-type=module -e "import('./index.js').then(async m => { const r = await m.inspectBitwigSession(); console.log(JSON.stringify(r, null, 2)); process.exit(r.connected ? 0 : 2); })"
```

Expected result:

```json
{
  "connected": true,
  "scope": "read-only"
}
```

The real response includes transport, tracks, scenes, selected device, and
read-error details when Bitwig only returns a partial snapshot.

## Troubleshooting

- `ECONNREFUSED` or `Connection refused`: Bitwig is running, but the Beat Twin
  controller is not loaded or not enabled.
- `EPERM` from a sandboxed command: retry the socket check outside the sandbox.
- Controller not visible in Bitwig: verify the controller file path, then
  restart Bitwig.
- Mutating tools are missing: expected in default read-only mode.
