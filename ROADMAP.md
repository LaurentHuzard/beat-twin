# Beat Twin Roadmap

The current ticket-level execution plan is maintained in
[`docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md`](docs/BEAT_TWIN_EXECUTION_ROADMAP_2026-07-14.md),
with the short operational queue in [`.agents/queue.md`](.agents/queue.md).

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
- Validate the existing Bitwig controller manually in disposable projects.
- Document only behavior that exists or is directly testable.

## Completed Foundations

- Node 24 local baseline, Node 22/24 CI matrix, compiled package `dist` outputs, and package smoke.
- Strict executable commands, atomic batches, monotonic revisions, payload-bound idempotence, and stable errors.
- `DawAdapter`, normalized capabilities/snapshots/plans/reports, and reusable fake-adapter conformance.
- Bounded `SongPatchV1` validation, deterministic compilation, fully materialized IDs, and side-effect-free preview.
- Transactional `NanoDawAdapter` memory port and abstract browser proxy contract; the adapter never owns a second song copy.
- Frozen compatibility snapshot for the historical 57-tool Bitwig MCP surface.

## Next: Provider And Connected Mode

Gate order:

1. Capture a real LiteRT-LM `tool_calls` response from the S25 before implementing the provider loop.
2. Add the loopback Agent Gateway, provider client, pairing, quotas, plan store, policy, and fail-closed audit.
3. Implement the authenticated browser WebSocket proxy over the existing `BrowserNanoDawPort` contract.
4. Add explicit connected Agent mode while keeping the browser as the only NanoDAW state owner.
5. Implement `BitwigAdapter` without breaking the root MCP compatibility path or its 57-tool snapshot.
6. Authenticate the Bitwig write bridge and add strict bounds, reliable target identity, and note readback.
7. Route separately confirmed plans to the recorded target with no target or command replacement at execution time.
8. Run the same accepted SongPatch through two separate laptop-owned flows:
   - Gateway -> S25 Gemma provider -> Gateway -> NanoDAW;
   - Gateway -> S25 Gemma provider -> Gateway -> Bitwig.

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
- Bitwig writes stay blocked until the bridge is authenticated and exact note readback is available.
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
