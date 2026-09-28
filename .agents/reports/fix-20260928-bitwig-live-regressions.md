# BT-MCP-LIVE-FIX-001 — Live regression corrections

Date: 2026-09-28. Remote base: `4fe22572e4d3e0270f2be2a37b7dcdf25256d65d`.
This is a bounded corrective pass after the real acceptance campaign, not a
claim of complete historical or Controller API acceptance.

## Changes

- Replace computed channel method lookup with explicit calls, avoiding the
  Java bean/property interop failure encountered on track pan.
- Use `Project.createScene()` (API 13), with stopped transport/recording and an
  observed, settled scene count before dispatch. A fresh count callback and the
  expected increment are required afterward. API 15 remains selected.
- Use `setImmediately()` (API 4) for absolute normalized software writes. The
  initial interop correction removed the pan exception but its ordinary `set()`
  still produced no observed change. Immediate dispatch fixes that live case and
  the analogous master/remote case, while retaining validation and readback.
- Keep independent read-only diagnostics accessible during creative mutations.
  A ten-second observation deadline marks uncertainty and retains the write
  barrier until controller reload. Late matching callbacks do not reopen it.
  Project summary exposes optional `creativeMutation`; object-shaped creative
  reads include `mutation`. Array results retain their existing shape.
- Cancel an observed browser session without requiring results or selection.
  Commit retains its stricter result identity checks.
- Reject negative velocity translation entries at both MCP and controller
  boundaries. Real incoming tests showed that velocity `-1` did not filter;
  key `-1` support remains. No silent conversion to zero or event-drop claim.

## Verification

- `pnpm test`: **465 passed**, zero failed/skipped.
- `pnpm typecheck`: passed.
- `pnpm check:architecture`: 16 workspaces / 44 internal edges, no violations.
- Packed distribution smoke: 30 artifacts, 42 default read-only tools, no DAW
  calls. Both generated controller profiles and MCP distribution regenerated.
- Syntax checks and `git diff --check`: passed.
- Independent review checked uncertainty/write guards, scene observation and
  identity, metadata compatibility and the limits of JavaScript mocks.

The real replay used Bitwig 6.1.1 and the separately enabled MIDI profile on an
explicitly authorized disposable project. One coordinator performed all live
writes; three subagents worked only on source, tests and review.

| Live case | Result |
| --- | --- |
| Track pan set/read/restore | Passed after immediate-dispatch correction |
| Master volume set/read/restore | Passed |
| One available remote parameter set/read/restore | Passed |
| Scene create/read/delete/read | Passed; temporary scene removed |
| Browser cancel with result metadata unavailable | Passed; closed state read back |
| Pressure mutation with no confirmed outcome | Independent reads remained available; timeout became explicit uncertainty; further write rejected; panic still worked |
| Reload after uncertainty | Fresh controller instance, normal operations recovered |
| Negative velocity translation | Rejected by MCP and by a direct controller request |

53 MCP calls over 24 distinct names were recorded for this corrective replay,
plus separate controller identity/validation/panic probes. Those counts are not
acceptance scores. Five error replies include three remaining observation
limitations and two expected refusals. Raw calls contain private project data
and stay in ignored local artifacts; no raw captures or session data are
included in this report or publication.

Final live checks: transport and recording stopped, no tracked injected notes,
no pending hold, panic successful, no creative uncertainty after reload.
Pan/master/remote values restored to their observed pre-test values. This does
not claim full project restoration: the authorized disposable test clip retains
expression edits, and controller selection/arming can change on reload.

## Remaining limitations

- Pressure setter/getter/callback behavior is still inconsistent. A matching
  cached getter alone is not proof; this fix bounds and exposes uncertainty.
- Browser result/filter and remote-page retargeting can stay unavailable when
  unchanged fields do not emit fresh callbacks. Cancellation is fixed; sound
  loading and arbitrary remote-page writes are not declared validated.
- Groove/send zero-valued observations remain unavailable in the tested host.
  Installed host bytecode suppresses initial default numeric callbacks and only
  notifies on changes; using `Parameter.value()` delegates to the same observer.
  No guessed initialization flag or display-string fallback was added.
- Ear, musical MPE and controller disconnect/exit acceptance remain separate.

These remaining cases require another bounded observation-contract pass and
real replay. They must not be reclassified as successes from offline tests.
