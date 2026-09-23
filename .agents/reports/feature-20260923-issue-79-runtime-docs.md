# Issue #79 — Node runtime documentation contract

Date: 2026-09-23
Branch: `fix/issue-79-node-26-doc-contract`
Base: `4e0a74da80025778faf25c3f806cb43126704a64`

## Observation

The executable repository contract already agrees on Node 26 and pnpm 11.10.0:

- `package.json` declares `engines.node: >=26.0.0` and `packageManager: pnpm@11.10.0`;
- CI runs Node 26 and activates pnpm 11.10.0.

The active README still claimed Node 24 for local development and Node 22/24 in
CI. `docs/RTX_BITWIG_PREVIEW_RUNTIME.md` also listed Node 24 as a prerequisite.
No open PR was found for issue #79 before implementation.

## Change

- align the README and active RTX preview guide with Node >=26.0.0;
- document the unsupported-engine outcome for older Node runtimes;
- add `scripts/check-runtime-docs.js`, deriving the expected Node/pnpm contract
  from `package.json` and checking README, the RTX guide, and CI;
- add focused regression tests for stale README and stale CI Node versions;
- wire the checker into CI and the focused test into the root test commands;
- leave dated `.agents/reports/` runtime observations untouched as historical
  evidence.

## Verification

### Before

A dependency-free characterization using the current-main values produced three
contract errors:

- README did not document Node 26 / `>=26.0.0`;
- README did not explain the unsupported-engine result;
- the RTX runtime guide still documented Node 24.

### After

A focused dependency-free harness using the exact checker logic and the updated
runtime-contract values produced:

- runtime checker: PASS;
- Node test runner: 3 tests, 3 passed, 0 failed;
- syntax checks for the checker and focused test: PASS.

The available execution host was Node 22.16.0, with no pnpm installation and no
local repository checkout available. Therefore this run does **not** claim the
full `pnpm test`, typecheck, build, or a direct Node-26 local validation. GitHub
Actions on the PR is the canonical Node-26 follow-up when available.

## Safety / scope review

- no dependency version changed;
- the Node engine floor was not lowered or otherwise changed;
- no historical report was rewritten;
- no provider, Gateway, NanoDAW, Bitwig, controller, model, or live runtime was
  started;
- no deployment, merge, branch deletion, user data, or secret handling occurred.
