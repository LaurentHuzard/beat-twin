import type { Song, TrackKind } from "@beat-twin/core";

export type ScheduledNoteEvent = {
  readonly id: string;
  readonly songId: string;
  readonly bpm: number;
  readonly trackId: string;
  readonly trackName: string;
  readonly trackKind: TrackKind;
  readonly trackIndex: number;
  readonly clipId: string;
  readonly clipName: string;
  readonly clipIndex: number;
  readonly noteId: string;
  readonly noteIndex: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly endBeat: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly endSeconds: number;
};

export function secondsPerBeat(bpm: number): number {
  return 60 / assertPositiveFiniteNumber(bpm, "bpm");
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return assertFiniteNumber(beats, "beats") * secondsPerBeat(bpm);
}

export function beatToSeconds(beat: number, bpm: number): number {
  return beatsToSeconds(beat, bpm);
}

export function scheduleSongNotes(song: Song): readonly ScheduledNoteEvent[] {
  const bpm = assertPositiveFiniteNumber(song.transport.bpm, "song transport bpm");
  const events: ScheduledNoteEvent[] = [];

  song.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      clip.pattern.notes.forEach((note, noteIndex) => {
        const startBeat = clip.startBeat + note.startBeat;
        const durationBeats = note.lengthBeats;
        const endBeat = startBeat + durationBeats;
        const startSeconds = beatToSeconds(startBeat, bpm);
        const durationSeconds = beatsToSeconds(durationBeats, bpm);
        const endSeconds = startSeconds + durationSeconds;

        events.push(
          Object.freeze({
            id: `${track.id}:${clip.id}:${note.id}`,
            songId: song.id,
            bpm,
            trackId: track.id,
            trackName: track.name,
            trackKind: track.kind,
            trackIndex,
            clipId: clip.id,
            clipName: clip.name,
            clipIndex,
            noteId: note.id,
            noteIndex,
            pitch: note.pitch,
            velocity: note.velocity,
            startBeat,
            durationBeats,
            endBeat,
            startSeconds,
            durationSeconds,
            endSeconds,
          }),
        );
      });
    });
  });

  events.sort(compareScheduledNoteEvents);

  return Object.freeze(events);
}

function compareScheduledNoteEvents(left: ScheduledNoteEvent, right: ScheduledNoteEvent): number {
  return (
    compareNumber(left.startBeat, right.startBeat) ||
    compareNumber(left.trackIndex, right.trackIndex) ||
    compareNumber(left.clipIndex, right.clipIndex) ||
    compareNumber(left.noteIndex, right.noteIndex) ||
    left.id.localeCompare(right.id)
  );
}

function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
}

function assertPositiveFiniteNumber(value: number, label: string): number {
  const finiteValue = assertFiniteNumber(value, label);
  if (finiteValue <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }

  return finiteValue;
}
