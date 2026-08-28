# RTX Dual-Target Runtime

BT-213B composes the existing browser-owned NanoDAW port, bounded Bitwig
adapter, Gateway plan lifecycle, and Qwen provider in one loopback runtime.
One model run returns one validated `SongPatchV1`; Beat Twin then compiles that
exact patch independently for NanoDAW and Bitwig.

```text
NanoDAW browser state --- inspect ---+
                                    |
Bitwig selected target --- inspect --+-> Qwen proposes one SongPatchV1
                                         |-> NanoDAW preview and immutable plan
                                         `-> Bitwig preview and immutable plan
```

Each plan has its own adapter, capability version, base revision, request ID,
command IDs, plan ID, digest, expiry, confirmation token, execution report, and
readback. A confirmation issued for one target cannot authorize the other.

## Start

Use Node.js 24. Store both local secrets in mode-600 files where practical:

```bash
chmod 600 /tmp/beat-twin-operator-secret /tmp/beat-twin-bridge-secret

BEAT_TWIN_OPERATOR_SECRET_FILE=/tmp/beat-twin-operator-secret \
BITWIG_BRIDGE_SECRET_FILE=/tmp/beat-twin-bridge-secret \
LITERT_BASE_URL=http://192.168.1.141:8002/ \
LITERT_MODEL=qwen3-8b \
pnpm gateway:rtx-dual-target
```

Defaults:

- Gateway: `http://127.0.0.1:8788`;
- Bitwig controller: `127.0.0.1:8888`;
- allowed NanoDAW origins: `http://127.0.0.1:5173` and
  `http://localhost:5173`.

Override the browser origins with a comma-separated
`BEAT_TWIN_ALLOWED_ORIGINS`. Both Gateway and controller hosts remain restricted
to loopback.

Remote model steps use a 60-second timeout by default. Set the positive integer
`LITERT_TIMEOUT_MS` only when the local inference host needs a different bound.
Qwen reasoning is capped at 512 tokens per step through llama.cpp's request-level
extension; `LITERT_THINKING_BUDGET_TOKENS` accepts another non-negative bound.

The runtime is write-capable only through the existing exact confirmation
routes. Starting it performs no authentication or mutation.

## Connect browser-owned NanoDAW

Start the Playground with `pnpm nanodaw:dev`, enable Agent mode, use the Gateway
URL, and pair with the operator secret. The browser keeps ownership of the
NanoDAW command state and answers inspection and atomic batch requests over the
existing authenticated WebSocket proxy.

## Prepare both previews

With the browser connected and one empty Bitwig launcher slot selected:

```bash
BEAT_TWIN_OPERATOR_SECRET_FILE=/tmp/beat-twin-operator-secret \
pnpm preview:rtx-dual-target
```

The response contains one patch and two target records. Each record contains
its exact preview and immutable plan. The command creates no confirmation and
dispatches no execution. Plans expire after at most two minutes.

Before any write, review separately:

- NanoDAW base revision, commands, plan ID, and digest;
- Bitwig project, track position, scene slot, target generation, commands, plan
  ID, and digest.

NanoDAW and Bitwig must then receive two distinct explicit human confirmations.
Never reuse a confirmation token across plans and never retry an uncertain
mutation.
