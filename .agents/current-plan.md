# BT-LOCAL-001 — local Bitwig bridge without a secret

Authorized by the user on 2026-09-14. Fresh origin/main b386eda.
Worktree: .worktrees/beat-twin-local-bridge; branch fix/local-bitwig-without-secret.

1. Replace Bitwig wildcard listener with an outbound connection to a loopback relay.
2. Remove the Bitwig secret requirement in controller, client and gateway.
3. Keep operator pairing, policy, exact confirmation, target binding and readback.
4. Test isolation, multiplexing, disconnects, reconnect and unchanged write gates.
5. Install locally with backup; verify live read-only. No musical writes or publication.

Maintained changed legacy scripts move to TypeScript; generated runtime JS is
built for the Bitwig JS-only engine and existing package entry point.

## Verified locally

246 backend tests pass; architecture boundaries pass (16 workspaces, 43 edges).
The live controller accepts bridge.authenticate with empty params and reports
writeAuthentication=local-only. Bitwig remains open; no musical mutation sent.
Gateway restart reconnects the controller. Ports 8787, 8888 and 8889 bind only
127.0.0.1; connecting via the workstation LAN address is refused on both bridge
ports. beat-twin.orbit returns HTTP 200; MUE model health is OK.
NanoDAW browser pairing and a user-selected Bitwig launcher slot remain required.

Local activation uses this worktree for the gateway via TwinPilot gatewayPath;
installed controller backup is alongside the user's original controller script.
Original repo checkout sources preserved. No commit, push, PR or merge performed.

## BT-LOCAL-002 — NanoDAW local connection without operator secret

User-authorized continuation on 2026-09-14 in the existing isolated worktree.
Remove the browser password form; local pairing requires a loopback peer, Host
and an exact allowed Origin. Keep short-lived session tokens, WebSocket single
ownership and exact musical confirmations. Enable automatic local connection
in the tp-managed UI. Test origin/host denial, cancellation and real browser
inspection; do not execute music or replace the user's song.

BT-LOCAL-002 complete locally: 247 backend tests and 167 NanoDAW tests pass;
frontend build and architecture checks pass. Playwright desktop 1280x720 and
mobile 390x844 show Connected without a password form, including an empty song.
No blank page or framework overlay; the optional /v1/mcp/plans endpoint returns
404 and is handled as unavailable by the client. Browser plugin unavailable;
Playwright used for QA and closed afterward. Opened beat-twin.orbit in default
Zen; socket inspection proves Zen owns the live WebSocket. Gateway health then
reports model OK, NanoDAW healthy and Bitwig healthy. No musical mutation sent.
