# Completed Beat Twin Orbit

## Loop

BT-AUDIO-201 — define versioned browser-owned audio asset references and
validation.

## Target Outcome

NanoDAW can persist and reload bounded metadata references to browser-local
audio assets without embedding bytes, filesystem paths, remote URLs, decoded
buffers, or playback state in the `Song` document.

## Planned Changes

- add a versioned, immutable `AudioAssetReference` contract to core;
- validate opaque browser-local storage keys, audio media types, byte lengths,
  and SHA-256 content identities;
- persist a unique reference registry on `Song` and reject ambiguous IDs or
  storage keys;
- advance the song schema with deterministic migration from existing v1/v2
  documents to an empty asset registry;
- cover construction, round-trip, migration, duplicate, and hostile-input
  cases with focused core tests;
- document the contract and the explicit boundary with BT-AUDIO-202+.

## Product Contract

- The browser remains the only owner of asset bytes and NanoDAW song state.
- A song contains metadata and an opaque browser-local key, never audio bytes,
  a host filesystem path, a URL, a Blob URL, or a decoded buffer.
- Reference schema and song schema are versioned independently.
- Existing song schemas migrate deterministically with no invented assets.
- Missing browser-local bytes are allowed at this layer; resolution and
  lifecycle errors belong to BT-AUDIO-202.

## Verification Plan

- focused `@beat-twin/core` build and tests;
- `pnpm test`;
- `pnpm typecheck`;
- `git diff --check`;
- adversarial review for path/URL smuggling, malformed hashes, unsafe numeric
  bounds, duplicate identity, schema confusion, mutation, and migration loss.

## Current State

Implementation and deterministic gates are complete on
`agent/bt-audio-201-asset-references`. The feature remains local and uncommitted;
publication was not authorized by the delegated implementation task; the user
subsequently authorized commit, push, and PR publication on 2026-08-06.

## Human Gates

- The user activated BT-AUDIO-201 on 2026-08-06.
- Import, decode, byte storage, missing-byte recovery, playback, scheduling,
  clip attachment, and UI remain outside this loop.
- Feature commit, push, and PR publication are authorized by the user on
  2026-08-06. Merge, deployment, external writes, and branch deletion remain
  gated.

## Exit Condition

Met. The reference contract round-trips through current song persistence, legacy
songs migrate without fabricated assets, malformed/untrusted references fail
closed, and all explicit scope boundaries are documented.

## Next Activation Signal

BT-AUDIO-202 may become eligible only after BT-AUDIO-201 is reviewed and
published through a separate human gate.
