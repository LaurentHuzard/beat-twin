# RTX Bitwig Preview Runtime

BT-213A provides a supported, preview-only composition of the existing Beat
Twin Gateway, OpenAI-compatible provider, and bounded Bitwig adapter:

```text
operator HTTP client
  -> loopback Beat Twin Gateway
  -> Qwen through llama.cpp
  -> real read-only Bitwig target inspection
  -> strict SongPatch validation and compilation
  -> immutable preview
  -> stop
```

The model sees only `list_daw_targets`, `inspect_session`, and
`propose_song_patch`. This runtime does not expose plan status, confirmation, or
execution routes. Its Bitwig port implements inspection only and rejects
authentication and mutation independently. `BITWIG_BRIDGE_SECRET` is not
required or used by the preview transport.

## Prerequisites

- Node.js 24;
- the repository dependencies installed through pnpm;
- a running OpenAI-compatible llama.cpp server;
- Bitwig Studio with the Beat Twin controller enabled;
- one human-selected empty launcher slot for a useful preview.

The runtime never starts Bitwig or llama.cpp.

## Start

Set a local operator secret of at least 16 characters without committing or
printing it, then start the runtime:

```bash
read -rsp "Beat Twin operator secret: " BEAT_TWIN_OPERATOR_SECRET
export BEAT_TWIN_OPERATOR_SECRET

LITERT_BASE_URL=http://192.168.1.141:8002/ \
LITERT_MODEL=qwen3-8b \
pnpm gateway:rtx-bitwig-preview
```

Defaults:

- Gateway: `127.0.0.1:8788`;
- Bitwig controller: `127.0.0.1:8888`.

`BEAT_TWIN_GATEWAY_HOST` and `BITWIG_HOST` accept only `127.0.0.1` or `::1`.
Ports may be changed with `BEAT_TWIN_GATEWAY_PORT` and `BITWIG_PORT`.

Startup output identifies the local URL, model, and controller address. It
never includes the operator secret or a pairing token.

## Pair and inspect

In another terminal using the same operator secret:

```bash
PAIRING_JSON=$(curl --silent --show-error \
  --request POST \
  --header 'content-type: application/json' \
  --data "$(jq -n --arg secret "$BEAT_TWIN_OPERATOR_SECRET" '{operatorSecret: $secret}')" \
  http://127.0.0.1:8788/v1/pair)

PAIRING_TOKEN=$(jq -r .token <<<"$PAIRING_JSON")

curl --silent --show-error \
  --header "authorization: Bearer $PAIRING_TOKEN" \
  http://127.0.0.1:8788/v1/health | jq

curl --silent --show-error \
  --header "authorization: Bearer $PAIRING_TOKEN" \
  http://127.0.0.1:8788/v1/sessions/bitwig | jq
```

The pairing token has read, agent-run, plan-create, and `song.write` scope so
the Gateway can materialize an accurate plan. It deliberately lacks
`plan.confirm` and `plan.execute`.

## Generate the immutable preview

```bash
curl --silent --show-error \
  --request POST \
  --header "authorization: Bearer $PAIRING_TOKEN" \
  --header 'content-type: application/json' \
  --data '{
    "dawId": "bitwig",
    "request": "Inspecte ma session Bitwig puis propose une boucle électronique minimale à 132 BPM."
  }' \
  http://127.0.0.1:8788/v1/agent/runs | jq
```

The response contains the model result, validated patch, materialized commands,
immutable plan, and side-effect-free preview. Stop there. A future BT-213B
runtime and a fresh human gate are required for any Bitwig write.

For the same sequence as a single disposable diagnostic command, including
health, real inspection, Qwen proposal, and preview:

```bash
LITERT_BASE_URL=http://192.168.1.141:8002/ \
LITERT_MODEL=qwen3-8b \
pnpm smoke:rtx-bitwig-preview
```

The smoke uses an in-memory random operator secret and an ephemeral Gateway
port. It prints neither the secret nor its pairing token and closes the runtime
after the preview. Its Bitwig transport remains physically incapable of
authentication or mutation.

Requests to these paths return `404 route_not_found` in this runtime:

```text
/v1/plans/:planId/status
/v1/plans/:planId/confirm
/v1/plans/:planId/execute
```
