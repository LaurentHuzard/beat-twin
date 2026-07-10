# G1: real LiteRT-LM tool-call fixture

The provider loop stays unimplemented until a real Samsung S25 response proves
the exact LiteRT-LM `tool_calls` wire shape. A JSON-only prompt fallback is not
accepted.

## Manual prerequisite

Start LiteRT-LM's OpenAI-compatible server on the S25 and make port `9379`
reachable from the laptop. This is one of the two manual interventions reserved
for final validation.

## Capture

From the repository root:

```bash
LITERT_BASE_URL=http://PHONE_LAN_IP:9379/ \
  corepack pnpm capture:s25-tool-call -- \
  --output tests/fixtures/litert-s25-tool-call.json
```

Set `LITERT_MODEL` only when the first model returned by `/v1/models` is not the
target. Set `LITERT_API_KEY` only if the local server requires it; the script
never writes request headers or the key to the fixture.

The command fails closed when:

- `/v1/models` has no usable model;
- either endpoint returns non-JSON or a non-success status;
- `choices[0].message.tool_calls` is absent or empty;
- the output path already exists.

After capture, inspect the fixture for unexpected sensitive content before
committing it. Only then may the provider parser and bounded four-step model
loop be implemented against that observed shape.
