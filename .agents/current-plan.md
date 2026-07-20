# Beat Twin Orbit — Architecture Boundaries And Retention

## Loop

BT-ARCH-101 through BT-ARCH-104 / GitHub #46, #47, #49, and #48 — make the
approved modular-monolith boundaries executable, move reusable delivery behind
typed package APIs, restore explicit application composition, and bound all
long-lived safety registries.

## Target Outcome

Beat Twin has an enforced inward dependency graph, reusable typed Gateway
delivery, an application-owned NanoDAW MCP process topology, and explicit
process-lifetime retention semantics that remain fail-closed under capacity,
expiry, timeout, uncertain outcomes, and restart.

## Planned Slices

1. Add a tested workspace dependency policy and run it in CI.
2. Extract Gateway HTTP and browser WebSocket delivery into
   `@beat-twin/gateway-http` without changing protocol behavior.
3. Add `apps/nanodaw-mcp` as the composition root, retain the existing command,
   and remove the package-to-app exception and ambient declaration.
4. Introduce injected, bounded retention primitives and classify every safety
   registry without evicting active or uncertain state.
5. Record one Orbit report and publish one implementation draft PR stacked on
   the architecture audit PR #50.

## Product Contract

- the browser remains the only owner of NanoDAW song state;
- `@beat-twin/core` and `@beat-twin/commands` retain their canonical roles;
- models remain read/propose-only and never confirm or execute;
- routes, wire formats, tool schemas, scopes, quotas, TTLs, timeouts, and target
  identities remain compatible;
- uncertain post-dispatch outcomes are terminal and never retried;
- capacity pressure fails closed and never evicts active confirmations, plans,
  pending operations, or unresolved uncertainty;
- no live DAW write or public-network exposure is authorized.

## Verification Plan

- focused dependency-policy fixtures and package tests after each slice;
- `pnpm test`, `pnpm typecheck`, `pnpm test:playground`, and `pnpm build`;
- `pnpm smoke:packages` and `npm pack --dry-run`;
- long synthetic retention sessions with injected clocks;
- compatibility coverage for Gateway routes, WebSocket transport, MCP metadata,
  browser CAS execution, startup, and shutdown;
- `git diff --check`, local Markdown links, and an adversarial safety review.

## Current State

In progress on `agent/architecture-boundaries-retention`, based on draft PR #50
at `f1c8fd8`. The user explicitly authorized all four follow-up issues on
2026-07-20. No runtime edit had been made before this plan was activated.

## Human Gates

- Implementation and draft-PR publication are authorized for #46, #47, #49,
  and #48.
- Merge, deployment, live Gateway/browser/controller/Bitwig proof, external DAW
  writes, force-push, and branch deletion remain unauthorized.

## Exit Condition

All four issue acceptance criteria are represented by deterministic tests and
documentation, the package-to-app exception is gone, all repository checks are
green, and one draft PR closes the issues only when merged.

## Next Activation Signal

Human review of the implementation draft PR after CI succeeds.
