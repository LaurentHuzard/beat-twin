# MCP status and next steps (2026-01-29)

## What just broke
- Crash was caused by calling `setIndication` on `.value()` (a `RemappableRangedValueProxy`), which does not expose that method.
- Fix: call `setIndication` on the `Parameter` itself.

## What’s verified OK
- `Parameter.value().get()/set()/setRaw()` are valid (`SettableRangedValue`).
- `transport.tempo()` returns a `Parameter` (valid to access `.value()` for get/set).
- `transport.getPosition()` is a `SettableBeatTimeValue` (valid to `get()` / `set()`; `setRaw` is deprecated but still present).
- Most `markInterested()` calls are correct (they’re on `Value` types).

## Potential mismatch to check
- `scene.sceneIndex()` is used, but `Scene` does not expose it. That method exists on `ClipLauncherSlotOrScene`.
  - If we need a scene index, use the `ClipLauncherSlotOrScene` path or another source.

## Files to read next
- `bitwig-controller/BitwigPOC/BitwigPOC.control.js`
- `bitwig-api-docs/Parameter.md`
- `bitwig-api-docs/SettableRangedValue.md`
- `bitwig-api-docs/RangedValue.md`
- `bitwig-api-docs/Transport.md`
- `bitwig-api-docs/Scene.md`
- `bitwig-api-docs/ClipLauncherSlotOrScene.md`

## Next steps
1) Reload the controller in Bitwig to confirm the crash is gone.
2) Verify the `scene.sceneIndex()` usage (likely needs adjustment).
3) Quick pass for any other `.*value().setIndication`-style misuse.
