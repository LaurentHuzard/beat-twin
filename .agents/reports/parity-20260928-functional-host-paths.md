# BT-MCP-PARITY-007 — Functional host paths

Date: 2026-09-28. Fresh fetched base: b74a587f891c1a73245faa915bf23101ce2f698b.
User authorized parallel implementation, publication and real writes/audio tests
on a disposable Bitwig project. Three agents handled observation, creative
identity/review and Ear/DSP; only root operated the DAW.

## Delivered

- Initial zero normalized mix values become readable only after nonempty display
  callback and settled identity. This is an interested cached getter, never a
  fabricated numeric callback. Writes still require numeric callback evidence.
- Browser/remote reads use interested current host caches with explicit binding
  and settling provenance. Unchanged fields no longer starve after retargeting.
  Parameter existence is respected; absent controls are not invented.
- Monotonic device, mapping, query, result and filter identities reject
  away-and-back target changes. First callback differences are detected even
  when the initial cached value emitted no callback. Callback evidence for
  mutation completion remains separate from cache initialization.
- Filter pagination uses native bank.itemCount(), not column.entryCount(). The
  real host supplied 27 category entries and 28 bank items including wildcard.
  Both counts are exposed; no hard-coded +1 assumption is made.
- Bitwig 6.1.1 pressure is explicitly unavailable (null and capabilities false).
  Installed NoteStep bytecode duplicates timbre hydration/equality and omits
  pressure; its setter changes a cache, which cannot certify engine readback.
  A mixed pressure batch is rejected before any expression setter. Other host
  versions retain the API contract and existing uncertainty timeout.
- Optional local Linux Ear provider: explicit output-monitor selection,
  loopback HTTP, bounded/cancellable ffmpeg capture, PCM WAV and honest signal
  statistics. Status never initiates capture; no microphone/default selection,
  automatic service startup, BPM or key claims. Root scripts/types/packaging
  include the maintained TypeScript sources and focused tests.

## Validation

498 offline tests pass; full typecheck (including strict Ear configuration),
architecture and distribution smoke pass. Distribution includes 33 checked
artifacts and exposes 42 default read tools without a DAW call. The policy-enabled
catalogue remains 187 tools; this tranche improves functional behavior, not count.
Independent adversarial review reran 51 creative tests and found no remaining
blocker in the examined identities/first-callback/bank-bound paths.

The final reviewed creative source hash is
`9a87f1a2a40ce170e4958316d572da12f788ca8d42811cdd0eb75b0b70a56dc3`.
Installed standard/MIDI distributions match the generated files byte-for-byte:
`cb836c36db8e54988452e3e964be5d084d3a8480e7dc7b20c4fd3c5c65a57c8c` /
`21fce2125bc619b5d1710377f402760749cdfdb5b5cea0871f891d4a603c99ba`.
Final-source live replay confirmed filter selection, wildcard, pagination both
ways, cancel and unchanged original device inventory. Audio/MPE and instrument
insertion evidence was acquired earlier in this same tranche before the final
first-callback identity hardening; it was not redundantly recaptured afterward.

## Real Bitwig 6.1.1 evidence

Private raw RPC/MCP journals, project identifiers, audio and fixture scripts stay
under ignored output/. The public report deliberately records sanitized outcomes.

| Path | Observed outcome |
| --- | --- |
| Initial zeros | Existing send read 0; groove enabled false and accentRate 0 available after reload, with explicit provenance diagnostics. |
| Send and groove writes | Send 0 → 0.1 → 0; enabled false → true → false; shuffle 0.5 → 0.6 → 0.5 read back. No audible groove-timing comparison claimed. |
| Remote pages/parameters | Factory Polysynth page 0 → 1 → 0; unchanged and zero controls available. Osc2Pitch 0.5 → 0.2 → 0.5 confirmed before page restoration. |
| Browser sound construction | Empty device inventory → observed Polysynth result selected → commit → device inventory confirms actual insertion. Browser close alone is explicitly not insertion evidence. |
| Browser filters | Analysis selection yields Oscilloscope/Spectrum/Tuner; wildcard restored; category bank offset 0 → 16 → 0 read back; cancel leaves devices unchanged. |
| Notes/pressure | New four-beat clip with five explicit starts read back. Pressure+velocity batch rejected; velocity remained unchanged. |
| End-to-end sound | Newly loaded instrument and newly programmed clip produced 3 s / 144000 stereo frames: RMS −33.2474 dBFS, peak −18.2917 dBFS, zero clipped samples. Digital silence measured before and after stopped playback. No artistic-quality claim. |
| Ear endpoints | All six MCP operations exercised against real local provider. Separate 3 s capture RMS −12.2881 / peak −5.1315 dBFS agrees with independent ffmpeg −12.3 / −5.1. Cached levels timestamped; missing musical analysis explicit. |
| MIDI relay disconnect | Held injected note and sustain present before relay termination; empty tracker and sustain false after reconnect before 10 s lease. Captured final 3 s at PCM silence floor. |
| MIDI controller reload | New instance before 10 s lease; empty tracker/sustain false. Captured tail still −40.2 dB peak at 9 s: immediate acoustic silence is not established by this case. Later silence is separately measured. |
| Incoming MPE | Two member-channel voices observed. One fundamental 130.812 → 184.991 → 130.812 Hz (5.99949 semitones), other about 196 Hz stable. Last second of capture exactly zero PCM. This uses actual incoming ALSA MIDI, not raw MCP injection. |
| Incoming aftertouch mapping | Same incoming file under NONE and PITCH_UP(12) produced unchanged 130.812 Hz; no octave shift. Mapping acceptance is not musical success. Cause remains open; inspected Java forwarding shows no obvious channel/enum/range defect. |

The incoming-expression probe used a temporary duplicate with inherited explicit
routing, a newly loaded polyphonic instrument and bounded SMF fixtures. Original
track was muted only during this isolated test and restored. Incoming voices are
not tracked by MCP; reset messages used the same incoming port and audio verified
release. MPE false and aftertouch NONE were restored.

## Failures and recovery retained in evidence

Early fixed delays of 1–1.5 s sometimes reached unsettled cursor/clip/browser
state. Those reads/writes failed explicitly; dependent writes stopped, current
state was reread later, and no success was inferred from a dispatch. Filter
pagination first exposed the genuine 27/28 count mismatch and was fixed/replayed.
A second cancel after an already confirmed close was rejected as expected.
The first disconnect preflight stopped before injection because arm was not yet
observed. A subsequent settled preflight completed the real disconnect case.

Two new test tracks and their clips/devices were removed. Final readback: original
11-track count, bank offset 0, transport/recording off, tested original track
unmuted and disarmed, no injected notes/sustain, 1 s digital-silence capture.
Transport position finished at zero; the earlier position was not restored.
Existing fixtures from previous acceptance tranches remain. No project save or
reopen comparison was performed.

## Remaining parity and beyond

This is not blanket acceptance of every historical tool or the whole controller
API. Incoming poly-aftertouch mapping needs an explained positive test; pressure
is unavailable on the tested host; audible groove timing, broader concurrency,
all browser contexts, full per-tool matrix, persisted save/reopen and completed
musical arrangement remain separate work. MUE/Gemma autonomy has not been scored.
No fake cue-color setter, arbitrary text search, full MIDI export or tempo/key
analysis has been introduced. Detailed API coverage remains in the maintained
inventory and LIVE-01..20 acceptance plan.
