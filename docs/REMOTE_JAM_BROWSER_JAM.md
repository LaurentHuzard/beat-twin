# BT-RJ-003: NanoDAW browser to Remote Jam WebRTC

Issue #119. Requires Beat Twin #118 / PR #120 and Remote Jam #24 / PR #26.

**Development preview, not a verified live performance.** This feature uses the existing Remote Jam Go hub for room membership/signaling and a real browser WebRTC ordered/reliable DataChannel for MIDI. Beat Twin/NanoDAW owns the locally audible instrument, with no Bitwig dependency. No LLM, MCP or agent is allowed on the realtime note path.

## Authentication, origin and timing

The Go-compatible rj-lan-signal-v1 protocol HMAC-signs the complete SDP with its DTLS fingerprint, room, session, sender, receiver and offer/answer role. The TypeScript canonicalization preserves Go's JSON escaping and RFC3339Nano timestamps. **The room key authenticates group membership only, not an individual human or device.** Any key holder can impersonate another peer; this prototype must be restricted to a trusted private pair.

The signaling endpoint is NOT a production web API. Explicit opt-in REMOTE_JAM_BROWSER_PROXY=1 enables a localhost-only Vite development proxy from /api/remote-jam-hub to http://127.0.0.1:19777 with Origin/Host checks. The browser supplies the room bearer key in memory; no key in source, URLs, Git or localStorage. No public web exposure, STUN/TURN or automatic firewall changes. A production Vite build has **no proxy**.

The browser restricts incoming DataChannel UTF-8 messages to 4096 bytes before parsing, confirms signed session/stream/peer identity, and passes them to the existing NanoDAW note sink. That sink limits polyphony, rate, ordering and stuck-note leases, with immediate disarm on error, lost ICE, user leave or unmount. Shared browser audio ownership excludes simultaneous NanoDAW live/preview. Audio unlock happens only after the user clicks Join.

RTT p95 is computed only from confirmed ping/pong round trips. Cross-machine one-way MIDI delay, clock offset, audible success, musical drift and clock synchronization remain **not measured**. The Go sender's timing offsets are not compared with browser clock offsets.

## Manual: two NanoDAW browser tabs, no Bitwig or Go peer

1. In the **Remote Jam** repository, verify Go 1.26, resolve dependencies and create a fresh room key. Before starting the hub, run the following checks:

~~~bash
go version
go mod tidy
go test ./...
umask 077
mkdir -p "$HOME/.config/remote-jam"
openssl rand -hex 32 > "$HOME/.config/remote-jam/room.key"
go run ./cmd/hub --addr 127.0.0.1:19777 --room-key-file "$HOME/.config/remote-jam/room.key"
~~~

2. In the **Beat Twin** repository (Node 26, pnpm 11.10.0), enable the Vite proxy and start NanoDAW:

~~~bash
pnpm install --frozen-lockfile
REMOTE_JAM_BROWSER_PROXY=1 pnpm --filter @beat-twin/playground dev
~~~

3. Open two tabs on the local Vite address, normally http://127.0.0.1:5173. In both: start JAM, turn on Developer Mode, and find "Remote Jam · Browser instrument".
4. Choose fresh room/session/stream IDs IDENTICAL in both tabs. Tab A is **offer**, peer ID **browser-a**, target **browser-b**. Tab B is **answer**, peer ID **browser-b**, target **browser-a**. Paste the contents of the PRIVATE room.key file into each secret field. Never publish the key.
5. Click "Join room and enable sound" on B, then A. Both should show "connected". Play notes with A/S/D/F/G/H/J/K or the eight on-screen pads. Each note travels via WebRTC and is synthesized by the OTHER tab, with a nominal 350 ms note length. There is no local echo.
6. Observe receiver events and RTT samples. Click "Leave / release all notes"; inspect cleanup and run again with a fresh room/session/stream.

This is a recipe, not a claim that two-browser audio has already been heard. The first Go dependency resolution can generate go.sum locally; review it before committing.

## Manual: one NanoDAW browser tab and one Go peer

Keep hub and browser dev server active. In the browser choose role **answer**, local ID **browser-b**, remote ID **beat-a**. Take the displayed room, session and stream IDs. After clicking Join in NanoDAW, from the Remote Jam repository run:

~~~bash
go run ./cmd/remotejam-lan --live-lan --role offer \
  --room-key-file "$HOME/.config/remote-jam/room.key" \
  --room-id REPLACE_ROOM --session-id REPLACE_SESSION --stream-id REPLACE_STREAM \
  --peer-id beat-a --target-peer-id browser-b \
  --hub-url http://127.0.0.1:19777 --listen 30s
~~~

The Go process sends a five-event MIDI burst. **Its current demo does not space note-on and note-off musically**, so a successful frame receipt may not yield an audible note. The browser's pads send separated MIDI on/off to Go, but Go only prints diagnostic receipts and does NOT produce sound. Prefer the two-browser protocol for an audible jam.

For two actual computers, use a private authenticated loopback SSH tunnel to the Go hub on each host and explicitly approve local-network ICE candidates. A two-host test is a separate acceptance gate.

## Native checks

~~~bash
pnpm --filter @beat-twin/playground exec vitest run src/remoteJamBrowserProtocol.test.ts src/remoteJamBrowserPeer.test.ts
pnpm --filter @beat-twin/playground build
pnpm --filter @beat-twin/playground test
pnpm test
~~~

## Outstanding before ready-for-merge

- Native Node 26/pnpm 11 CI build and full tests.
- Real browser-by-browser ICE/DTLS, sound, close/abort, and stuck-note witness.
- Real browser-to-Go SDP/HMAC cross-language interop witness.
- Two-laptop LAN witness and secure private tunnel check.
- Per-peer identity/replay nonce policy and hardened production signaling (this development proxy is not a deployable solution).
- Actual one-way sync, network drift, musical scheduling and audio stream as future independently qualified phases.

Source: apps/playground/src/remoteJamBrowserProtocol.ts, remoteJamBrowserPeer.ts and RemoteJamBrowserPanel.tsx.
