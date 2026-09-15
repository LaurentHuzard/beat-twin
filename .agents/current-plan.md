# BT-MCP-DIAGNOSTICS: local policy and tool-list diagnostics (#1)

User authorized implementation of issue #1 on 2026-09-15.
Branch: fix/mcp-policy-diagnostics-issue-1, created from main at
9b0cc64b7863e68e6824f2763fe54d79e126cf93.
The GitHub open-pulls endpoint returned no open PR before this branch was created.

## Orbit Ready

BT-MCP-DIAGNOSTICS is the sole authorized implementation item for this branch.
Implementation is complete for review, not merged. No new item is activated.
No NanoDAW/model tool additions, permission widening, runtime activation or DAW
writes are authorized. Previous plans and their historical evidence remain in Git.

## Completed plan

1. Inspected the shared TypeScript registry, generated entrypoint, policies,
   discovery wrappers, setup guide, existing tests and queue.
2. Added an offline diagnostic of effective policies/exposed names and bounded
   comparison with a supplied complete client tool list; no secrets or DAW calls.
3. Aligned direct unknown-tool errors with generic dispatch, preserving existing
   policy-blocked, validation and authentication boundaries.
4. Added 25 diagnostic tests; combined focused suite passes 34/34, including the
   nine existing policy tests. The new suite failed 21/25 before implementation.
5. Documented configuration versus live state, precise reload boundaries and no
   automatic replay. Regenerated index.js and checked syntax and local diffs.
6. Publish one PR for review; merge and supported-environment checks are separate.

## Evidence and limitations

Report: .agents/reports/feature-20260915-mcp-diagnostics.md.
The container has Node 22.16.0, not the required Node 26, and no project dependencies
or pnpm. DNS prevented cloning; authorized connector reads/writes and a verified
partial local reconstruction were used. Full workspace/SDK checks and live client
reload are not claimed. No Bitwig, MCP client, gateway, browser/audio or provider
was activated, and no real write, merge, deployment or branch deletion occurred.
