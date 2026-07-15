# Feature Report - BT-210 Browser WebSocket Proxy

Date: 2026-07-15
Branch: `dev/nanodaw-standalone`
Ticket: BT-210
Outcome: Passed locally

## Product Outcome

The gateway now has an authenticated loopback WebSocket implementation of the
abstract `BrowserNanoDawPort`. It can inspect and dispatch one atomic command
batch to the browser-owned runtime without owning a second song copy.

## Changes

- Added the `beat-twin.nanodaw.v1` WebSocket protocol and pairing-token
  subprotocol helper.
- Enforced pairing authorization, allowlisted Origin, loopback Host, one active
  browser session, bounded payloads, pending requests, and timeouts.
- Added RPC validation for inspect and execute responses.
- Added explicit post-dispatch `outcome_unknown` semantics.
- Documented composition, protocol, security, and the BT-211 boundary.
- Declared `ws` as a direct gateway dependency.

## Verification

- WebSocket fixture: 3/3 passed.
- Root suite: 132/132 passed.
- Package smoke: eight packages passed.
- `git diff --check`: passed.
- Node syntax checks for transport and fixture: passed.

## Security And Ownership

- Query tokens are rejected; authentication happens before upgrade.
- Token material is absent from status and error payloads.
- A second simultaneous browser owner is rejected.
- The proxy retains only socket/session metadata and pending RPC promises, never
  a `Song` or snapshot.
- Adapter, capability, revision, digest, scopes, and expiry remain enforced by
  the existing plan store and NanoDAW adapter.

## Failure Semantics

- Missing browser: adapter health is unavailable.
- Disconnect/send failure/timeout after batch dispatch: mutation state is
  unknown and the request is never retried.
- The durable gateway plan-status read remains the recovery path after a
  consumed confirmation.

## Evidence Boundary

BT-210 uses a deterministic browser fixture. BT-211 still owns the visible
connected-mode opt-in, browser lifecycle client, preview/confirmation UI, and
one-batch/one-autosave/one-undo integration.

## Git

- No Bitwig, MCP, gateway daemon, or S25 process was started.
- No PR was opened.
