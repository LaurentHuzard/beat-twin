# Beat Twin Roadmap

## Product Direction

Beat Twin is a DAW-agnostic orchestration layer:

```text
Local LLM -> Beat Twin -> selected DAW adapter
```

The browser Mini-DAW is the native reference target. Bitwig is the first external target. Ableton Live and Ardour are later adapters.

## Now

- Keep the browser Mini-DAW working as a standalone application.
- Keep the current Bitwig MCP surface read-only by default.
- Keep offline policy, protocol, core, command, audio, and Playground tests passing.
- Keep `@beat-twin/core` as the canonical musical document model.
- Keep `@beat-twin/commands` as the canonical mutation language.
- Keep browser save/load schema-versioned.
- Keep Mini-DAW audition and editing independent from Bitwig.
- Validate the existing Bitwig controller manually in disposable projects.
- Document only behavior that exists or is directly testable.

## Next: Local LLM To DAW

Implementation order:

1. Define `DawAdapter`, normalized capabilities, snapshots, revisions, execution reports, and conformance fixtures.
2. Add an authenticated DAW-agnostic Agent Gateway.
3. Build the on-device Gemma 4 Android client with target selection and read-only inspection.
4. Compile target-independent SongPatch proposals into canonical previewable plans.
5. Implement `MiniDawAdapter` and explicit connected Playground mode.
6. Implement `BitwigAdapter` without breaking the root MCP compatibility path.
7. Route confirmed plans to their recorded adapter.
8. Run the same S25 prompt through:
   - Gemma 4 -> Beat Twin -> Mini-DAW;
   - Gemma 4 -> Beat Twin -> Bitwig.

Guardrails:

- The local LLM never receives raw DAW protocol methods.
- The gateway contains no target-specific mutation code.
- Unsupported capabilities are rejected before mutation.
- Plans are bound to adapter ID, capability version, and session revision.
- Mini-DAW standalone mode remains available.
- The Bitwig controller stays on loopback.
- External-DAW partial execution is reported honestly.
- Arrangement assistance remains plan-only until preview and recovery are stronger.

## Later

- Add a proper Mini-DAW piano roll, audio clips, samples, mixer, and export without turning it into a Bitwig dependency.
- Add richer portable transformations such as velocity shaping, density, humanization, and arrangement sections.
- Add verified recovery semantics per adapter.
- Add Ableton Live through the shared adapter contract.
- Add Ardour through the shared adapter contract.
- Explore a small Go daemon for external-DAW protocol bridging where it materially improves reliability.
- Package the gateway, adapters, controller, and Mini-DAW for easier local installation.
