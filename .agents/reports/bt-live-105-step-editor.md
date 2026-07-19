# Loop Report

## Loop

BT-LIVE-105 / GitHub #30 — playable 16-step editor and safe clip variations on
the NanoDAW 2 x 2 launcher.

## Product Outcome

The selected browser-owned MIDI clip now projects to an exact 16-step grid with
bounded drum and pitched entry, add/remove and velocity modes, explicit loop
length and step resolution, and keyboard-native accessible controls. The
numeric editor remains available for precision work.

## Command And Persistence Boundary

Grid edits use only `AddNote`, `RemoveNote`, or `UpdateNote`; multi-note cell
edits use one atomic command batch. Duplicate-to-variation targets only the next
empty 2 x 2 launcher slot, never overwrites, and materializes unique clip and
note IDs even when `crypto.randomUUID` is unavailable. Undo, redo, autosave, and
reload continue to operate on the one persistent `Song`.

## Live Audio Reconciliation

Audio material identity is derived only from canonical audible MIDI content,
not Song, track, clip, launcher-slot, revision, name, or note IDs. Scheduled
edits retain their transition/group identity and exact target. Active edits
replace only their track at the next loop boundary; user-queued transitions win
over automatic refreshes. Ambiguous ownership, partial scene cancellation,
missing timing, and live tempo edits reset fail closed with a structured visible
reason. A fresh live start applies the edited tempo.

Tone drums own independent voices per note/lane, preserving exact simultaneous
events without epsilon shifts. Duplicate same-lane events and same-time bass or
lead collisions use deterministic first-note-wins protection. Release and
dispose ownership is bounded and tested.

## Verification

- `pnpm test`: 178 passed;
- `pnpm typecheck`: passed;
- `pnpm nanodaw:test`: 113 passed;
- `pnpm --filter @beat-twin/playground build`: passed, 2,565 modules;
- `pnpm smoke:packages`: passed for all nine packages;
- audio-tone focused suite: 25 passed;
- `git diff --check`: passed.

Node 26 emitted the repository's expected engine warning because the supported
range is Node 22 or 24; no test or build failed.

## Browser QA

Regular Playwright was used because no Browser plugin was available. Desktop
and 390 x 844 flows covered rhythm creation, velocity accent, safe variation
duplication with distinct clip/note IDs, variation editing, undo, redo,
autosave/reload, relaunch, keyboard-native controls, horizontal narrow-layout
access, and 44 x 48 pixel touch cells with `touch-action: manipulation`.

A final clean session added Kick and Snare at the exact same beat on a drums
track, started live audio, launched the clip, observed it playing across several
loops, and reported 0 console errors and 0 warnings. Browser sessions and the
Vite server were stopped; generated Playwright artifacts were removed.

## Adversarial Review

Resolved findings covered scheduled-material races, atomic scene requeue,
active-edit timing, content-addressed identity, live tempo divergence, fallback
ID collisions, false duplicate-success messaging, silent fail-safe resets, and
Tone monophonic simultaneous-note exceptions. No unresolved release blocker
remains in the implemented scope.

## External And Human Gates

No Gateway, MCP, S25, Bitwig, external DAW write, push, PR, or merge was
attempted. Browser runtime/console behavior is proven; subjective listening
quality remains a separate human judgment and is not claimed by automation.

## Next Activation Signal

Review and merge BT-LIVE-105, then authorize BT-LIVE-106 / GitHub #31 as the
sole Orbit Ready item.
