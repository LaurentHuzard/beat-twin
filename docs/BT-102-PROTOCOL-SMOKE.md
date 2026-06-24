# BT-102 Protocol Smoke

## Framing contract used by `index.js`

Between the Node MCP process and the Bitwig-side controller, `index.js` currently sends:

1. a 4-byte unsigned big-endian length header
2. followed immediately by one UTF-8 JSON-RPC request body

Example payload on the wire:

```text
[00 00 00 46]{"jsonrpc":"2.0","method":"transport.getTempo","params":[],"id":0}
```

Responses expected by the Node side are newline-delimited UTF-8 JSON objects:

```json
{"jsonrpc":"2.0","id":0,"result":128.5}
```

The trailing `\n` is the record delimiter. Response chunks may arrive split across multiple TCP packets; the Node parser now buffers until a newline is seen.

## Offline smoke scope

The offline smoke harness lives in `tests/protocol-smoke.test.js` and verifies:

- one read call
- one write call
- timeout when the controller stays silent
- malformed newline-delimited response handling
- reconnect after remote close

It runs against a local mock TCP server only. No Bitwig launch is required.

## Known blocking incompatibility with `BitwigPOC.control.js`

`bitwig-controller/BitwigPOC/BitwigPOC.control.js` does not parse the 4-byte length prefix. Its receive callback converts all incoming bytes directly to a string and calls `JSON.parse(msgString)`.

That means the current controller expects raw JSON bytes, while `index.js` sends length-prefixed JSON. The mock smoke intentionally follows `index.js` as the source of truth for this ticket, so the offline harness proves the Node framing and parser behavior, but not compatibility with the current controller script.

Status: blocking protocol mismatch until one side is adjusted.
