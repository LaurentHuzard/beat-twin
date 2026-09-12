# BT-MCP-069 — bounded tool discovery and dispatch

User activated issue #69 implementation on 2026-09-12.
Base: freshly fetched origin/main at 083f949.
Branch: agent/mcp-tool-discovery. Worktree: /tmp/beat-twin-issue69.

Status: local implementation and offline verification complete; human handoff.
Evidence: .agents/reports/feature-20260912-mcp-069.md.
242 backend tests and 166 NanoDAW tests passed; final focused registry run
passed 7 tests. Builds, architecture, package smoke and packaging checks passed.
Push/PR, merge and runtime activation remain separate, unperformed gates.

## Contract and scope

First surface: historical Bitwig MCP, opt-in BITWIG_MCP_TOOL_DISCOVERY=1.
Keep the 57 TOOL_SPECS and the default list unchanged.
search_tools: query (optional, max 200 chars), limit (1–20, default 10),
offset (0–10000, default 0); return deterministic authorized definitions,
total and nextOffset. Search name/description/policy with literal terms.
call_tool: name and optional arguments object; reject extra wrapper fields,
unknown targets and recursion; validate against the target input schema, then
reuse the existing dispatch and its current policy/authentication checks.
Errors remain structured MCP tool errors. No target result is wrapped twice.

## Execution

1. Implement wrappers using the existing registry, no second tool catalog.
2. Cover discovery bounds, policy changes, malformed arguments, recursion,
   direct-call parity and real MCP in-memory transport with fake DAW calls.
3. Run focused tests, full offline baseline, typecheck/build, architecture,
   package smoke, packaging inspection and diff check; adversarial review.
4. Record evidence and return Orbit Ready to a human handoff.

NanoDAW MCP, model-visible tools, UI, provider access and live DAW writes are
outside this slice. No publication, merge or branch deletion is authorized.
