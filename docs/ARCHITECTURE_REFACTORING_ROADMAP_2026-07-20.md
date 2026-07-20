# Beat Twin Architecture Refactoring Roadmap

Status: #46, #47, #49, and #48 implemented; review pending

Date: 2026-07-20

## Outcome

Evolve Beat Twin into an explicit modular monolith without changing its musical,
local-first, security, or external-DAW semantics. Every slice below must remain
independently reviewable and reversible.

This is a migration queue, not one implementation authorization. Only one slice
may become `Orbit Ready` after a human activates it.

Implementation update: the user activated #46, #47, #49, and #48 together as
one dependency-ordered Orbit loop. They remain separate commits and acceptance
boundaries inside one draft implementation PR.

## Sequencing Rules

- Add characterization or dependency tests before moving a boundary.
- Do not combine file moves with contract or behavior changes.
- Keep package exports stable while internal modules move.
- Keep the root Bitwig binary and 57-tool snapshot until an explicit retirement
  decision exists.
- Never introduce another owner of NanoDAW `Song` state.
- Never weaken model, policy, confirmation, target-binding, or readback gates.
- Treat live Bitwig, S25, browser, and listening evidence as separate human
  gates.

## Roadmap Summary

| Order | ID | GitHub | Slice | Value | Risk | Size | Depends on | Activation |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | BT-ARCH-100 | [#45](https://github.com/LaurentHuzard/beat-twin/issues/45) | Audit, ADR, roadmap, and documentation alignment | shared baseline | low | M | - | active |
| 1 | BT-ARCH-101 | [#46](https://github.com/LaurentHuzard/beat-twin/issues/46) | Enforce workspace dependency direction in CI | prevents new inversions | low | S | BT-ARCH-100 | implemented; review pending |
| 2 | BT-ARCH-102 | [#47](https://github.com/LaurentHuzard/beat-twin/issues/47) | Extract typed Gateway HTTP/WebSocket delivery | closes compiler and ownership hole | medium | L | BT-ARCH-101 | implemented; review pending |
| 3 | BT-ARCH-103 | [#49](https://github.com/LaurentHuzard/beat-twin/issues/49) | Move NanoDAW MCP runtime wiring into an app | creates explicit lifecycle owner | medium | M | BT-ARCH-102 | implemented; review pending |
| 4 | BT-ARCH-104 | [#48](https://github.com/LaurentHuzard/beat-twin/issues/48) | Define bounded retention and restart semantics | makes long-lived runtime honest | high | L | BT-ARCH-101 | implemented; review pending |
| 5 | BT-ARCH-105 | not opened | Split Playground document runtime from UI actions | reduces browser change amplification | medium | L | BT-ARCH-101 | proposed |
| 6 | BT-ARCH-106 | not opened | Decompose live performance and audio orchestration | isolates timing-critical semantics | high | XL | BT-ARCH-105 | proposed |
| 7 | BT-ARCH-107 | not opened | Modularize the historical Bitwig MCP facade | reduces protocol/tool drift | high | XL | BT-ARCH-101 | proposed |
| 8 | BT-ARCH-108 | not opened | Replace manual package build order with a checked graph | simplifies package growth | medium | M | BT-ARCH-102, BT-ARCH-103 | proposed |
| 9 | BT-ARCH-109 | not opened | Introduce a fail-closed adapter registry | enables a third DAW cleanly | medium | M | third-adapter activation | parked |

## BT-ARCH-100 — Audit And Documentation Baseline

### Outcome

The repository has one current architecture map, one proposed target, one ADR,
and one migration sequence. Status documents distinguish deterministic
implementation from runnable composition and live external proof.

### Changes

- architecture audit and evidence table;
- target dependency graph and composition roots;
- proposed ADR-002;
- this roadmap;
- README, status, roadmap, package-map, and Orbit alignment.

### Verification

- full deterministic Node and Playground suites;
- typecheck, production build, and package smoke;
- Markdown links and `git diff --check`;
- no runtime source change.

### Exit

Issue #45 can close when the audit PR is merged. No implementation refactor is
implicitly authorized.

## BT-ARCH-101 — Executable Dependency Rules ([#46](https://github.com/LaurentHuzard/beat-twin/issues/46))

### Outcome

CI fails with an actionable message if a package imports an app, a protected
domain package depends outward, a runtime import is undeclared, or the workspace
graph becomes cyclic.

### Scope

- a dependency-layer policy stored in the repository;
- a Node test or script using workspace manifests and source imports;
- CI and root-script wiring;
- fixtures covering allowed and rejected edges.

### Constraints

- no new runtime dependency;
- no package moves;
- initially encode the current graph with the known
  `nanodaw-mcp -> gateway app` edge as one named, expiring exception;
- BT-ARCH-103 must remove that exception.

### Acceptance

- [x] an app-to-package edge passes;
- [x] a package-to-app edge fails;
- [x] an undeclared internal runtime import fails;
- [x] a cycle fails with the cycle path;
- [x] protected domain layers reject delivery/adapter dependencies;
- [x] existing build and tests remain green.

### Rollback

Remove the CI invocation; production behavior is untouched.

## BT-ARCH-102 — Typed Gateway Delivery Package ([#47](https://github.com/LaurentHuzard/beat-twin/issues/47))

### Outcome

HTTP request handling and the authenticated browser WebSocket proxy are exposed
through a real TypeScript API that both Gateway and NanoDAW MCP compositions can
consume without importing an application.

### Scope

- introduce `@beat-twin/gateway-http`;
- move the existing HTTP handler, loopback/CORS/body policy, error mapping, and
  browser WebSocket transport without changing routes or wire formats;
- define typed ports for provider, pairing, plan store, adapters, and handler;
- preserve current JavaScript-facing exports through a temporary facade if
  needed;
- move existing tests with unchanged fixtures and assertions.

### Constraints

- no new endpoint;
- no new persistence behavior;
- no change to default scopes, TTLs, quotas, timeouts, or error codes;
- no browser-state cache;
- no mutation retry.

### Acceptance

- [x] real declarations replace `unknown` Gateway wiring;
- [x] all Gateway HTTP and WebSocket tests pass unchanged in behavior;
- [x] package smoke loads the new public API;
- [x] no package depends on `apps/gateway`;
- [x] route, protocol, security, and uncertain-outcome fixtures remain stable.

### Rollback

The existing app facade can continue re-exporting the extracted package while
consumers migrate.

## BT-ARCH-103 — Explicit NanoDAW MCP Composition App ([#49](https://github.com/LaurentHuzard/beat-twin/issues/49))

### Outcome

`@beat-twin/nanodaw-mcp` owns MCP schemas/service/transport only. A dedicated
application owns HTTP server, browser proxy, pairing, plans, adapter, stdio, and
shutdown lifecycle.

### Scope

- add `apps/nanodaw-mcp` as the composition root;
- move `createNanoDawMcpRuntime()` wiring out of the package;
- retain MCP service and server creation in `packages/mcp`;
- compile against `@beat-twin/gateway-http` declarations;
- remove `packages/mcp/src/gateway.d.ts` and the dependency on
  `@beat-twin/gateway`;
- keep the existing CLI command working through a thin compatibility facade.

### Constraints

- no tool-schema change;
- no confirmation or execution tool exposed to the model/MCP client;
- browser remains the only NanoDAW state owner;
- current default host, port, and review route remain compatible.

### Acceptance

- [x] package-to-app architecture exception is removed;
- [x] MCP metadata and protocol tests remain unchanged;
- [x] one integration test proves startup, review, browser CAS batch, and clean
      shutdown through the app;
- [x] root commands and documented setup remain compatible.

## BT-ARCH-104 — Retention, Idempotency, And Restart Contract ([#48](https://github.com/LaurentHuzard/beat-twin/issues/48))

### Outcome

Every in-memory registry has an explicit capacity, expiry, cleanup, replay, and
restart policy. Any state called durable has a storage contract matching that
claim.

### Inventory

- completed command requests;
- NanoDAW and Bitwig adapter request executions;
- Bitwig observations;
- pairings and quota records;
- plans, confirmations, execution reports, and uncertain outcomes;
- browser performance transition IDs.

### Design Questions

- Which evidence must survive only one browser or process session?
- Which terminal outcomes must survive Gateway restart?
- How long must an idempotency key remain reserved to prevent unsafe replay?
- What capacity limit fails closed without evicting safety evidence too early?
- Which cleanup operations may run lazily on access and which need a timer?

### Constraints

- never replay an external mutation automatically;
- never evict an active plan, confirmation, or uncertain execution;
- clock and storage are injected for deterministic tests;
- storage errors fail closed before mutation and do not hide post-mutation
  uncertainty.

### Acceptance

- [x] a decision record defines process-lifetime versus restart-durable state;
- [x] each registry has deterministic expiry/capacity tests;
- [x] restart tests preserve required terminal status or docs stop calling it
      durable;
- [x] memory growth is bounded under a long synthetic session;
- [x] idempotent replay safety remains intact at every retention boundary.

## BT-ARCH-105 — Playground Document Runtime Boundary

### Outcome

The browser still owns exactly one `CommandState`, while document execution,
history/persistence, deterministic draft parsing, performance reconciliation,
and UI convenience actions have explicit internal modules.

### Sequence

1. Extract the pure draft parser and blocker rules.
2. Extract document commit/history/persistence transitions behind one store
   service interface.
3. Keep Zustand as the UI-facing facade and selector source.
4. Move feature-specific convenience actions next to their feature only when
   two callers do not need them globally.

### Constraints

- no new state store;
- no second command runtime;
- one remote batch remains one revision, undo checkpoint, and autosave;
- undo/redo and load/import keep existing performance reconciliation semantics;
- selectors and component behavior remain compatible.

### Acceptance

- [ ] characterization tests pass before and after every extraction;
- [ ] `store.ts` becomes composition/facade code rather than the implementation
      of every browser concern;
- [ ] remote, local, capture, undo/redo, load, and import paths still converge on
      the same document transition boundary.

## BT-ARCH-106 — Live Runtime And Audio Orchestration Modules

### Outcome

Timing-critical state-machine rules remain pure and explicit while scene,
transition, transport, recording, reconciliation, material projection, and
engine-observation concerns gain focused internal modules.

### Sequence

1. Split contracts and validation with no reducer change.
2. Extract transition and transport reducers with characterization tests.
3. Extract scene group atomicity.
4. Extract material projection from the audio controller.
5. Extract observation/cancellation orchestration without changing the engine
   protocol.

### Constraints

- an active clip is still claimed only after matching engine observation;
- scheduled cancellation remains engine-owned;
- scene atomicity and fail-safe reset semantics remain unchanged;
- no audio quality or feature work enters this slice.

### Acceptance

- [ ] the current 141-test Playground baseline remains behaviorally equivalent;
- [ ] reducer modules remain pure and have no Tone.js or browser API import;
- [ ] all observation identities and material versions remain explicit;
- [ ] a real-browser regression smoke is run separately before merge.

## BT-ARCH-107 — Historical Bitwig Compatibility Facade

### Outcome

Root `index.js` remains the public binary and export surface while protocol,
diagnostics, planning, tool registry, policy, and MCP delivery are internal
modules with focused ownership.

### Sequence

1. Freeze current exports and the 57-tool schema with characterization tests.
2. Extract `BitwigProtocolClient` and diagnostics.
3. Extract arrangement inspection/planning.
4. Extract tool registry and write-policy classification.
5. Leave `index.js` as composition and compatibility exports.
6. Consider modular controller sources only after all Node seams are stable.

### Constraints

- no tool addition/removal/rename;
- read-only defaults and policy environment variables remain compatible;
- controller protocol and authentication remain unchanged;
- controller bundling requires a separate live disposable-project gate.

### Acceptance

- [ ] `npm pack --dry-run` exposes the same public files;
- [ ] root imports and CLI still work;
- [ ] 57-tool snapshot, policy, protocol, diagnostics, and controller security
      suites remain green;
- [ ] no external DAW write occurs in deterministic CI.

## BT-ARCH-108 — Graph-Driven Build And Typecheck

### Outcome

The workspace derives build order from declared dependencies and uses one
documented type-resolution strategy per context.

### Options To Evaluate

- TypeScript project references with `tsc -b`;
- pnpm recursive/topological scripts;
- a task runner only if measured build cost justifies it.

### Constraints

- no tool adoption based only on fashion;
- preserve Node 22/24 CI;
- preserve direct Playground source development and package `dist` smoke;
- build cache artifacts remain ignored.

### Acceptance

- [ ] adding an internal dependency does not require manually editing a root
      serial command;
- [ ] clean and incremental builds agree;
- [ ] package declarations and Playground source aliases expose compatible APIs;
- [ ] CI remains deterministic on Node 22 and 24.

## BT-ARCH-109 — Third-Adapter Registry

Parked until Ableton, Ardour, or another third adapter is activated.

### Outcome

A composition-owned registry supplies target identity, capabilities, model
visibility, and route validation without turning unknown adapter IDs into an
open string boundary.

### Constraint

Do not implement this for NanoDAW and Bitwig alone. Their current closed union
is safer and simpler until a third real consumer supplies requirements.

## Explicitly Out Of Scope

- product redesign or new UI;
- audio clips, samples, mixer, Capture Jam, or export features;
- a third DAW integration;
- cloud deployment or public-network Gateway exposure;
- autonomous confirmation or execution;
- replacement of the canonical Song/command contracts;
- automatic merge or issue closure;
- live Bitwig mutation during architecture work.

## Recommended Activation

Activate BT-ARCH-101 first. It is small, behavior-neutral, and gives every later
slice an executable guardrail. Review BT-ARCH-102 only after the guard reports
the current package-to-app edge as the single named exception.
