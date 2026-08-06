# BT-AUDIO-201 — Browser-Owned Audio Asset References

Date: 2026-08-06
Branch: `agent/bt-audio-201-asset-references`
Base: `main` at `2ecd6cb`
State: implementation and deterministic gates complete; commit, push, and PR publication authorized

## Outcome

NanoDAW Song schema v3 can persist and reload a bounded registry of versioned
browser-local audio asset reference metadata. The contract never embeds bytes,
paths, URLs, object URLs, decoded buffers, or runtime handles and makes no
decode or playback claim.

## Delivered

- Added immutable `AudioAssetReference` schema v1 with a song-local ID, label,
  explicit audio media type, bounded encoded-byte length, lowercase SHA-256
  identity, and opaque browser-local locator.
- Added an immutable `Song.audioAssets` registry with unique asset IDs and
  unique locator keys.
- Advanced Song schema to v3. Existing v1 and v2 documents migrate to an empty
  registry; v1 retains its deterministic built-in-instrument migration.
- A pre-contract `audioAssets` field on a v2 payload is discarded instead of
  being interpreted as v3 data. V3 requires the registry explicitly.
- Kept SongPatch V1/V2, commands, adapters, runtime `materialId`, storage-key
  naming, and browser audio behavior unchanged.
- Updated directly typed Song fixtures to v3 without changing proposal schema
  fixtures that correctly remain SongPatch v2.
- Added the durable contract and compatibility guide in
  `docs/NANODAW_AUDIO_ASSET_REFERENCES.md`.

## Validation

- Focused `@beat-twin/core` build and tests: passed.
- `pnpm test`: 181/181 passed outside the restricted sandbox. The first run's
  three TCP tests were blocked from binding loopback ports; no product test
  failed, and the authorized unrestricted rerun passed all gateway and protocol
  cases.
- `pnpm typecheck`: passed.
- `pnpm nanodaw:test`: 15 files, 141/141 passed.
- `pnpm --filter @beat-twin/playground build`: passed; 2,568 modules transformed.
- `pnpm smoke:packages`: passed for nine packages.
- `git diff --check`: passed.

Every pnpm command emitted the existing engine warning because the local
runtime is Node 26.4.0 while the repository declares Node 22 or 24.

## Adversarial Review

The review covered schema confusion, silent pre-v3 field promotion, unknown
fields, duplicate IDs and locator keys, unsafe sizes, non-integer and non-finite
values, MIME widening, malformed or uppercase hashes, URL/path/blob smuggling,
deep immutability, migration loss, and confusion with runtime material IDs.

Findings addressed before closure:

- all direct typed Song fixtures now include schema v3 and `audioAssets: []`;
- SongPatch v2 and MCP proposal fixtures remain correctly unchanged;
- v3 without `audioAssets` fails instead of migrating implicitly;
- locator and reference objects reject unknown fields;
- v2 data cannot smuggle an audio reference into the new contract;
- documentation distinguishes content hashes from the separately unique asset
  IDs and locator keys.
- `serializeSong()` now revalidates and projects the complete document before
  JSON output, so forged URL, path, or byte fields cannot cross persistence;
- content hashes and opaque locator keys reject surrounding whitespace instead
  of silently changing storage identity through trimming.

## Evidence Boundary And Residual Risk

- Song JSON round-trip proves metadata persistence only. It does not prove that
  bytes exist, survive browser storage lifecycle, decode, or sound correct.
- The media-type allowlist is an admissibility boundary, not a cross-browser
  codec-support promise.
- Unreferenced registry entries are intentionally allowed because audio clip
  attachment is not part of BT-AUDIO-201.
- Import, byte storage, decode, missing-byte recovery, cleanup, clip attachment,
  scheduling, playback, UI, browser QA, and human listening remain BT-AUDIO-202+
  work.
- The user authorized feature commit, push, and PR publication after the green
  implementation handoff. Merge, deployment, external writes, and branch
  deletion remain gated.

## Next Gate

BT-AUDIO-202 may be planned only after review/publication of this tranche and a
fresh human activation. Its contract must resolve actual browser-local bytes
without weakening the opaque reference or browser-owned Song boundary.
