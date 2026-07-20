# Browser NanoDAW WebSocket Proxy

BT-210 adds the authenticated transport that implements the abstract
`BrowserNanoDawPort` boundary. It does not add connected-mode UI and it never
stores a browser song or snapshot in the gateway.

## Composition

```text
NanoDawAdapter
  -> BrowserNanoDawPort
  -> authenticated loopback WebSocket RPC
  -> browser-owned CommandRuntime
```

Create the proxy before the NanoDAW adapter, attach it to the same loopback HTTP
server as the Gateway, and inject `proxy.port` into `NanoDawAdapter`. The proxy
accepts one browser session at `/v1/browser/nanodaw`.

## Authentication

The browser must offer both WebSocket subprotocols:

```text
beat-twin.nanodaw.v1
beat-twin.pairing.<base64url pairing token>
```

Use `encodeBrowserPairingProtocol(token)` to build the second value. The Gateway
authorizes the token through `PairingAuthority` with `daw.inspect`; expired,
revoked, unknown, or under-scoped tokens fail before upgrade. Query-string
tokens are rejected, the `Origin` must be explicitly allowed, and only loopback
`Host` values are accepted.

The selected WebSocket protocol is only `beat-twin.nanodaw.v1`; the pairing
token is not returned, stored in status, or included in errors.

## RPC Contract

Gateway request:

```json
{"v":1,"id":"rpc-...","method":"inspect","params":{}}
```

or:

```json
{"v":1,"id":"rpc-...","method":"executeCommandBatch","params":{"request":{"requestId":"...","expectedRevision":0,"commands":[]}}}
```

Browser response:

```json
{"v":1,"id":"rpc-...","ok":true,"result":{}}
```

The browser responds to `inspect` from its current `CommandRuntime` and handles
`executeCommandBatch` through that same runtime. One accepted remote batch must
remain one CAS revision, one history checkpoint, and one autosave when BT-211
wires the UI client.

## Failure Semantics

- A missing browser session makes inspection and health unavailable.
- Disconnect, send failure, or timeout after batch dispatch returns
  `outcome_unknown`; the adapter converts that into a `partial_execution`
  report and never retries the request.
- Gateway execution status remains the terminal recovery read after a consumed
  confirmation for the current process lifetime. Restart-durable storage is not
  implemented.
- Invalid, binary, oversized, late, or unknown RPC responses close the session
  as protocol failures.

Plan identity, adapter ID, capability version, base revision, digest, scopes,
and expiry remain enforced by `GatewayPlanStore` and `NanoDawAdapter`; the
WebSocket transport does not introduce an alternate execution path.

## Evidence Boundary

BT-210 provides and tests the server/proxy boundary with a deterministic browser
fixture. BT-211 still owns the explicit connected-mode UI, browser client
lifecycle, atomic autosave/history integration, and human preview/confirmation
surface. Standalone NanoDAW remains the default.
