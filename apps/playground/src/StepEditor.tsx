import { useState, type CSSProperties } from "react";
import { Copy, Drum, Music2, SlidersHorizontal } from "lucide-react";

import type { BeatTwinCommand } from "@beat-twin/commands";

import { findNextEmptyLauncherSlot } from "./launcherModel";
import {
  DRUM_STEP_LANES,
  midiNoteName,
  notesAtStep,
  STEP_EDITOR_PITCH_MAX,
  STEP_EDITOR_PITCH_MIN,
  STEP_EDITOR_STEP_COUNT,
  stepLengthBeats,
  stepStartBeat,
} from "./stepEditorModel";
import { usePlaygroundStore } from "./store";

const velocityPresets = Object.freeze([
  Object.freeze({ label: "Soft", value: 72 }),
  Object.freeze({ label: "Normal", value: 96 }),
  Object.freeze({ label: "Accent", value: 120 }),
]);

type EntryMode = "drums" | "pitched";
type EditMode = "toggle" | "velocity";

export function StepEditor() {
  const song = usePlaygroundStore((state) => state.commandState.song);
  const selectedTrackId = usePlaygroundStore((state) => state.selectedTrackId);
  const selectedClipId = usePlaygroundStore((state) => state.selectedClipId);
  const dispatch = usePlaygroundStore((state) => state.dispatch);
  const dispatchBatch = usePlaygroundStore((state) => state.dispatchBatch);
  const duplicateSelectedClipToNextLauncherSlot = usePlaygroundStore(
    (state) => state.duplicateSelectedClipToNextLauncherSlot,
  );
  const [entryMode, setEntryMode] = useState<EntryMode>("drums");
  const [editMode, setEditMode] = useState<EditMode>("toggle");
  const [pitch, setPitch] = useState(60);
  const [velocity, setVelocity] = useState(96);
  const [message, setMessage] = useState("Choose a lane and tap a step.");

  const track =
    song?.tracks.find((candidate) => candidate.id === selectedTrackId) ??
    song?.tracks[0] ??
    null;
  const clip =
    track?.clips.find((candidate) => candidate.id === selectedClipId) ??
    track?.clips[0] ??
    null;
  const emptySlot = track && clip ? findNextEmptyLauncherSlot(track, clip.id) : null;
  const lanes =
    entryMode === "drums"
      ? DRUM_STEP_LANES
      : [Object.freeze({ id: `pitch-${pitch}`, label: midiNoteName(pitch), pitch })];

  const editStep = (lanePitch: number, stepIndex: number) => {
    if (!track || !clip) return;
    const notes = notesAtStep(clip, lanePitch, stepIndex);
    let commands: readonly BeatTwinCommand[];
    if (editMode === "velocity") {
      if (notes.length === 0) {
        setMessage(`Step ${stepIndex + 1} is empty; add it before setting velocity.`);
        return;
      }
      commands = notes.map((note) => ({
        type: "UpdateNote" as const,
        trackId: track.id,
        clipId: clip.id,
        noteId: note.id,
        velocity,
      }));
    } else if (notes.length > 0) {
      commands = notes.map((note) => ({
        type: "RemoveNote" as const,
        trackId: track.id,
        clipId: clip.id,
        noteId: note.id,
      }));
    } else {
      commands = [
        {
          type: "AddNote",
          trackId: track.id,
          clipId: clip.id,
          pitch: lanePitch,
          velocity,
          startBeat: stepStartBeat(clip, stepIndex),
          lengthBeats: stepLengthBeats(clip),
        },
      ];
    }
    if (commands.length === 1) dispatch(commands[0]!);
    else dispatchBatch(commands);
    const error = usePlaygroundStore.getState().lastError;
    if (error) {
      setMessage(error);
      return;
    }
    setMessage(
      editMode === "velocity"
        ? `${velocity} velocity applied to step ${stepIndex + 1}.`
        : notes.length > 0
          ? `Step ${stepIndex + 1} cleared.`
          : `Step ${stepIndex + 1} added at velocity ${velocity}.`,
    );
  };

  return (
    <section className="step-editor" aria-label="16-step editor">
      <header className="step-editor-header">
        <div className="step-editor-title">
          <Drum size={21} aria-hidden="true" />
          <div>
            <p className="eyebrow">Pattern maker</p>
            <h2>16-step editor</h2>
            <p>
              {clip
                ? `${clip.name} · ${formatBeats(clip.lengthBeats)} beats · 16 steps · ${formatBeats(stepLengthBeats(clip))} beat/step`
                : "Select a clip to build a pattern."}
            </p>
          </div>
        </div>
        <div className="step-editor-actions">
          <button
            type="button"
            className="tool-button"
            disabled={!emptySlot}
            onClick={() => {
              if (!emptySlot) return;
              duplicateSelectedClipToNextLauncherSlot();
              const error = usePlaygroundStore.getState().lastError;
              setMessage(
                error ?? `Variation duplicated to launcher slot ${emptySlot.slotIndex + 1}.`,
              );
            }}
          >
            <Copy size={17} aria-hidden="true" />
            Duplicate to next empty slot
          </button>
          <a className="step-detail-link" href="#detailed-note-editor">
            <SlidersHorizontal size={16} aria-hidden="true" />
            Detailed numeric editor
          </a>
        </div>
      </header>

      <div className="step-editor-toolbar">
        <div className="step-segment" aria-label="Entry mode">
          <button
            type="button"
            aria-pressed={entryMode === "drums"}
            onClick={() => setEntryMode("drums")}
          >
            <Drum size={16} aria-hidden="true" /> Drums
          </button>
          <button
            type="button"
            aria-pressed={entryMode === "pitched"}
            onClick={() => setEntryMode("pitched")}
          >
            <Music2 size={16} aria-hidden="true" /> Pitched
          </button>
        </div>

        {entryMode === "pitched" ? (
          <label className="step-pitch-select">
            Pitch
            <select
              aria-label="Pitched step note"
              value={pitch}
              onChange={(event) => setPitch(Number(event.currentTarget.value))}
            >
              {Array.from(
                { length: STEP_EDITOR_PITCH_MAX - STEP_EDITOR_PITCH_MIN + 1 },
                (_, offset) => STEP_EDITOR_PITCH_MIN + offset,
              ).map((value) => (
                <option key={value} value={value}>
                  {midiNoteName(value)} · {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="step-segment" aria-label="Edit mode">
          <button
            type="button"
            aria-pressed={editMode === "toggle"}
            onClick={() => setEditMode("toggle")}
          >
            Add / remove
          </button>
          <button
            type="button"
            aria-pressed={editMode === "velocity"}
            onClick={() => setEditMode("velocity")}
          >
            Set velocity
          </button>
        </div>

        <div className="step-segment velocity-presets" aria-label="Velocity preset">
          {velocityPresets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              aria-pressed={velocity === preset.value}
              onClick={() => setVelocity(preset.value)}
            >
              {preset.label} <small>{preset.value}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="step-grid-scroll">
        <div className="step-grid" aria-label={`${entryMode} 16-step pattern`}>
          <div className="step-grid-header" aria-hidden="true">
            <span>Lane</span>
            {Array.from({ length: STEP_EDITOR_STEP_COUNT }, (_, stepIndex) => (
              <span key={stepIndex}>{stepIndex + 1}</span>
            ))}
          </div>
          {lanes.map((lane) => (
            <div className="step-grid-row" role="group" aria-label={`${lane.label} steps`} key={lane.id}>
              <strong>{lane.label}</strong>
              {Array.from({ length: STEP_EDITOR_STEP_COUNT }, (_, stepIndex) => {
                const notes = clip ? notesAtStep(clip, lane.pitch, stepIndex) : [];
                const active = notes.length > 0;
                const cellVelocity = active
                  ? Math.max(...notes.map((note) => note.velocity))
                  : velocity;
                const beat = clip ? stepStartBeat(clip, stepIndex) : 0;
                return (
                  <button
                    key={stepIndex}
                    type="button"
                    className={active ? "step-cell active" : "step-cell"}
                    style={{ "--step-strength": cellVelocity / 127 } as CSSProperties}
                    aria-pressed={active}
                    aria-label={`${lane.label}, step ${stepIndex + 1}, beat ${formatBeats(beat)}, ${active ? `active at velocity ${cellVelocity}` : "empty"}`}
                    disabled={!clip}
                    data-step={stepIndex + 1}
                    data-pitch={lane.pitch}
                    onClick={() => editStep(lane.pitch, stepIndex)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      editStep(lane.pitch, stepIndex);
                    }}
                  >
                    <span>{stepIndex + 1}</span>
                    {active ? <small>{cellVelocity}</small> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="step-editor-status">
        <p role="status">{message}</p>
        <small>
          {emptySlot
            ? `Next variation target: slot ${emptySlot.slotIndex + 1}, beat ${formatBeats(emptySlot.startBeat)}.`
            : "No later empty launcher slot; the selected clip will not be overwritten."}
        </small>
      </div>
    </section>
  );
}

function formatBeats(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");
}
