# BT-MCP-DIAGNOSTICS: local policy and tool-list diagnostics (#1)

User authorized implementation of issue #1 on 2026-09-15.
Branch: fix/mcp-policy-diagnostics-issue-1, created from current main.
The GitHub open-pulls endpoint returned no open PR before this branch was created.

## Orbit Ready

BT-MCP-DIAGNOSTICS is the sole authorized implementation item for this branch.
Deliver local Bitwig MCP diagnostics and distinguish unknown tools, policy-hidden
tools and a supplied client-tool-list mismatch. Reuse the registry from #69/#71.
No NanoDAW/model tool additions, permission widening, runtime activation or DAW
writes are authorized. The previous connection-settings plan is retained in Git.

## Plan

1. Inspect the canonical TypeScript bridge, generated entrypoint, policies,
   discovery wrappers, tests, setup guide and current queue.
2. Add a dependency-free, offline diagnostic with effective policies, exposed
   tool names and optional bounded comparison with a supplied client tool list.
   Never print secrets, raw environment values or arbitrary input names.
3. Align direct/generic unknown-tool errors and add actionable reload guidance
   without changing the existing policy/validation/authentication boundaries.
4. Cover read-only, application_write and all-writes with offline tests and
   forbidden-network/fake-call guards. Distinguish evidence from assumptions:
   a mismatch suggests stale cache/process or a different environment/version;
   a local diagnostic cannot inspect the active MCP client's cache by itself.
5. Document safe setup, client/server restart boundaries and no automatic replay
   after uncertain mutation. Regenerate index.js from index.ts.
6. Run the available focused/non-regression checks and git diff --check, review
   safety, record exact results/limitations and open one PR. Do not merge.

## Validation environment

The local container provides Node 22.16.0, whereas the workspace requires Node 26.
A direct clone failed because github.com could not be resolved. Source access and
branch publication use the authorized GitHub connector. Full workspace/SDK checks
must not be reported as executed unless dependencies and the required runtime
are actually available. No live Bitwig, MCP client, gateway or provider proof is
claimed by this offline implementation.
