# Active Orbit: issue #79 runtime documentation contract

Activated: 2026-09-23
Branch: `fix/issue-79-node-26-doc-contract`
Base: `4e0a74da80025778faf25c3f806cb43126704a64`

## Outcome

Make Beat Twin expose one public, executable runtime prerequisite contract:
Node >=26.0.0 and pnpm 11.10.0 through Corepack, matching package metadata and
CI.

## Scope

- Align README and active runtime setup docs that still present Node 22/24 as
  supported.
- Explain the expected install warning/error when Node is below the declared
  engine floor.
- Add a dependency-free drift check covering package metadata, CI runtime and
  the active setup docs.
- Add focused regression coverage for the drift checker.
- Record exact verification and limits; do not rewrite historical run reports.

## Checks

- Characterize current main as failing the new runtime-contract check.
- Focused checker/test after the documentation change.
- Review the final GitHub diff for whitespace and accidental scope changes.
- Inspect CI status if GitHub Actions runs.

The canonical repository commands should run under the declared Node 26 / pnpm
runtime. If the execution environment cannot provide that toolchain or a local
checkout, report the limitation rather than claiming full pnpm/build/test
validation.

## Risks and stop conditions

- Historical evidence must remain historical rather than be mass-edited.
- No lowering of `engines.node`, no dependency updates, no provider/DAW/runtime
  execution, no deployment, no merge.
- Stop if a concurrent #79 PR appears or the default-branch runtime contract
  changes beneath this branch.
