# Issue #1 - offline Bitwig MCP policy/tool diagnostics

Date: 2026-09-15. Branch: `fix/mcp-policy-diagnostics-issue-1`.
Base main commit: `9b0cc64b7863e68e6824f2763fe54d79e126cf93`.
Status: implemented for review; not merged or live-validated.

## Scope and findings

The issue remains relevant after #69/#71: the shared 57-tool registry and
opt-in discovery exist, but there was no compact local policy diagnostic.
Direct unknown calls returned `tool_call_failed` and echoed the supplied name,
whereas generic dispatch already used `unknown_tool` without echoing the input.

Added `getMcpDiagnostics()` based on the existing parser and listTools projection,
plus a dependency-free CLI with text/JSON output and optional bounded comparison
against a complete client tools/list snapshot. No parallel catalog, new MCP tool,
permission widening, provider change, NanoDAW change or DAW execution is included.
Direct unknown calls now use the generic dispatcher's error shape. Existing
`policy_blocked` payloads and authentication/dispatch boundaries are unchanged.
The disconnected arrangement fallback uses the existing inspection setup hint.

## Executed evidence

A direct clone failed DNS resolution in this environment. The small tested source
subset was reconstructed from authorized GitHub reads. Original source, package,
setup guide and existing test/fixture blob hashes were checked before edits.
This is not a full workspace checkout or a Node 26 validation environment.

Runtime: Node 22.16.0 on Linux; no installed project dependencies or pnpm.

- Original `node --test tests/policy-gate.test.js`: 9 passed, 0 failed.
- New diagnostic suite before implementation: 25 tests, 4 passed, 21 failed.
  Failures exposed the absent diagnostic/CLI and unknown-tool classification.
- After implementation: `node --test tests/mcp-diagnostics.test.js tests/policy-gate.test.js`
  returned **34 passed, 0 failed, 0 skipped**. The existing policy test code is
  unchanged; only the unknown-tool fixture changed for the intentional contract.
- `node --check index.js` and `node --check scripts/mcp-diagnostics.js`: passed.
- `index.js` regenerated with the same stripTypeScriptTypes/banner operation as
  `scripts/build-bridge.ts`; controller outputs were not rebuilt or modified.
- Local `git diff --check`: passed.

Tests cover read-only/application_write/all-writes, exact exposed counts and
names, existing normalization/precedence, discovery opt-in, revoked policies,
missing/unknown client names, duplicate/order independence, empty/invalid/large
inputs, paginated snapshots, non-regular files, exit codes, no secret/path echoes,
and guarded networking plus fake write dispatch with authentication assertions.

## Adversarial review

A comparison mismatch is not diagnosed as a proven stale cache: wrong server,
environment, checkout/version or old process can explain it. Matching names do
not prove matching schemas, live connectivity, execution or human approval.
Unrecognized client names are counted, not printed. File reads are limited to
65,536 bytes even if the file grows, with non-blocking open and regular-file checks.
Diagnostic execution never calls a registry executor or changes environment.
Policy rejection still occurs before DAW dispatch, and reload advice explicitly
forbids automatic replay after uncertain mutation.

## Validation still outstanding

The supported Node >=26 full workspace tests, typecheck/builds, SDK discovery
integration and live MCP-client reload were not executed locally. GitHub CI
results must be read separately on the published PR head; no CI success is
implied by this report. No Bitwig, gateway, MUE, browser/audio or provider was
started. No real write, merge, deployment, branch deletion or permission change
was performed. Review and supported-environment validation remain required
before merge; live musical acceptance is not claimed by this offline issue.
