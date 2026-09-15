# BT-MCP-DIAGNOSTIC — offline policy/tool diagnosis

Date: 2026-09-15. Issue: #1. PR: #76.
Branch: `agent/mcp-policy-diagnostics-issue-1`.
Base: `9b0cc64b7863e68e6824f2763fe54d79e126cf93`.

## Outcome

The issue remained current after #71 delivered the canonical Bitwig registry.
The new `pnpm diagnose:tools` command lists effective policies and exposed names,
provides text/JSON output and classifies a bounded optional tool name without
starting MCP, contacting a DAW/provider or dispatching a tool. Unknown names,
policy denial and optional discovery disabled are distinct. Client-cache state
is explicitly uninspected; a stale cache is a possibility, not an assertion.

No changes to index.ts/index.js, the 57-tool registry, historical MCP response
payloads, authentication, browser-owned NanoDAW state or write defaults. No new
dependency or runtime configuration. The existing discovery guide explains
process-environment differences, targeted statuses, exit codes and restart/reload.
Both new test files are wired into test/test:unit; the CLI is in package files.

## Executed offline verification

Local runtime: Node 22.16.0. The project requires Node 26; these results are not
claimed as Node 26 or full-workspace CI evidence.

- Red: the new unit test file failed with the diagnostic module absent.
- Green: 12 dependency-free unit tests passed after implementation.
- Canonical integration: 11 tests passed against the exact unchanged index.js,
  including read-only, application_write, all-writes, normalization, invalid
  policies, discovery opt-in, package wiring and nine guarded CLI subprocesses.
- Non-regression: all 9 existing policy-gate tests passed separately and together
  with the new tests: **32 tests, 32 passed, 0 failed, 0 skipped**.
- JavaScript syntax checks passed for the CLI, both new test files and index.js.
- Local new-file whitespace checks passed; repository diff reviewed for scope.

Reproduction from a checkout with the documented Node version:

```sh
node --test tests/policy-gate.test.js tests/mcp-tools-diagnostic*.test.js
node --check scripts/mcp-tools-diagnostic.js
```

Direct cloning/dependency download failed DNS resolution in this environment.
For the focused tests, source files were retrieved through the authorized GitHub
connector and materialized locally. Git blob SHA-1 checks proved byte-for-byte
identity, not a rewritten or stubbed canonical registry:

- index.js: `ec59df5bbdccdaba0cb71db5ebe5130bd8657e3e`
- tests/policy-gate.test.js: `378e3a0ec2c1ade945f744701a5f2260c5f980a2`
- tests/fixtures/policy-errors.json: `02d48fd34a2aee9cd69068949dad54c26b174f40`

The CLI and both new test files also matched their pushed GitHub blob hashes.
No local validation harness or unchanged copied source file is added to the PR.

## Adversarial review

The diagnostic projects only known registry names and policy labels, never raw
environment values or error messages. Unknown names are not reflected. Invalid,
duplicate, overlong, path-like and control-character arguments fail before the
registry loads. Module-load failures do not reveal paths or tokens. The reporting
function receives only the three relevant policy/discovery configuration keys.

Known-name enumeration uses a detached all-enabled metadata object, not process
environment mutation or server activation. getToolDefinitions remains the only
policy parser. The subprocess guard rejects socket connections/listeners, common
HTTP/DNS/UDP entrypoints and fetch; an attempted connection fails the test even
if the diagnostic catches the thrown error. Existing policy tests inject DAW
fakes, never a real write.

## Remaining gates / handoff

Full pnpm test, typecheck, build, SDK transport tests, architecture suite and
browser E2E were not run in the partial local checkout. The initial PR head
returned no workflow runs/statuses when inspected. A missing CI result is not a
pass; PR metadata records the latest inspection. Require full Node 26 CI and
human review before merge. No live Bitwig, gateway, model or client-cache test
was requested or performed. No merge, deployment or automatic retry occurred.

The queue retains only this bounded item pending review. Other historical
integration evidence and backlog rows remain separate and do not authorize work.
