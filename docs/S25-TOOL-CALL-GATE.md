# G1: real LiteRT-LM tool-call fixture

Status: schema probe passed on 2026-07-10 with `gemma4-e2b`; exact runtime gate
pending a new live capture while the S25 server is reachable. The existing
`tests/fixtures/litert-s25-tool-call.json` proves the OpenAI-compatible wire
shape and strict SongPatch validation, but was captured with only the proposal
tool and therefore does not by itself pass G1 for the three-tool runtime.

The required G1 fixture must prove the exact LiteRT-LM request used by the
provider: all three read/propose tools, `tool_choice: "auto"`, the production
system prompt, and a strictly valid `propose_song_patch` response. A JSON-only
prompt fallback remains forbidden.

## Manual prerequisite

Start LiteRT-LM's OpenAI-compatible server on the S25 and make port `9379`
reachable from the laptop. This is one of the two manual interventions reserved
for final validation.

## Capture

From the repository root:

```bash
LITERT_BASE_URL=http://PHONE_LAN_IP:9379/ \
  corepack pnpm capture:s25-tool-call -- \
  --output tests/fixtures/litert-s25-agent-three-tools.json
```

Set `LITERT_MODEL` only when the first model returned by `/v1/models` is not the
target. Set `LITERT_API_KEY` only if the local server requires it; the script
never writes request headers or the key to the fixture.

The command fails closed when:

- `/v1/models` has no usable model;
- either endpoint returns non-JSON or a non-success status;
- `choices[0].message.tool_calls` is absent or empty;
- the response is not exactly one `propose_song_patch` call;
- the proposal arguments fail strict `SongPatchV1` validation;
- the output path already exists.

The schema probe revealed that LiteRT-LM accepts a compact OpenAI tool
schema but fails on the full Draft 2020-12 metadata/keywords. Beat Twin exposes
`SONG_PATCH_V1_TOOL_SCHEMA` to the model and still applies the stricter
`validateSongPatchV1()` boundary to returned arguments. The provider parser and
bounded four-step loop are implemented, but the exact three-tool live gate must
pass before the Gateway agent flow is considered releasable.
