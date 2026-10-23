# Orbit Ready — direct NanoDAW musical tools 2026-10-23

User asked for direct add note, add track, play, and broad Bitwig-like NanoDAW
MCP coverage. In the explicitly opted-in runtime, existing musical operation
tools execute in one MCP call; add an atomic direct batch. Keep prepare-only
default, browser ownership, song/revision CAS, single-use execution and report.
Accept when representative track/note/transport calls and grouped batch work
through MCP with readback, stale input is rejected, and the default remains
prepare-only. No MUE or Bitwig startup.

Task worktree: `.worktrees/beat-twin-nanodaw-direct-musical-tools-20261023`,
branch `feat/nanodaw-direct-musical-tools-20261023`, fresh origin/main
`360cca5eebd0d898b79e3bfc3a8ef0503b059f34` plus cherry-picked prior
direct-plan feature `8c10ad3` (source `ddee089`).

## Historical plan — direct NanoDAW MCP writing 2026-10-23

User requested applying NanoDAW edits without the browser Confirm and apply
step. Add an explicit local runtime opt-in and one single-use MCP apply tool for
retained plans. Acceptance: default catalog stays preparation-only; opted-in
runtime applies one exact plan through the browser-owned adapter, records the
report, and rejects replay/stale revision. No MUE or Bitwig startup.

Task worktree: `.worktrees/beat-twin-nanodaw-direct-mcp-write-20261023` on
`feat/nanodaw-direct-mcp-write-20261023`, based on verified origin/main
`360cca5eebd0d898b79e3bfc3a8ef0503b059f34`.

## Historical plan — shared NanoDAW MCP startup 2026-10-11

Operator requests one MUE portfolio startup and four configured MCPs. Reuse the
gateway HTTP library's existing local pairing mode in the NanoDAW composition
root with explicit opt-in. Default secret pairing, loopback binding, exact
origins, browser ownership and write confirmations remain. Validate local/foreign
origins, existing integration tests and build; no live DAW write or publication.

## Historical plan — BT-MIDI-IMPORT-112

Orbit Ready unique : issue #112 et PR draft #111, autorité utilisateur/parent vague11.
Base fraîche main 1775b363531a5ea5c2cf16470eac3a9e6230d464 ; nouveau worktree
.worktrees/beat-twin-midi-import-finalize-20261009-v11, branche feat/midi-import-finalize-20261009-v11.
Reprise fast-forward des deux commits préparés jusqu’à ab43d01977f3e34685ceeb9bb1d8d32130edebd9.

Contrat inchangé : SMF0/1 PPQ/tempo constant, preview sans mutation, Add explicite
CAS/append atomique avec pistes/identité/tempo existants préservés, 1 revision/undo/save.
Bornes et sous-ensemble documentés ; malformed/controllers/sustain/tempo changes/
SMPTE/type2/ambiguous notes refusés sans mutation. Pas de nouveau codec.

VERIFY renouvelé : parser/store/PPQ3/roundtrip, suite NanoDAW, build packages/app,
browser preview/discard/Add/undo/stale/error/clavier/3 tailles/reduced motion/axe ciblé.
Fixtures seules, aucune qualification Bitwig/Gateway/provider/écoute/audio réel.
Next : commit local + revue indépendante exacte avant publication/ready/merge.
Export #84 et Duo #89 restent distincts et préservés ; anciens worktrees conservés.

VERIFY : packages build, NanoDAW23files/201tests, production build verts. Chrome6/6
aux3tailles, reducedmotion/clavier, stale réel Undo et malformed/corrected twin.
Axe réel détecte ancien saut h1→h3 ; correction MIDI h2, composant2/2+build renouvelés,
scan final0violation0incomplete aux3tailles. Rapport feature-20261009-midi-import-v11.md.
Candidat local à revue ; aucun push/ready/merge. Vague11 dernière avant pause, pasv12.

Delta focus après revue : input DOM stable + value='' native, aria-busy sansdisable ;
aucun vol de focus, mêmes fichiers et reselectpending refus protégés pargeneration.
Composant4/4/build/Chrome9/9 etaxe0/0 verts. NouveauSHA àrevuedelta indépendante.
