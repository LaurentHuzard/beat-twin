# BT-102 Protocol Smoke

## Framing Contract

Between the Node MCP process and the Bitwig-side controller, Beat Twin sends:

1. a 4-byte unsigned big-endian length header;
2. the UTF-8 JSON-RPC request body.

Example payload on the wire:

```text
[00 00 00 46]{"jsonrpc":"2.0","method":"transport.getTempo","params":[],"id":0}
```

Responses expected by the Node side are newline-delimited UTF-8 JSON objects:

```json
{"jsonrpc":"2.0","id":0,"result":128.5}
```

The trailing newline is the record delimiter. Response chunks may arrive split across multiple TCP packets; the Node parser buffers until a newline is seen.

## Offline Smoke Scope

The offline smoke harness lives in `tests/protocol-smoke.test.js` and verifies:

- one read call;
- one write call;
- timeout when the controller stays silent;
- malformed newline-delimited response handling;
- reconnect after remote close.
- TCP connectivity diagnostics for a listening bridge and a refused
  controller connection.

It runs against a local mock TCP server only. No Bitwig launch is required.

## Controller Compatibility

The current controller script at `bitwig-controller/BeatTwin/BeatTwin.control.js` parses the 4-byte length prefix and replies with newline-delimited JSON-RPC responses.

The offline smoke proves the Node framing, parser behavior, and diagnostic
classification. Full compatibility with Bitwig Studio still requires the manual
smoke checklist because it depends on the local DAW/controller environment.
