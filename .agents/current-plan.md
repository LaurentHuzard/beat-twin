# BT-MCP-DIAGNOSTIC: offline policy and tool diagnostics

User explicitly authorized selecting an issue, verifying it, implementing on a
dedicated branch and opening a PR on 2026-09-15.
Base: 9b0cc64b7863e68e6824f2763fe54d79e126cf93 (PR #75 merged).
Branch: agent/mcp-policy-diagnostics-issue-1. Issue: #1.
No open implementation PR was returned at selection.

## Orbit Ready

BT-MCP-DIAGNOSTIC (#1) is the sole authorized implementation item for this branch.
The previous connection-settings item is merged as PR #75; PR #73 is also merged.
Their prior plans and evidence remain available at the base commit above.
No live workflow or previous write authorization is reactivated.

## Verified need

The canonical Bitwig registry already supports policy-filtered definitions and
opt-in search/call wrappers (#71). The missing piece is a compact local diagnostic.
Reuse TOOL_SPECS and getToolDefinitions without a second policy parser. Keep the
historical MCP schemas, dispatch payloads, authentication and write gates intact.

## Plan

1. Record the bounded authorization and align the queue's Orbit Ready section.
2. Add a local diagnostic CLI with text/JSON output and bounded optional tool name.
3. Distinguish unknown, policy-blocked, discovery-disabled and exposed tools.
   Report the client cache and DAW connection as uninspected, not stale or ready.
4. Add unit and canonical-registry/CLI integration tests, including no network,
   no secret output, default read-only, application_write and all-writes modes.
5. Update the agent/discovery guide, package scripts and packaged-file manifest.
6. Run available local checks, inspect exact-head CI where available, and perform
   an adversarial review. Record unavailable checks explicitly in the loop report.
7. Open one PR and stop at human review. Do not merge or deploy.

## Boundaries

No DAW/provider connection, permission change, model use, runtime startup,
credential inspection, musical write, dependency upgrade or unrelated refactor.
A diagnostic subprocess may inspect synthetic policy configuration but may never
call a tool. Actual client-cache state cannot be read from this local process.
Unknown arguments and module-load errors must not leak caller input or secrets.

## Validation environment

The local container has Node 22.16.0 and TypeScript 5.8.3, not the required Node 26.
Direct repository cloning and dependency downloads fail DNS resolution. GitHub
reads/writes use the authorized connector. Dependency-free checks can run locally;
the repository's existing PR CI targets Node 26 and the full offline suites.
No live evidence will be claimed from either path.
