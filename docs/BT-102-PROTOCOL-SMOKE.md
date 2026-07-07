# BT-102 Protocol Smoke

## Framing contract used by `index.js`

Between the Node MCP process and the Bitwig-side controller, `index.js` sends:

1. a 4-byte unsigned big-endian length header;
2. followed immediately by one UTF-8 JSON-RPC request body.

Example payload on the wire:

```text
[00 00 00 46]{"jsonrpc":"2.0","method":"transport.getTempo","params":[],"id":0}
```

Responses expected by the Node side are newline-delimited UTF-8 JSON objects:

```json
{"jsonrpc":"2.0","id":0,"result":128.5}
```

The trailing `\n` is the record delimiter. Response chunks may arrive split across multiple TCP packets; the Node parser buffers until a newline is seen.

## Offline smoke scope

The offline smoke harness lives in `tests/protocol-smoke.test.js` and verifies:

- one read call;
- one write call;
- timeout when the controller stays silent;
- malformed newline-delimited response handling;
- reconnect after remote close.

It runs against a local mock TCP server only. No Bitwig launch is required.

## Controller compatibility

The current Beat Twin controller script is located at:

```text
bitwig-controller/BeatTwin/BeatTwin.control.js
```

It supports both raw JSON payloads and the length-prefixed JSON framing used by `index.js`.

## Status

The offline smoke test validates the Node-side protocol boundary. Live verification still requires Bitwig Studio with the Beat Twin controller enabled.
