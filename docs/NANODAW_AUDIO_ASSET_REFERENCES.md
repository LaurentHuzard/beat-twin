# NanoDAW Browser-Owned Audio Asset References

BT-AUDIO-201 adds the durable metadata boundary for future audio clips and
samples. It does not import, retain, decode, attach, schedule, or play audio.

## Contract

Song schema v3 owns an `audioAssets` registry. Every entry is an immutable
`AudioAssetReference` schema v1 with:

- a song-local `id` and human-readable `label`;
- one bounded audio media type;
- an integer encoded-byte length from 1 byte through 512 MiB;
- a lowercase `sha256:` content identity;
- a `browser-local` locator containing an opaque key.

The opaque key accepts only ASCII letters, digits, `_`, and `-`, starts with an
alphanumeric character, and is limited to 128 characters. This deliberately
cannot carry a filesystem path, `file:`/`blob:`/`data:` URL, remote URL, object
URL, or provider endpoint. Asset IDs and locator keys are each unique within a
song. Registry entries may be unreferenced in this tranche because clip
attachment belongs to BT-AUDIO-202 and later work.

The accepted media types are metadata admissibility, not a promise that every
browser can decode every codec:

```text
audio/aac  audio/flac  audio/mp4  audio/mpeg
audio/ogg  audio/wav   audio/webm audio/x-wav
```

## Persistence And Compatibility

`serializeSong()` saves only reference metadata in the existing browser-local
song JSON. Audio bytes are not in the `Song` document, and a successful JSON
round trip does not prove that matching bytes exist or can be decoded.

- Song v1 migrates to v3 with the existing deterministic `lead` instrument
  default and an empty `audioAssets` registry.
- Song v2 migrates to v3 with an empty registry. Any pre-contract
  `audioAssets` field on a v2 payload is deliberately discarded rather than
  interpreted as v3 data.
- Song v3 requires an explicit registry and validates every field. Unknown
  reference or locator fields, duplicate asset IDs or locator keys, malformed
  hashes, unsupported media types, and unsafe sizes fail closed.
- Future song or asset-reference schema versions are rejected.

`SongPatchV1`, `SongPatchV2`, commands, adapters, and runtime `materialId`
semantics are unchanged. Asset reference IDs, browser storage keys, and
runtime material IDs are separate identities.

## Deferred Work

BT-AUDIO-202+ must define byte acquisition and storage, missing-byte recovery,
decode support, cleanup, clip attachment, prepared buffers, playback,
scheduling, UI, browser proof, and human listening gates. None of those are
claimed by BT-AUDIO-201.

## Validation

```bash
corepack pnpm --filter @beat-twin/core test
corepack pnpm test
corepack pnpm typecheck
git diff --check
```
