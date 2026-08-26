# Bitwig Web Remote

The Bitwig Web Remote is the bounded React control surface restored by
BT-WEB-001. It lives inside the existing Beat Twin playground and delegates to
the current MCP tool registry instead of carrying a second Bitwig API catalog.

## Open It

With the lolOS portfolio running, open:

```text
http://beat-twin.localhost/
```

Choose **Open Bitwig Remote** on first run, or **Bitwig Remote** in the full
NanoDAW transport. For repository-only development:

```bash
pnpm nanodaw:dev
```

The Vite development server exposes the same-origin loopback endpoints used by
the React surface. A static `vite build` does not create a standalone Bitwig
server; packaging that server remains a separate product slice.

## Current Surface

The first restored slice supports:

- read-only `bitwig_session_inspect` data for transport, tracks, selected track,
  scenes, selected device, and remote controls;
- honest connected, disconnected, and policy-locked states;
- `transport_restart`, `transport_play`, and `transport_stop` when the current
  MCP policy exposes them;
- a fresh browser confirmation before every transport command.

Mixer writes, clip launch/grid editing, device mutation, chat, audio detection,
and the archived `llm2Bitwig` component catalog are not advertised by this
surface. They require separate current-protocol slices and evidence.

## Security Boundary

The browser calls only:

```text
GET  /api/bitwig/session
POST /api/bitwig/command
```

The server-side bridge imports `getToolDefinitions()` and `handleToolCall()`
from the current root MCP implementation. Therefore:

- read-only inspection remains available with no write policy;
- commands absent from the current MCP policy are rejected before a Bitwig
  call;
- writes use the authenticated Bitwig call path;
- POST requests require an exact loopback same-origin `Origin` and an exact
  per-action confirmation value;
- `BITWIG_BRIDGE_SECRET` and provider credentials never enter the React bundle,
  browser storage, request payloads, or API responses.

There is no browser OpenAI key and no direct browser-to-Bitwig TCP connection.

## Enable Transport Writes Manually

Keep the default read-only mode for ordinary startup. For an explicitly chosen
disposable Bitwig project, start the web process with both the controller secret
and the narrow transport policy:

```bash
BITWIG_BRIDGE_SECRET=replace-with-controller-secret \
BITWIG_MCP_WRITE_POLICY=transport \
pnpm nanodaw:dev
```

The `BITWIG_BRIDGE_SECRET` value must match the Beat Twin controller preference
inside Bitwig. Do not put it in browser code or a `VITE_*` variable. Changing a
policy requires restarting the Vite process because policy is server-process
configuration.

No automated BT-WEB-001 check sends a live Bitwig write. Live verification
still requires a separate human gate and the checklist in
[`BITWIG_MANUAL_SMOKE_CHECKLIST.md`](BITWIG_MANUAL_SMOKE_CHECKLIST.md).

## Deterministic Verification

```bash
node --test tests/bitwig-web-bridge.test.ts
pnpm nanodaw:test
pnpm --filter @beat-twin/playground build
pnpm --filter @beat-twin/playground test:e2e
```

The component and browser tests use synthetic Bitwig clients. They prove policy
locking, explicit confirmation, desktop/mobile rendering, console health, and
the absence of accidental command POSTs without depending on Bitwig Studio.
