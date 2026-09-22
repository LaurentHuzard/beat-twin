# TwinPilot Duo: Android witness <-> MUE analyst

BT-DUO-001 is a deliberately small two-agent collaboration spike. It tests
whether two distinct local model endpoints add value through asymmetry and
belief revision rather than simply exchanging similar answers.

## Shape

~~~
                         task
                          |
              +-----------+-----------+
              |                       |
              v                       v
        MUE / analyst           Android / witness
      no private evidence       private local evidence
              |                       |
              +---- independent ------+
                          |
                 exchange responses
                          |
              +---- cross-challenge --+
              |                       |
              +-----------+-----------+
                          |
                          v
                    MUE synthesis
                          |
                          v
                 auditable transcript
~~~

The harness does not connect either model to Bitwig, NanoDAW confirmation,
Gateway execution, merge, deployment, or destructive tools. It calls only
OpenAI-compatible /v1/chat/completions endpoints.

## What the experiment measures

The useful signal is not whether both agents agree. Look for:

1. **Isolation**: MUE must not receive Android-only witness evidence in phase 1.
2. **Evidence transfer**: Android should surface the relevant observation.
3. **Challenge**: each agent should identify unsupported or missing claims in the
   peer response.
4. **Revision**: MUE should change or defend its position explicitly after new
   evidence arrives.
5. **Honest synthesis**: remaining disagreement or missing evidence must survive
   into the final answer.

The JSON transcript stores a SHA-256 fingerprint of the supplied witness
evidence, not the raw witness input. Model outputs can still repeat evidence, so
do not use secrets as witness material.

## Android endpoint

On the Android/Termux device, reuse the existing llama.cpp build and a model that
actually fits that device. Give the server a stable alias:

~~~bash
cd ~/llama.cpp

build/bin/llama-server \
  -m ~/models/<small-model>.gguf \
  --alias android-scout \
  --host 0.0.0.0 \
  --port 8080 \
  -c 4096
~~~

Keep the server on a trusted LAN or Tailscale path. Do not expose this
unauthenticated endpoint directly to the public Internet.

Quick check from the operator machine:

~~~bash
curl http://<ANDROID_HOST>:8080/v1/models
~~~

## MUE endpoint

The repo already uses MUE's OpenAI-compatible endpoint and daily model:

~~~
base URL: http://mue.orbit:8003/
model:    gemma4_e4b
~~~

Load the MUE API key without printing it. The existing SSH setup can be reused:

~~~bash
export MUE_API_KEY="$(
  ssh -F "$HOME/.ssh/config" rtx \
    'cat ~/.config/mue/llama-api-key'
)"
~~~

## Play the synthetic private-evidence test

From Beat Twin on the operator machine:

~~~bash
export ANDROID_BASE_URL=http://<ANDROID_HOST>:8080/
export ANDROID_MODEL=android-scout
export MUE_BASE_URL=http://mue.orbit:8003/
export MUE_MODEL=gemma4_e4b

pnpm duo:spike -- \
  --scenario experiments/duo/scenarios/private-evidence.json \
  --out /tmp/twinpilot-duo.json
~~~

Inspect the transcript:

~~~bash
cat /tmp/twinpilot-duo.json
~~~

The fixture is intentionally trivial. Its job is to expose collaboration
mechanics, not benchmark factual knowledge.

## Play with a real Android-only observation

Put a harmless observation into a file accessible to the machine running the
harness, then run:

~~~bash
pnpm duo:spike -- \
  --task "Use the witness observation to decide whether the demo device is ready. Do not invent missing facts." \
  --witness-file /path/to/android-observation.txt \
  --out /tmp/twinpilot-duo-live.json
~~~

For a later physical-witness slice, the Android runtime can collect approved
Termux:API observations itself and pass only a bounded observation envelope to
this protocol. That is deliberately outside BT-DUO-001.

## Offline orchestration test

No live model is required:

~~~bash
pnpm test:duo
~~~

The deterministic test proves:

- MUE's independent prompt does not contain the private witness string;
- Android's independent prompt does;
- both challenge phases occur before synthesis;
- provider credentials are not serialized into the transcript;
- HTTP failures do not echo provider response bodies or API keys.

It does not prove that real Android or MUE inference is reachable or that the
models behave well. The live command above is the separate evidence gate.

## Council handoff

The transcript is intentionally simple enough to feed into Naetia Council later:

~~~
task
independent:mue
independent:android
challenge:mue
challenge:android
synthesis:mue
~~~

A Council adapter should consume this transcript as evidence. It should not be
allowed to retroactively rewrite the independent turns. A useful next experiment
is to compare Duo synthesis with Naetia Council synthesis over the same frozen
transcript. That keeps the question clean: does the Council add review value, or
only more tokens?
