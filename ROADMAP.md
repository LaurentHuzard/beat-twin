# Beat Twin Roadmap

The current ticket-level execution plan is maintained in
[`docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md`](docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md),
with the short operational queue in [`.agents/queue.md`](.agents/queue.md).
The repository-structure migration is maintained separately in
[`docs/ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md`](docs/ARCHITECTURE_REFACTORING_ROADMAP_2026-07-20.md).

## Product Direction

Beat Twin is a DAW-agnostic orchestration layer:

```text
NanoDAW Agent mode
  -> Beat Twin Gateway on the laptop
  -> LiteRT-LM/Gemma API on the S25
  -> SongPatchV1 -> ExecutableBeatTwinCommand[] -> ExecutablePlan
  -> human confirmation
  -> selected DAW adapter
```

The browser NanoDAW is the native reference target. Bitwig is the first external target. Ableton Live and Ardour are later adapters.

## Now

- Keep the browser NanoDAW working as a standalone application.
- Keep the current Bitwig MCP surface read-only by default.
- Keep offline policy, protocol, core, command, audio, and NanoDAW tests passing.
- Keep `@beat-twin/core` as the canonical musical document model.
- Keep `@beat-twin/commands` as the canonical mutation language.
- Keep browser save/load schema-versioned.
- Keep NanoDAW audition and editing independent from Bitwig.
- Keep NanoDAW MCP preparation separate from browser-owned confirmation and execution.
- Validate the existing Bitwig controller manually in disposable projects.
- Document only behavior that exists or is directly testable.

## Completed Foundations

- Node 24 local baseline, Node 22/24 CI matrix, compiled package `dist` outputs, and package smoke.
- Strict executable commands, atomic batches, monotonic revisions, payload-bound idempotence, and stable errors.
- `DawAdapter`, normalized capabilities/snapshots/plans/reports, and reusable fake-adapter conformance.
- Bounded `SongPatchV1` validation, deterministic compilation, fully materialized IDs, and side-effect-free preview.
- Transactional `NanoDawAdapter` memory port and abstract browser proxy contract; the adapter never owns a second song copy.
- Frozen compatibility snapshot for the historical 57-tool Bitwig MCP surface.
- Real LiteRT-LM/Gemma S25 capture of the exact three-tool runtime request and a strict provider loop bounded to four steps; G1 passed with `gemma4-e2b` on 2026-07-14.
- Gateway security core with hashed/revocable pairing tokens, quotas, immutable two-minute plans, single-use thirty-second confirmations, and awaited redacted audit.
- Loopback-only Gateway HTTP API with strict adapter validation, fixed-target previews, explicit confirmation, exactly-once dispatch, and uncertain-outcome status readback.
- Authenticated browser WebSocket proxy and explicit connected Agent mode while
  preserving the browser as the sole NanoDAW song owner.
- Bounded `bitwig-launcher-v1` adapter, authenticated controller writes,
  generation-aware target identity, strict musical bounds, and exact note
  readback covered by deterministic tests.

## Next: Dual-Target Proof And Packaging

Gate order:

1. Run the same accepted SongPatch through two separately confirmed laptop-owned flows:
   - Gateway -> S25 Gemma provider -> Gateway -> NanoDAW;
   - Gateway -> S25 Gemma provider -> Gateway -> Bitwig.
2. Prove the Bitwig path in a disposable project with the configured bridge
   secret, fixed empty target, bounded patch, and exact readback.
3. Record NanoDAW atomicity and Bitwig partial/uncertain behavior as distinct
   execution semantics; never imply cross-target atomicity.
4. Define bounded retention and restart semantics for Gateway plans,
   confirmations, idempotency evidence, and terminal execution status.
5. Package the Gateway, adapters, controller, and NanoDAW composition without
   exposing the loopback-only surface publicly.

Guardrails:

- Gemma sees only `list_daw_targets`, `inspect_session`, and `propose_song_patch`.
- Gemma never receives a confirmation or execution tool.
- `TOOL_SPECS` remains the historical Bitwig MCP surface, not the portable command language.
- The gateway contains no target-specific mutation code.
- Unsupported capabilities are rejected before mutation.
- Plans are bound to adapter ID, capability version, session revision, digest, scopes, and expiry.
- Plans expire after two minutes; confirmations are single-use and expire after thirty seconds.
- NanoDAW remote writes are one atomic batch, one revision, one autosave, and one undo checkpoint.
- The gateway proxies NanoDAW commands to the browser instead of keeping a second song copy.
- NanoDAW standalone mode remains available.
- Bitwig writes stay blocked outside an explicitly authenticated, bounded,
  fixed-target flow with exact note readback.
- External-DAW partial execution is reported honestly.
- Arrangement assistance remains plan-only until preview and recovery are stronger.

## Later

- Add a proper NanoDAW piano roll, audio clips, samples, mixer, and export without turning it into a Bitwig dependency.
- Add richer portable transformations such as velocity shaping, density, humanization, and arrangement sections.
- Add verified recovery semantics per adapter.
- Add Ableton Live through the shared adapter contract.
- Add Ardour through the shared adapter contract.
- Build an optional native Android app as an independent client, without bundling Gemma or another LLM.
- Explore a small Go daemon for external-DAW protocol bridging where it materially improves reliability.
- Package the gateway, adapters, controller, and NanoDAW for easier local installation.
