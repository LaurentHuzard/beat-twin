# Architecture Report — BT-ARCH-100 / GitHub #45

Date: 2026-07-20

Branch: `agent/architecture-audit-roadmap`

Baseline: `2ecd6cb7681c27ae04ba41519ec8ca50f9f1f282`

## Loop

Audit the full Beat Twin repository, document the current and target
architecture, record the package/composition decision, align stale status
claims, and produce a sequenced incremental refactoring roadmap.

## Product Outcome

Maintainers can now decide what to preserve, what to change first, and which
work must remain separate. The audit concludes that Beat Twin needs an
evolutionary modular-monolith migration, not a rewrite. It identifies the first
safe activation as an executable dependency-direction guard, followed by typed
Gateway delivery and explicit application composition.

## Generic Contract

- applications are composition roots and own process lifecycle;
- packages own reusable domain, application, contract, port, adapter, provider,
  or delivery capabilities;
- no package may depend on an application;
- dependency direction points inward toward commands and core;
- behavior is characterized before code is moved;
- architecture rules become executable CI checks rather than documentation
  conventions alone;
- retention and restart semantics are explicit before a local service is called
  durable or production-ready.

## Project-Specific Boundary

- the browser remains the only owner of NanoDAW `Song` state;
- `@beat-twin/core` and `@beat-twin/commands` retain their canonical roles;
- Gemma remains read/propose-only and never confirms or executes;
- fixed-target plans, policy, short-lived confirmation, readback, and uncertain
  outcome semantics stay fail-closed;
- the root 57-tool Bitwig MCP surface remains a compatibility facade and
  read-only by default;
- NanoDAW and Bitwig remain the only registered targets until a third real
  adapter supplies requirements.

## Evidence Boundary

The audit proves repository structure and deterministic behavior at the checked
commit. It does not prove a live S25 request, live Bitwig/controller state, an
external DAW write, listening quality, browser timing beyond the existing test
baseline, process-restart recovery, or deployable packaging.

## Changes

- added `docs/ARCHITECTURE_AUDIT_2026-07-20.md`;
- added `docs/ADR-002-MODULAR-MONOLITH-BOUNDARIES.md`;
- added `docs/ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md`;
- aligned README, status, project summary, product roadmap, Playground package
  map, adapter README, WebSocket recovery wording, and docs index;
- activated and recorded BT-ARCH-100 in the Orbit plan and queue;
- opened bounded follow-ups:
  - #46 — dependency-direction CI guard;
  - #47 — typed Gateway HTTP/WebSocket delivery;
  - #49 — explicit NanoDAW MCP composition app;
  - #48 — bounded retention and restart semantics.

No runtime source, schema, route, protocol, package dependency, test fixture, or
product behavior changed.

## Verification

- `pnpm test`: 178/178 passed;
- `pnpm typecheck`: passed;
- `pnpm test:playground`: 15 files, 141/141 passed;
- `pnpm build`: passed, 2,568 Vite modules transformed;
- `pnpm smoke:packages`: nine packages passed;
- `npm pack --dry-run`: passed with seven expected public files and a 22.9 kB
  tarball after redirecting the environment's unwritable npm cache to `/tmp`;
- local Markdown-link check: 76 Markdown files, all local links resolved;
- `git diff --check`: passed.

## Fixture Validation

No fixture changed. Existing protocol, tool-registry, policy, S25 tool-call,
adapter-conformance, Gateway, browser-proxy, command, and live-runtime fixtures
continued to pass through the repository suites. The audit does not promote
those deterministic fixtures into new live evidence.

## Adversarial Review

- Checked every “implemented” claim against merged source and deterministic
  tests; live dual-target proof remains explicitly unproven.
- Replaced misleading “durable” Gateway wording with process-lifetime terminal
  readback where no restart storage exists.
- Kept the package-to-app edge as a finding and migration target; did not hide
  it with an untested move in this documentation loop.
- Rejected a broad rewrite, microservice split, premature adapter registry, and
  generic utility extraction.
- Kept large-file size as a change-amplification signal, not an automatic reason
  to split cohesive safety logic.
- Opened only the four immediately bounded follow-ups; UI, live runtime, build,
  and historical Bitwig decompositions remain roadmap slices until activated.
- Did not close stale historical issues because their individual acceptance
  criteria were not revalidated.
- Did not touch the unrelated open draft PR #35.

## Documentation

The audit, ADR, roadmap, README, `STATUS.md`, `PROJECT_SUMMARY.md`, `ROADMAP.md`,
`PLAYGROUND_ARCHITECTURE.md`, adapter documentation, WebSocket evidence wording,
docs index, Orbit queue, and current plan now distinguish:

1. deterministic implementation;
2. runnable local composition;
3. live external proof.

## Provider State

No provider or external runtime was contacted. The existing sanitized S25
fixture passed as part of `pnpm test`; no new S25, Gateway process, browser
session, controller, or Bitwig evidence is claimed.

## Git

- local branch: `agent/architecture-audit-roadmap`;
- base: clean `origin/main` at `2ecd6cb`;
- intended publication: one documentation commit and a draft PR targeting
  `main`;
- no merge, force-push, deployment, branch deletion, or external DAW write;
- the worktree contained no unrelated user changes before this loop.

## Remaining Risks

- `@beat-twin/nanodaw-mcp` still depends on the Gateway app through an ambient
  type shim until #47 and #49 land;
- package dependency direction remains unenforced until #46;
- in-memory registries remain unbounded and restart behavior remains
  process-local until #48;
- large browser, live-runtime, command, Bitwig, and Gateway modules still have
  broad change surfaces;
- the historical and portable Bitwig paths can drift until their shared seams
  are modularized;
- a number of historical GitHub issues appear stale but need separate acceptance
  review before closure.

## Metrics

- 13 workspace manifests inspected;
- 74 source files under `apps/` and `packages/` inspected structurally;
- 38 test files and 42 technical docs inventoried;
- 9 architecture findings recorded;
- 3 durable architecture documents added;
- 4 bounded follow-up issues opened;
- 319 deterministic tests passed across Node and Playground suites;
- 0 runtime source files changed;
- 0 live external systems invoked.

## Next Activation Signal

Human review and merge of the #45 audit PR, followed by explicit Orbit
activation of #46. #47 should not begin until the guard reports the current
package-to-app edge as the single named exception.
