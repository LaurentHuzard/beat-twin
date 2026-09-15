# Local Bitwig MCP diagnostics

Run this before a network smoke when tools appear to be missing:

```bash
pnpm diagnose:mcp
node scripts/mcp-diagnostics.js --json
```

This dependency-free command uses the same registry, write-policy parser and
`getToolDefinitions()` as Bitwig MCP `tools/list`. It does not start an MCP
server, import the MCP SDK, connect to Bitwig, call a provider, inspect musical
state or execute any tool. `daw_checked` is always `false`. Availability here
means **exposed by this process's configuration**, not connected or authorized
by a human for a musical action.

The compact report contains effective enabled/disabled policies, the effective
mode, discovery status and every exposed tool name (without schemas). It omits
raw environment values, host/port, credentials and arbitrary supplied names.
Unknown policy entries remain ignored under the existing parser; they do not
become permissions. Generic discovery remains opt-in with
`BITWIG_MCP_TOOL_DISCOVERY=1` and adds two tools without enabling writes.

## Inspect the three configurations safely

These inline variables affect only the diagnostic process. They do **not**
change an existing MCP server or authorize a DAW write. Clearing unrelated flags
makes the examples independent of inherited write/discovery settings:

```bash
# Read-only: 14 tools
BITWIG_MCP_ENABLE_WRITES=0 BITWIG_MCP_WRITE_POLICY= BITWIG_MCP_TOOL_DISCOVERY=0 node scripts/mcp-diagnostics.js

# Read + application_write: 16 tools (the two track-creation tools are added)
BITWIG_MCP_ENABLE_WRITES=0 BITWIG_MCP_WRITE_POLICY=application_write BITWIG_MCP_TOOL_DISCOVERY=0 node scripts/mcp-diagnostics.js

# All six existing write policies + read: 57 tools
BITWIG_MCP_ENABLE_WRITES=1 BITWIG_MCP_WRITE_POLICY= BITWIG_MCP_TOOL_DISCOVERY=0 node scripts/mcp-diagnostics.js
```

With discovery explicitly enabled, those counts become 16, 18 and 59. These
counts describe the current registry, not a separate hardcoded catalog.
`BITWIG_MCP_ENABLE_WRITES` takes precedence over selective policies when enabled.
The report's `all-writes` mode describes the effective policy set, including
when every policy was individually selected.

## Compare the actual client's list

Export the complete raw `tools/list` result from the **Bitwig** MCP server in
the client, or copy its raw, unprefixed tool names into a JSON array. Do not
substitute the NanoDAW catalog or generate the file from the diagnostic itself.
Collect every page before comparing. A result containing `nextCursor` is
rejected as incomplete rather than misreported as stale.

```bash
# Use the same checkout/version and environment as the intended MCP server.
node scripts/mcp-diagnostics.js --json --client-tools ./client-tools.json
```

Accepted formats are `{"tools":[{"name":"transport_get_tempo"}, ...]}` and
`["transport_get_tempo", ...]` (replace the ellipses with the full list).
Descriptions, schemas and other result metadata are ignored. Input must be a
regular JSON file, at most 65,536 bytes, containing at most 512 names of at most
128 characters each, without control characters. Names are case-sensitive;
order and duplicates do not affect comparison.

`client_tool_list.status` is `not_checked` without a file, `matches` when the
supplied names match, or `mismatch` with `error: tool_list_mismatch`. A mismatch
lists canonical names missing from the client, known names no longer exposed,
and only a count for unrecognized names. Paths and unknown input names are not
printed. Exit codes: **0** report/match, **1** mismatch, **2** invalid input or
arguments. `--json` emits one JSON record, including errors.

A mismatch is evidence of a difference, **not proof of a stale cache**. A stale
client list, an old server process, a different environment, a different server
or a different checkout/version can explain it. This local command cannot read
a running client's cache. Matching names do not prove matching schemas, a live
connection, successful execution or human approval.

## Errors and the reload boundary

| Signal | Meaning | Safe next step |
| --- | --- | --- |
| `unknown_tool` | Name is absent from the canonical Bitwig registry, for direct calls and generic `call_tool`. | Check the raw name, server surface and checkout. Enabling writes cannot add an unknown tool. |
| `policy_blocked` | Tool exists, but its write policy is disabled. Existing `tool`, `policy` and `required_config` fields are preserved. | Read the required policy. Change configuration only after explicit approval, with a disposable project for write testing. |
| `tool_unavailable` | A generic discovery tool was called without its explicit opt-in. | Inspect `discovery_enabled`; discovery is independent of write permission. |
| `tool_list_mismatch` | The supplied client snapshot differs from the local diagnostic. This is a comparison error, not a fabricated server execution error. | Verify the same server, full list, environment and version, then reload as below. |
| `tool_call_failed` | A known tool failed during dispatch/execution (for example a connection failure). | Diagnose that failure separately; do not assume the tool is missing or blindly retry a write. |

After changing MCP environment variables or server code:

1. Restart the **MCP server process**, not just the settings editor. Existing
   processes retain their startup environment.
2. Reload the client's tool list or restart its MCP session/client if it caches
   the server or catalog. A config edit alone is not evidence of a reload.
3. Request a fresh complete `tools/list` and compare it. Do not probe exposure
   by creating a track or executing another write.
4. Before any approved write, explain the exact action and active policy and
   obtain the existing human confirmation. If an earlier mutation has an
   uncertain outcome, reconcile/read back state before another attempt; never
   automatically replay it because the client was reloaded.

See [AGENT_SETUP.md](AGENT_SETUP.md) for manual controller activation and real
read-only connectivity checks, and [MCP_TOOL_DISCOVERY.md](MCP_TOOL_DISCOVERY.md)
for generic discovery/dispatch. This diagnostic does not change NanoDAW's
browser ownership, plans, confirmations, tools or provider projections.

## Offline regression checks

```bash
node --test tests/mcp-diagnostics.test.js tests/policy-gate.test.js
# Also included in pnpm test and pnpm test:unit in the supported workspace.
```

These checks use simulated calls and local temporary files, not a live DAW.
Live client restart behavior and musical acceptance remain separate evidence.
