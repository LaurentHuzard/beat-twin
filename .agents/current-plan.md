# Beat Twin Orbit — Architecture Audit

## Loop

BT-ARCH-001 / GitHub #45 — audit the repository architecture and define an
incremental refactoring roadmap.

## Target Outcome

Maintain one trustworthy architecture baseline that maps the current runtime
and package boundaries, identifies concrete risks with code and test evidence,
defines a target dependency model, and turns the migration into independently
reviewable follow-up slices.

## Planned Changes

- inventory packages, composition roots, compatibility surfaces, runtime flows,
  tests, documentation, and dependency direction;
- record architectural strengths and risks without changing runtime behavior;
- define the target modular-monolith boundaries and allowed dependency graph;
- write a sequenced refactoring roadmap with risk, value, dependencies, and
  explicit non-goals;
- add a proposed ADR for package boundaries and composition roots;
- align status and architecture documentation where it contradicts the current
  implementation;
- create follow-up issues only for slices that have a bounded outcome and test
  strategy.

## Product Contract

- the browser remains the only owner of NanoDAW song state;
- `@beat-twin/core` remains the canonical document model;
- `@beat-twin/commands` remains the canonical mutation language;
- models remain read/propose-only and never confirm or execute;
- Gateway policy, confirmation, fixed-target planning, and uncertain-outcome
  behavior remain fail-closed;
- the historical Bitwig MCP surface remains compatible and read-only by default;
- this loop changes documentation and planning only, not production behavior.

## Verification Plan

- baseline and final `pnpm test`;
- baseline and final `pnpm typecheck`;
- final `pnpm test:playground`, `pnpm build`, and `pnpm smoke:packages`;
- validate every finding against concrete source and test locations;
- verify every proposed dependency direction is acyclic;
- run Markdown link checks, `git diff --check`, and an adversarial review for
  accidental product, security, or live-evidence claims.

## Current State

Complete locally on `agent/architecture-audit-roadmap`. The user explicitly
authorized issue #45 on 2026-07-20. The audit, proposed ADR, incremental roadmap,
status alignment, four bounded follow-up issues, deterministic verification, and
Orbit report are ready for draft-PR publication.

## Human Gates

- Issue #45 is authorized as a documentation and architecture-planning loop.
- No implementation refactor, merge, deployment, live DAW write, or branch
  deletion is authorized by this loop.
- Publication is limited to a draft pull request for human review.

## Exit Condition

Met locally. The audit, target architecture, ADR, and roadmap are internally
consistent, linked from the docs index, backed by the current code/tests, and
verified offline. The draft PR closes #45 only when merged.

## Next Activation Signal

Human approval of one bounded roadmap slice after review of the audit PR.
