# Beat Twin Product Constitution

## Mission

Help musicians turn intent into inspectable local song edits while keeping the
human in control of model proposals, NanoDAW state, and every DAW mutation.

## Golden Path

```text
musician opens standalone NanoDAW
  -> creates or loads a local sketch
  -> optionally requests a bounded agent proposal
  -> reviews the exact patch and executable plan
  -> explicitly confirms the selected target
  -> the adapter executes within declared bounds
  -> readback and an execution report show what happened
```

## Invariants

1. The browser is the only owner of NanoDAW song state.
2. Standalone NanoDAW remains useful without Bitwig, MCP, Gateway, or S25.
3. Model output is a proposal, never confirmation or execution authority.
4. Bitwig writes remain blocked until target identity, authentication, strict
   bounds, explicit confirmation, and readback are proven.
5. Read-only and write-capable surfaces remain visibly distinct.
6. Offline tests never claim live controller, Bitwig, Gateway, or model success.
7. Uncertain execution outcomes fail closed and require reconciliation.

## Sensitive Data

Song documents, MIDI notes, project names, DAW session state, pairing tokens,
provider endpoints, audit events, and local paths may be sensitive. They must not
be uploaded to undeclared services or included in public reports by default.

## Prohibited Automation

- autonomous DAW writes or confirmation;
- silent target switching;
- exposing the unauthenticated controller bridge to untrusted networks;
- automatic merge, publication, deployment, or branch deletion;
- treating model fluency or token volume as product success.

## Definition Of Done

A Beat Twin loop is done when its bounded user outcome is demonstrated, relevant
offline checks pass, live checks are separately identified, safety gates are
preserved, documentation is aligned, and the remaining human action is explicit.
