# Existing architecture refactor port — 2026-09-12

Base: main `86679ab32c5e106dac76d95829c924198e0bcdc7` (PR #67).
Branch: `finish/beat-pending`. Existing ignore commit `ca9a5a4` retained.
Scope explicitly authorized: finish PR #50/#51 locally; parent owns review,
publication, merge and closure of replaced PRs. No live provider or DAW calls.

## Source and final behavior

PR #50 audit `f6345174` and PR #51 implementation commits `9453391`, `ebb1329`,
`4a6b345`, `322d7af` supplied the existing work. The audit is reconciled with
the current implementation; its old findings remain dated historical evidence.

| Boundary | Old implementation problem | Port |
| --- | --- | --- |
| Dependency policy | Predates RTX application composition | 16 workspaces / 42 runtime edges checked; no package-to-app dependency. Two exact app-only CLI imports of the root protocol client are documented, with a negative boundary test. |
| Gateway delivery | Old extracted handler omits previewOnly restrictions and dual-target routes | Copy current main handler into gateway-http, retain compatibility exports, add the existing retention error mapping to HTTP 503. |
| NanoDAW MCP | Package owns process startup and imports an app | apps/nanodaw-mcp owns HTTP/WebSocket/MCP composition and shutdown; package keeps planning. Existing nanodaw:mcp command points to the new app. |
| Bitwig retention | Old adapter predates shared in-flight inspection and bounded readback retries | Retain both current behaviors; add bounded storage and preserve uncertainty if post-mutation observation retention fails. |
| Other retention | Unbounded process registries | Existing bounded stores for Gateway, command requests, adapters and MCP reviews; active/uncertain executions stay pinned. Browser transition IDs and cancellation bookkeeping are bounded. |

Gateway public declarations remain handwritten beside JavaScript delivery,
as in the original refactor. Consumer compilation and protocol tests cover the
boundary; this does not claim full TypeScript checking of the implementation.
The new previewOnly option is represented in the public declaration.

All operator scripts added or changed in this port use TypeScript: architecture
guard, its fixtures, package smoke, and the gateway-http build script. New
workspace engine declarations use Node 26. Lockfile regeneration preserved the
main dependency resolutions and added workspace links only.

## Verification

- `pnpm build`: all packages, MCP app and NanoDAW production build passed;
  this includes TypeScript compilation of packages, app and browser.
- `pnpm check:architecture`: 16 workspaces, 42 runtime edges, zero violations.
- `pnpm test`: 223 tests passed before the two additional regression fixtures.
- Additional regressions passed: HTTP capacity preserves an existing pairing;
  successful Bitwig readback followed by storage saturation stays uncertain,
  and replay does not mutate again.
- Final Gateway and Bitwig targeted run: 33 tests passed, including both new
  regressions and the current dual-target, previewOnly and authentication tests.
- `pnpm nanodaw:test`: 160 tests passed in 17 files.
- `pnpm smoke:packages`, `npm pack --dry-run`, and `git diff --check`: passed.

All network activity in tests is synthetic loopback traffic. No browser visual
QA or physical listening test was needed for these non-visual changes. Earlier
browser and live results in historical reports are not new evidence here.

## Remaining decisions

### Independent review P1 correction

Review of 065df240 found that a recorded `partial` report was classified as
completed and evicted after TTL, losing unknown-mutation evidence. The separate
fix explicitly permits terminal eviction only for `succeeded` or `failed`
reports. Partial reports remain available and pinned regardless of TTL.
The regression advances the clock beyond plan/report expiry, triggers cleanup,
checks capacity rejection for a new plan and re-records the same report without
losing its evidence. Existing successful-report cleanup remains covered.

Validation: 24 Gateway Core tests passed; Gateway Core build passed; full
`pnpm test` rebuilt packages/app and passed 226/226 tests. `git diff --check`
passed. No live provider or DAW calls. Parent publishes the new head to PR #68.

Parent reviews and publishes the replacement before merging or closing #50/#51.
BT-ARCH-105 through 109, protocol-client extraction, restart-durable storage,
and the remaining issue #65 product roadmap remain deferred and unimplemented.
Two exact RTX app-to-root imports are preserved to avoid coupling this port to
BT-ARCH-107. Neither exception authorizes any package-to-app import.

No worktree or branch was removed. No generated artifacts are committed.
