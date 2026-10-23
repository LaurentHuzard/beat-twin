# NanoDAW MCP parity with Bitwig MCP

Updated 2026-10-23. The aim is similar agent workflows where NanoDAW has an
equivalent state and operation, not a matching count of host-specific tools.
NanoDAW MCP exposes 37 tools by default and 39 with direct writing enabled.
The Bitwig MCP source catalog has 190 tools before discovery wrappers; those
tools cover many Bitwig controller surfaces absent from NanoDAW's song model.

| Workflow | NanoDAW MCP | Bitwig MCP analogue | Boundary |
| --- | --- | --- | --- |
| Inspect session | `nanodaw_inspect`, focused transport/track/clip/note reads | `bitwig_session_inspect`, `transport_get_*`, `track_list`, `clip_get_notes` | NanoDAW browser song is the state owner. |
| Create/edit arrangement | Track, clip and MIDI note tools; atomic batch | Track/clip construction and MIDI note tools | NanoDAW uses stable song/track/clip IDs and a revision, not Bitwig bank indices or selected cursor state. |
| Transport | Play, stop, position and tempo reads/writes | Bitwig transport tools | NanoDAW recording, metronome, punch and arranger-loop controls are not exposed by its command model. |
| Instruments | Four built-in instruments and track assignment | Bitwig device/browser tools | NanoDAW has no Bitwig device chain, browser, plugin or remote-control model. |
| Mix and audio | No MCP mixer controls | Bitwig volume, pan, mute, solo, sends and capture | NanoDAW Track has no volume, pan, mute, solo or sends; MCP cannot truthfully write or read those values. |
| Write authority | Browser confirmation by default; optional local direct MCP execution | Bitwig write policies | Direct NanoDAW mode still uses revision checks, a single-use plan, browser execution and readback. |

Use `nanodaw_feature_map` to discover these families from the MCP catalog.
Use `nanodaw_get_status` for actual browser connection health and declared
adapter capabilities. A listed tool does not prove a browser is connected or
that audio is audible. No MUE or Bitwig process is required for NanoDAW MCP.
