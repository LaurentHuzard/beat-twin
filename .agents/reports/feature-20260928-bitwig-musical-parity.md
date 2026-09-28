# BT-MCP-PORT-006 — Historical wiring and musical API extensions

Date:2026-09-28. Fresh fetched/remote-confirmed base:
f2191707b690c4c7973273d8cd1bd0978a924643 (PR98).
Branch:agent/bitwig-musical-parity-20260928. User authorizes continued parallel
implementation/publication and explicitly defers real Bitwig tests.

## Source delivery

26 additional tools:187 direct tools /42 default reads. Four discovery wrappers
are opt-in (191 total with every policy). Original57 schemas/policies remain
protected. Historical164-name matrix reconciles161 direct entries plus two
optional wrappers; one direct name has an explicitly replaced browser-filter
contract and six use an external Ear adapter. Cue-color write remains unsupported.
This is source coverage, not163 verified live musical capabilities.

Optional MIDI profile uses one input/zero outputs and a distinct UUID, generated
from the same source/modules as the unchanged-identity zero-port profile. Notes
and hold pedals have leases, per-voice tokens and real release callbacks; exit and
disconnect cleanup do not depend on later policy state. Physical-input notes are
not tracked as injected voices. Routing and audible release remain live checks.

New creative tools cover note expressions, observed browser filters/paging,
remote pages and arranger-loop range. Pending values are never assumed refreshed
merely because a fixed number of flush cycles elapsed. Individual unavailable
result/parameter fields remain explicit and cannot authorize a stale target write.

Ear has an optional local HTTP client, not a bundled capture/DSP service. Every
Ear operation requires audio_capture and explicit literal-loopback configuration.
Bounded JSON remains opaque. MIDI configuration/injection requires midi_write.
No default audio capture, service connection or controller installation occurs.

## Review and corrections

Three agents own core/MIDI, creative API module and MCP/Ear. Coordinator integrates
build, package, registry counts, durable API inventory and deferred live plan.
Cross-review found and corrected Ear policy revocation after network awaits;
remote/browser stale fields after transitions; cue-like bank index assumptions in
browser navigation; and Java nested enum versus Bitwig JavaScript NoteExpression.
No wrong-target fallback or retries of uncertain musical edits are added. Bounded
release retries concern note cleanup only. Partial edits count actual dispatched
setters and require readback/recovery, not rollback claims.

Source modules are ES5-compatible TypeScript. The build computes all generated
outputs before writing, verifies one MIDI flag marker and emits self-contained
standard/MIDI controllers plus the MCP and Ear runtimes. Tests compare generated
profiles with maintained source and verify both identities/port declarations.

## Verification

- Full offline suite:454 passed, zero failures/skips.
- Focused MCP/Ear/matrix/regression:107 passed; MIDI+generated profiles:20 passed.
- Typecheck passed. Architecture:16 workspaces,44 runtime edges, no violations.
- Distribution:30 packed artifacts,42 read-only tools,zero DAW calls.
- Syntax checks passed for MCP, Ear and both generated controller profiles;
  git diff --check passed.
- Independent creative/MIDI reviews found no remaining blocker in this scope.
- GitHub Actions is disabled (queried live); these are local checks, not remote CI.

## Real-session follow-up

`docs/BITWIG_LIVE_ACCEPTANCE.md` contains20 scenarios, per-tool evidence fields,
recovery checks and a musical end-to-end pass. All are NOT RUN. In particular:
observer delivery for unchanged values, drum-parent selection, live MIDI routing,
cleanup after route changes, browser loaded-device identity, actual audio and Ear
payload semantics remain unverified. Unsupported cue color stays unsupported.

No live controller reload/install, DAW action, playback, capture/listening, model
inference or completed-song claim. Main checkout and existing worktrees preserved.
Publication and merge are authorized; the attached PR records the reviewed head
and merge outcome. Live acceptance remains deferred regardless of merge status.
