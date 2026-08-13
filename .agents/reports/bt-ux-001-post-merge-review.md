# BT-UX-001 — Post-merge review follow-up

Date: 2026-08-12
State: exact-head CI passed; squash-merged as PR #56 at `2a59406`

PR #55 passed exact-head CI and squash-merged as `9944ff8`. The independent
review arrived after that decision and found two follow-ups:

- first-run actions removed the focused control without moving focus into the revealed workspace;
- queue, plan, and report still described the already-merged tranche as local/unpublished.

Every first-run entry action now transfers focus to the stable main workspace
after rendering. Desktop and mobile E2E assert focus after both explicit reveal
and Create Demo. Governance now records the exact merged state.

No audio, Bitwig, Gateway, MCP, S25, deployment, or external write changed.
