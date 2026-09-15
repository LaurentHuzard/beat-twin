# MCP tool discovery and dispatch

Issue #69 adds an opt-in discovery surface to the **historical Bitwig MCP**
entrypoint, `index.js`. This first slice does not add wrappers to NanoDAW MCP
or change the three model-visible provider tools.

## Local policy and tool diagnostic

Before testing a live connection, inspect the configuration offline:

```sh
pnpm diagnose:tools
pnpm diagnose:tools --json
pnpm diagnose:tools --tool application_create_instrument_track
# Equivalent without invoking pnpm or building workspace packages:
node scripts/mcp-tools-diagnostic.js --json
```

The command reads the canonical `TOOL_SPECS` / `getToolDefinitions` metadata.
It lists effective enabled/disabled policies and every exposed tool name,
including the optional wrappers when enabled. It never starts an MCP server,
calls a tool, contacts the DAW/provider, or reads an MCP client's configuration.
It does not print raw environment values, endpoints, paths or tokens. An unknown
input name is deliberately not echoed, in case a secret was pasted accidentally.

**These are the diagnostic process's policies, not proof of the environment of
an already-running MCP server.** Use the same checkout/version and the same MCP
launch environment when comparing. A shell variable not exported to the server,
a different configured executable, and a stale client list can all cause a
mismatch. Local policy-enabled status does not establish human authorization.

These POSIX examples inspect three profiles in short-lived diagnostic processes
only; they do not change the current shell or any running server:

```sh
# Read-only, even if the shell normally permits writes or discovery.
env -u BITWIG_MCP_ENABLE_WRITES -u BITWIG_MCP_WRITE_POLICY -u BITWIG_MCP_TOOL_DISCOVERY node scripts/mcp-tools-diagnostic.js --json
# Track-creation policy only, never an actual track creation.
env -u BITWIG_MCP_ENABLE_WRITES BITWIG_MCP_WRITE_POLICY=application_write node scripts/mcp-tools-diagnostic.js --tool application_create_instrument_track
# All write classes: metadata only, no tool call.
BITWIG_MCP_ENABLE_WRITES=1 node scripts/mcp-tools-diagnostic.js --json
```

### Interpret results without weakening permissions

| Targeted status | Meaning and next step |
| --- | --- |
| `unknown_tool` | Not in this Bitwig registry version. Check spelling/version and whether the target is NanoDAW rather than Bitwig. |
| `policy_blocked` | Known tool hidden by the effective write policy. A reload alone cannot enable it; do not broaden permissions without explicit human authorization. |
| `tool_unavailable` | Known optional discovery wrapper disabled. The exact `BITWIG_MCP_TOOL_DISCOVERY=1` option enables wrappers, not writes. |
| `exposed` | Present in this process's policy-filtered list. Missing in the client? Check its executable and environment, restart the MCP server, then reload the client tool list/session. |

The JSON explicitly reports `dawConnection: "not_contacted"` and
`clientToolCache: "not_inspected"`. It cannot positively diagnose a stale remote
client cache. Do not treat missing client tools as proof that the tool is absent
from the repository, and never replay an uncertain write as a diagnostic.

Existing MCP error compatibility is preserved: `call_tool` uses `unknown_tool`
for unknown targets, while a legacy direct unknown-name call uses
`tool_call_failed` with an `Unknown tool` message. Policy denial remains
`policy_blocked`. Use this local diagnostic to classify the name independently
of those historical response envelopes; no new MCP permission is introduced.

Exit codes are `0` for a successful listing or an exposed target, `1` for an
unknown/blocked/unavailable target, and `2` for invalid CLI arguments or a local
registry-load failure. `--json` keeps errors machine-readable on stdout;
text-mode usage/load errors go to stderr. Names are bounded to 128 ASCII letters,
digits or underscores, beginning with a letter or underscore. `--help` describes
the command without loading the registry.

Run the focused offline tests with:

