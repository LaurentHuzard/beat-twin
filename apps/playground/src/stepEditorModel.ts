import type { Clip, Note } from "@beat-twin/core";

export const STEP_EDITOR_STEP_COUNT = 16;
export const STEP_EDITOR_PITCH_MIN = 36;
export const STEP_EDITOR_PITCH_MAX = 84;

export const DRUM_STEP_LANES = Object.freeze([
  Object.freeze({ id: "kick", label: "Kick", pitch: 36 }),
  Object.freeze({ id: "snare", label: "Snare", pitch: 38 }),
  Object.freeze({ id: "closed-hat", label: "Closed hat", pitch: 42 }),
  Object.freeze({ id: "open-hat", label: "Open hat", pitch: 46 }),
]);

export function stepLengthBeats(clip: Clip): number {
  return clip.lengthBeats / STEP_EDITOR_STEP_COUNT;
}

export function stepStartBeat(clip: Clip, stepIndex: number): number {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= STEP_EDITOR_STEP_COUNT) {
    throw new Error(`step index must be between 0 and ${STEP_EDITOR_STEP_COUNT - 1}`);
  }
  return stepLengthBeats(clip) * stepIndex;
}

export function notesAtStep(
  clip: Clip,
  pitch: number,
  stepIndex: number,
): readonly Note[] {
  const start = stepStartBeat(clip, stepIndex);
  const end = start + stepLengthBeats(clip);
  return clip.pattern.notes.filter(
    (note) => note.pitch === pitch && note.startBeat >= start && note.startBeat < end,
  );
}

export function midiNoteName(pitch: number): string {
  const bounded = Math.min(127, Math.max(0, Math.round(pitch)));
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[bounded % 12]}${Math.floor(bounded / 12) - 1}`;
}
