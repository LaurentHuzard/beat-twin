# ADR-002: Modular Monolith Boundaries And Explicit Composition Roots

Status: proposed by GitHub #45; accepted when the audit PR is approved

Date: 2026-07-20

## Context

Beat Twin grew from a local Bitwig MCP bridge into a pnpm monorepo containing a
browser NanoDAW, portable command and SongPatch contracts, DAW adapters, a
fail-closed Gateway core, a LiteRT-LM provider, HTTP/WebSocket delivery, and a
second MCP planning surface.

The product invariants are explicit and well tested, but physical boundaries
lag behind runtime responsibilities:

- the reusable NanoDAW MCP package imports the Gateway application;
- that import is typed by a handwritten ambient declaration rather than the
  implementation's public types;
- Gateway HTTP code is used as a library while no explicit app owns the full
  runnable process;
- the NanoDAW MCP package constructs HTTP, WebSocket, security, adapter, and MCP
  lifecycles itself;
- the historical root MCP entry point remains a large compatibility monolith;
- several internal modules combine contracts, validation, execution, and
  lifecycle code in a single public entry file.

The repository is still an experimental local application. Splitting it into
network services would add operational failure modes without resolving these
ownership problems.

## Decision

Beat Twin will evolve as a modular monolith with explicit inward dependency
direction.

### Applications are composition roots

Only `apps/*` and the temporary root compatibility binary may:

- read process configuration;
- instantiate providers, adapters, stores, servers, and transports;
- choose concrete implementations for ports;
- own process startup, signal handling, and shutdown;
- compose sibling delivery mechanisms.

No package may depend on an application.

### Packages own reusable capabilities

Packages may own one of these roles:

- domain model and pure operations;
- command or protocol contracts;
- application/security policy;
- ports and target adapters;
- provider adapters;
- typed delivery mechanisms such as MCP, HTTP, or WebSocket.

A delivery package may translate a transport into application calls, but it may
not decide the complete process topology.

### The dependency direction is inward

The intended layers are:

```text
apps and compatibility facades
  -> delivery, providers, and adapters
  -> application policy and contracts
  -> commands
  -> core
```

Dependencies within one layer are allowed only when the ownership remains
unambiguous and the graph stays acyclic.

### Current public contracts remain stable

The migration preserves:

- `@beat-twin/core` as the canonical `Song` model;
- `@beat-twin/commands` as the canonical mutation language;
- browser-only ownership of NanoDAW song state;
- model-visible read/propose-only tools;
- fixed-target plans and explicit human confirmation;
- fail-closed adapter validation and uncertain-outcome reporting;
- the root binary and historical 57-tool Bitwig MCP snapshot.

Large files may be split internally behind their existing package exports.
Extraction alone must not change runtime behavior.

### Delivery contracts are real TypeScript APIs

Gateway HTTP and browser WebSocket delivery will move behind a typed public
package API. NanoDAW MCP and Gateway applications will compile against that API.
The handwritten `packages/mcp/src/gateway.d.ts` shim will be removed only after
all consumers use the real declarations.

### Architecture is executable

CI will verify at least:

- packages never depend on apps;
- the workspace graph is acyclic;
- internal runtime imports have manifest dependencies;
- protected domain packages do not acquire adapter or delivery dependencies.

## Consequences

### Positive

- process lifecycle and configuration have visible owners;
- compiler coverage includes cross-package delivery contracts;
- NanoDAW MCP and Agent Gateway can reuse transport code without importing each
  other's applications;
- package extraction can proceed incrementally under the existing test suite;
- a future installer or daemon has a clear composition surface;
- the architecture can reject accidental dependency regressions in CI.

### Costs

- one additional typed delivery package and one explicit app may be introduced;
- some existing imports and build wiring must move without user-visible value;
- characterization tests and compatibility facades must be retained during the
  transition;
- temporary duplication may exist while consumers migrate one at a time.

### Risks

- extraction can accidentally weaken Gateway validation or uncertain-outcome
  behavior;
- moving browser proxy wiring can introduce a second state owner if snapshots
  are cached in the wrong layer;
- a broad package cleanup can hide behavior changes inside mechanical moves.

Mitigation: one boundary per PR, unchanged endpoint/protocol fixtures, green
characterization tests before and after, and explicit adversarial review.

## Alternatives Considered

### Rewrite the repository around a new architecture

Rejected. The current semantics are valuable, heavily tested, and difficult to
reconstruct safely. A rewrite would combine architecture migration with product
and security regression risk.

### Merge all packages into one package

Rejected. It would remove the package-to-app inversion mechanically but erase
useful domain, adapter, and security boundaries that already work.

### Split Gateway, model provider, NanoDAW, and adapters into services

Rejected for now. The product is local-first and the current problem is code
ownership, not independent scaling. More processes would add authentication,
deployment, observability, and failure-recovery work.

### Introduce a generic framework or shared `utils` package first

Rejected. Generic abstractions without two proven consumers would obscure the
domain language and risk coupling unrelated safety semantics.

### Keep architecture as documentation only

Rejected. The existing inversion was legal to every current build and test.
Dependency rules need executable enforcement.

## Follow-Up

Implementation order is defined in
[`ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md`](ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md).
Each implementation slice requires its own Orbit activation and human review.
