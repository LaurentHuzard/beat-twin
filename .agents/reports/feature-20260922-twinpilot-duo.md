# BT-DUO-001 loop report — 2026-09-22

## Outcome

Implemented a bounded TwinPilot Duo spike that composes two distinct
OpenAI-compatible model endpoints:

- MUE is the analyst and does not receive the Android-only witness evidence in
  the independent phase;
- Android is the witness/scout and receives the private observation;
- both independent calls run before peer material is exposed;
- both agents then receive the peer answer and produce a challenge/revision turn;
- MUE produces the final synthesis from the frozen four-turn evidence trail;
- the returned transcript contains endpoint role/model/latency and a SHA-256
  fingerprint of witness input, never provider credentials.

No Bitwig, NanoDAW, Gateway confirmation/execution, merge, deployment or
destructive capability was added.

## Files

- scripts/duo-collab-core.ts
- scripts/duo-collab.ts
- tests/duo-collab-spike.test.ts
- experiments/duo/scenarios/private-evidence.json
- docs/TWINPILOT_DUO_ANDROID_MUE.md
- package.json
- README.md

## Deterministic checks authored

The focused command is:

    pnpm test:duo

The test suite covers:

1. root and /v1 OpenAI-compatible URL normalization;
2. private witness evidence absent from MUE's independent request;
3. witness evidence present in Android's independent request;
4. independent -> challenge -> synthesis transcript ordering;
5. provider credentials absent from serialized transcripts;
6. provider HTTP failures not echoing response bodies or API keys.

## Live test to play

The documented live path uses:

- Android/Termux llama.cpp server, model alias android-scout, port 8080;
- MUE OpenAI-compatible server at http://mue.orbit:8003/;
- MUE model gemma4_e4b;
- pnpm duo:spike with the committed private-evidence scenario.

A real Android/MUE run remains an explicit human evidence gate.

## Verification performed in this loop

- GitHub repository conventions, product constitution, current provider topology
  and agent safety boundaries were inspected before implementation.
- GitHub branch diff confirms the expected bounded file set.
- The execution environment could not clone github.com because DNS resolution
  failed, so pnpm test:duo and the full workspace suite were not executed here.
- No live Android or MUE endpoint was called from this environment.
- No offline result is presented as proof of live model behavior.

## Review questions

1. Does isolated first-pass evidence materially improve revision quality?
2. Does the Android model challenge unsupported MUE claims, or mostly defer?
3. Does MUE preserve disagreement during synthesis?
4. Is a later Naetia Council synthesis over the same frozen transcript more
   useful than the direct Duo synthesis?
5. Should the next slice add a bounded Termux:API observation envelope, or keep
   Android evidence manually supplied for one more experiment?

## Remaining human gates

- run pnpm test:duo in a supported checkout;
- start the Android llama.cpp endpoint;
- run the committed scenario against Android + MUE;
- inspect the transcript against the five human checks in the scenario fixture;
- decide whether to proceed to a Council adapter or physical-witness adapter;
- merge only after review.
