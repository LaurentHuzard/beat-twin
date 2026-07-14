# Orbit Note - Standalone Evidence Gate

Date: 2026-07-14
Decision: Promote the shared transition-contract spike; do not promote a live UI.

BT-202 through BT-204 passed in the dedicated standalone worktree. The real
browser can create, edit, audition, undo, redo, save, reload, and load a local
song without contacting Bitwig, MCP, the gateway, the S25, or a cloud service.

The gate also produced the first useful architecture evidence: preview transport
must not enter the durable song history. Doing so created two contradictory
truths after undo. The fix keeps preview at the session/audio boundary and leaves
the browser song document stopped and authoritative.

The next loop is Q1-A only. It will define clock, planned transition, and engine
observation semantics in pure TypeScript. Scenes, slots, recording, macros,
capture, and both disposable interfaces remain out of scope until that contract
passes its headless scenario.
