# MCP tool discovery and dispatch

Issue #69 adds an opt-in discovery surface to the **historical Bitwig MCP**
entrypoint, `index.js`. This first slice does not add wrappers to NanoDAW MCP
or change the three model-visible provider tools.

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
