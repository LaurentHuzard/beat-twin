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

The example also declares the generic MCP metadata field:

```json
{
  "requiredProcesses": ["BitwigStudio"]
}
```

Dependency-aware clients such as TwinPilot can inspect this process name before
spawning the configured MCP server and render `process_not_running` with a safe
repair hint. The client does not need a Beat Twin path or Bitwig-specific code.
Generic MCP clients may ignore the field. Removing it keeps MCP startup
independent from Bitwig, while `pnpm smoke:read-only` remains the structured,
layered status command for explicit diagnostics.

This metadata contains no command secret and does not enable any write policy.
Do not put `BITWIG_MCP_WRITE_POLICY` or `BITWIG_MCP_ENABLE_WRITES` in a shared
preset.

Beat Twin is read-only by default. Do not add `BITWIG_MCP_WRITE_POLICY` or
`BITWIG_MCP_ENABLE_WRITES` unless you are working in a disposable Bitwig project.

To expose every implemented write tool for an explicit local test:

```bash
codex mcp remove beat-twin
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 --env BITWIG_MCP_ENABLE_WRITES=1 -- node /absolute/path/to/beat-twin/index.js
```

To expose only application-level track creation:

```bash
codex mcp remove beat-twin
codex mcp add beat-twin --env BITWIG_HOST=127.0.0.1 --env BITWIG_PORT=8888 --env BITWIG_MCP_WRITE_POLICY=application_write -- node /absolute/path/to/beat-twin/index.js
```

MCP clients may cache the server process and the `listTools` response. After
changing these environment variables, restart the MCP client session before
expecting newly enabled tools to appear.

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

For a shorter agent-friendly live check, run:

```bash
pnpm smoke:read-only
```

This first checks TCP connectivity, then runs a read-only session inspection.
It exits `0` when the bridge is reachable and the inspection reports
`scope: "read-only"`. It exits `2` when Bitwig/controller setup is incomplete.

You can also run a direct read-only inspection from the repository:

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
- `pnpm smoke:read-only` fails in `tcp-connectivity`: fix the Bitwig controller
  setup before debugging MCP tool calls.
- `pnpm smoke:read-only` reaches `read-only-inspection` but reports
  `read_errors`: the bridge is alive, but one or more read surfaces failed.
- `EPERM` from a sandboxed command: retry the socket check outside the sandbox.
- Controller not visible in Bitwig: verify the controller file path, then
  restart Bitwig.
- Mutating tools are missing: expected in default read-only mode, or after a
  policy change if the MCP client has not been restarted.
