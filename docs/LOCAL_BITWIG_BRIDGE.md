# Local Bitwig connection, no secret

The controller no longer has a Bridge secret preference. It connects to
127.0.0.1:8889. A Node relay accepts Bitwig clients on 127.0.0.1:8888 and
correlates their requests. Both listeners bind explicitly to IPv4 loopback.
Bitwig itself opens no listening socket.

Build with `pnpm build:bridge`, then replace the installed
`BeatTwin/BeatTwin.control.js` with `bitwig-controller/BeatTwin/BeatTwin.control.js`.
Maintain the `.ts` source, never edit the generated `.js` directly.
Bitwig reloads the controller when its script changes. Keep a backup of the old
script before installing. If it does not reload, disable and re-enable only
that controller in Bitwig Settings > Controllers.

`pnpm gateway:rtx-dual-target` starts and owns the relay automatically.
For standalone MCP or preview mode, start `pnpm bridge:local` separately.
Only one relay can own these ports. A port conflict fails startup; it never
falls back to a wildcard listener or an old controller. The controller retries
its outgoing connection after failure or disconnection. Pending requests fail
on disconnect or timeout; they are never replayed automatically.

No BITWIG_BRIDGE_SECRET or BITWIG_BRIDGE_SECRET_FILE is needed. Legacy client
secret options are ignored and never sent. The compatibility bridge.authenticate
RPC is a local-session handshake with empty params, not a password check.

NanoDAW also uses local pairing without a secret. MCP write policy,
exact musical confirmations, target identity checks and bounded note readback
remain in force. All local applications share trust in this bridge: do not
forward either port or run it where other local processes are untrusted.

NanoDAW local pairing requires the gateway's loopback Host, a loopback TCP peer
and an exact configured browser Origin. An absent Origin, null Origin, foreign
Origin or rebound Host is rejected. The browser receives a temporary session
token and never stores a password. The gateway-http library keeps its explicit
legacy secret mode for other callers; the dual-target runtime uses local mode.

TwinPilot sets VITE_BEAT_TWIN_AUTO_CONNECT=1 for the configured NanoDAW UI.
It connects on load and retries with bounded delay while enabled. Disable Agent
mode closes the connection and cancels retries. Only one browser owns NanoDAW;
a second tab cannot take over the first. No connection operation executes music.

For CLI previews, BEAT_TWIN_BROWSER_ORIGIN must match an allowed browser origin
(e.g. http://beat-twin.orbit under TwinPilot). Local processes are trusted.
