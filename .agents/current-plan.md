# BT-MCP-PORT-006 — MIDI, Ear integration and musical API extensions

Continuing user authorization: recover historical parity, extend useful musical
API coverage, publish reviewed offline tranches. Real Bitwig tests remain deferred.
Fresh fetched/remote-confirmed base:f2191707b690c4c7973273d8cd1bd0978a924643,
PR98 merged. Isolated branch:agent/bitwig-musical-parity-20260928.

## Scope

Historical MIDI8 implemented through optional generated MIDI controller profile,
with status and panic helpers; original zero-port profile retained. Dedicated
midi_write policy, bounded note leases and actual scheduled note-offs/cleanup.
Six Ear adapters use an explicitly configured local external HTTP service and
audio_capture policy, bounded errors/timeouts/results. No service startup/capture.
Clip-slot alias plus historical discovery wrappers preserve current validation.

Beyond historical: note-expression read/update, observed browser filter items,
item selection and bank paging, remote-page read/select, arranger-loop read/set.
Browser_set_filter intentionally replaces an invalid text-search contract with
observed column/item selection. Cue-color remains unsupported by public API;
no fake success or blind UI fallback. All original57schemas/policies preserved.

## Parallel ownership

- application_contract: core controller TS, new MIDI module and its tests;
  hook creative module into core init/flush/dispatch and relevant browser handlers.
- api_inventory: new creative controller module and creative tests only.
- historical_audit: index.ts, Ear TS client, MCP and Ear tests only.
- Coordinator: generated build/profile, package/count integration, documentation,
  matrix/API inventory, real-session acceptance plan, checks/review/publication.

Controller modules remain ES5-compatible TypeScript, concatenated by build into
self-contained generated controller outputs. API15 retained. New policies hidden
by default. No install/reload/live test/audio capture/model call.

## Verification

Focused/full offline tests; API signature/range review; hostile inputs, stale
snapshots, partial mutation and timer cleanup tests. Typecheck, architecture,
distribution/profile checks, syntax and diff checks. Source parity is distinct
from external-service readiness and actual DAW acceptance.

## Outcome

Implementation and independent review complete:454 offline tests, typecheck,
architecture and distribution checks pass.187 direct tools,42 default reads;
four optional discovery wrappers. See the loop report for evidence and limits.
Publication is authorized and tracked by the attached PR. Live acceptance is
deferred; docs/BITWIG_LIVE_ACCEPTANCE.md contains the unexecuted scenario plan.
