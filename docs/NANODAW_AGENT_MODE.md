# NanoDAW Connected Agent Mode

Status: implemented by BT-211 on 2026-07-15.

NanoDAW remains a standalone browser DAW by default. Agent mode is an optional,
explicit connection to the loopback Beat Twin Gateway. The browser continues to
own the only mutable song state before, during, and after that connection.

## Player Flow

1. Choose **Enable Agent mode**. No network request happens before this action.
2. Keep the default loopback Gateway URL or enter another loopback origin.
3. Enter the operator secret and choose **Pair Gateway**. The visible secret is
   cleared after pairing and neither secret nor pairing token enters browser
   storage.
4. Enter a musical request and choose **Generate preview**. Gemma may list DAW
   targets, inspect the current session, and propose `SongPatchV1`; it receives
   no confirmation or execution tool.
5. Review the fixed command list, base revision, required scopes, and expiry.
6. Choose **Confirm and apply once**. The Gateway confirms and consumes that
   immutable plan, then dispatches one command batch through the browser proxy.

## State Boundary

The browser session implements two operations for the Gateway:

- `inspect` returns a snapshot of the current browser command state;
- `executeCommandBatch` executes one expected-revision batch in the existing
  Zustand store.

The Gateway holds WebSocket/session metadata and pending RPC promises, not a
second `Song`. A successful remote batch follows the same persistence boundary
as local edits: exactly one revision, one undo checkpoint, and one autosave.
Standalone editing does not depend on the Gateway and remains available while
Agent mode is connected.

## Security And Failure Semantics

- Gateway URLs are restricted to `http(s)://127.0.0.1`, `localhost`, or `::1`.
- Pairing is explicit and WebSocket authentication uses the BT-210 subprotocol.
- Model output can only create a preview-bound, expiring plan.
- Confirmation and execution remain separate authenticated Gateway requests.
- Once confirmation begins, the UI retires that preview. A failed or uncertain
  result is never offered for retry; the player must inspect NanoDAW and create
  a fresh plan.
- Disabling or losing Agent mode does not disable local editing or clear the
  browser song.

## Evidence Boundary

BT-211 is covered by deterministic browser-component and Gateway-client tests,
plus desktop and mobile headless-Chrome layout checks. It does not claim a live
S25 model run, live Bitwig write, or end-to-end packaged Gateway deployment.