```sh
node --test tests/mcp-tools-diagnostic*.test.js tests/policy-gate.test.js
```

The CLI integration test forbids socket connections/listeners and other common
network entrypoints in its subprocesses, including in all-writes metadata mode.
The normal `pnpm test` and `pnpm test:unit` suites include both diagnostic files.
This is configuration evidence, not a live Bitwig or client-cache acceptance test.

## Enable

Start the Bitwig MCP process with:

```sh
BITWIG_MCP_TOOL_DISCOVERY=1 node /absolute/path/to/beat-twin/index.js
```

Set that environment variable in the MCP client's server configuration, then
restart/reload that server and refresh its tool list. Only the exact value
`1` enables this surface. The option does **not** enable any write policy.
Pairing or restarting a NanoDAW Gateway does not enable these Bitwig wrappers.

Default MCP listing and the historical 57-tool registry remain unchanged.
With discovery enabled, the policy-filtered direct tool list gains two tools:
`search_tools` and `call_tool`. Direct calls remain available.

## Search

MCP tool name: `search_tools`. Example arguments:

```json
{ "query": "transport tempo", "limit": 10, "offset": 0 }
```

Optional arguments:

- `query`: at most 200 characters; empty means browse the permitted catalog.
- `limit`: integer from 1 to 20, default 10.
- `offset`: integer from 0 to 10000, default 0.

Search is case-insensitive, literal, and requires every whitespace-separated
term to occur somewhere in the name, description or policy. It does not use
regular expressions, embeddings or a provider.

The JSON text result contains `tools`, `total`, and `nextOffset` (null at the
end). Each match contains its canonical name, description, inputSchema and
policy, in registry order. Generic wrappers are excluded from the results.
No definitions for currently disabled write policies are returned.

Availability here means **policy-enabled**, not proof that Bitwig is running or
the controller is ready. Search performs no DAW request. Paging reflects the
current policy on every request; restart paging if the policy changes.

## Call

MCP tool name: `call_tool`. Example arguments:

```json
{ "name": "transport_get_tempo", "arguments": {} }
```

`name` is required (1–128 characters). `arguments` is an optional object and
defaults to `{}`. Unknown wrapper fields are rejected, including attempted
`env`, `policy`, `method` or authentication overrides. The complete wrapper
arguments are limited to 65536 UTF-8 JSON bytes.

The target must belong to the existing Bitwig registry. The wrapper validates
its arguments against that tool's existing inputSchema, without coercing types,
then delegates to the existing dispatcher. Target schemas and controller-side
musical bounds are not replaced or expanded by discovery. Properties allowed
by a target schema remain allowed; wrapper fields cannot alter authorization.

Current write policy is checked again at dispatch. Existing
`requiresAuthentication` behavior and controller checks still apply.
Enabling discovery does not grant human approval. Explicit write authorization
and setup remain governed by [AGENT_SETUP.md](AGENT_SETUP.md).

Results are the exact MCP result of the target, without a second envelope.
An error remains `isError: true` with JSON text. Wrapper errors use
`tool_unavailable`, `invalid_arguments`, `unknown_tool` or
`recursive_tool_call`; policy denial retains `policy_blocked`.
Target execution failures retain `tool_call_failed`. No automatic retry occurs.

Both `call_tool -> call_tool` and `call_tool -> search_tools` are rejected.
Arbitrary RPC methods, external server names, NanoDAW confirmation/execution and
provider tools are not dispatch targets.

The generic caller is conservatively annotated as potentially destructive,
non-idempotent and not read-only, even when the active policy permits only reads.
MCP annotations are hints for clients, not authorization checks.

## Evidence

`tests/tool-registry.test.js` covers default metadata compatibility, opt-in
listing, filtered/paged discovery, input bounds, recursion and policy bypass
attempts, schema validation, direct-call parity and in-memory MCP transport.
All DAW calls are injected fakes; these tests prove neither a live connection
nor an authorized real Bitwig write.
