import type { BeatTwinCommand } from "@beat-twin/commands";

export type JsonSchema = { type: "object"; properties?: Record<string, unknown>; required?: string[]; additionalProperties: false };
const str = { type: "string", minLength: 1, maxLength: 128 };
const name = { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" };
const beat = { type: "number", minimum: 0, maximum: 4096 };
const length = { type: "number", exclusiveMinimum: 0, maximum: 1024 };
const instrumentId = { enum: ["drums", "bass", "chords", "lead"] };
const target = { trackId: str, clipId: str };
const note = { pitch: { type: "integer", minimum: 0, maximum: 127 }, velocity: { type: "integer", minimum: 0, maximum: 127 }, startBeat: beat, lengthBeats: length };
export const object = (properties: Record<string, unknown> = {}, required: string[] = []): JsonSchema => ({ type: "object", additionalProperties: false, properties, required });
export const identity = { songId: str, expectedRevision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } };
export type MusicalOperation = { name: string; description: string; schema: JsonSchema; command: BeatTwinCommand["type"] };
const operation = (name: string, description: string, command: BeatTwinCommand["type"], properties: Record<string, unknown>, required: string[]): MusicalOperation => ({ name: `nanodaw_${name}`, description, command, schema: object(properties, required) });
export const MUSICAL_OPERATIONS: readonly MusicalOperation[] = [
  operation("create_track", "Create an instrument track. Supply an id to reference it in later batch operations.", "CreateTrack", { id: str, name, instrumentId }, ["name", "instrumentId"]),
  operation("rename_track", "Rename an existing track.", "RenameTrack", { trackId: str, name }, ["trackId", "name"]),
  operation("set_track_instrument", "Select a built-in instrument for a track.", "SetTrackInstrument", { trackId: str, instrumentId }, ["trackId", "instrumentId"]),
  operation("delete_track", "Delete a track and ALL its clips and notes. Requires explicit browser review.", "DeleteTrack", { trackId: str }, ["trackId"]),
  operation("create_clip", "Create a MIDI clip on an existing or earlier-created track.", "CreateClip", { id: str, trackId: str, name, startBeat: beat, lengthBeats: length }, ["trackId", "name", "lengthBeats"]),
  operation("edit_clip", "Edit clip name, position or length. Shrinking across notes is rejected.", "UpdateClip", { ...target, name, startBeat: beat, lengthBeats: length }, ["trackId", "clipId"]),
  operation("duplicate_clip", "Duplicate a clip and its notes.", "DuplicateClip", { ...target, id: str, name, startBeat: beat }, ["trackId", "clipId"]),
  operation("delete_clip", "Delete a clip and ALL its notes. Requires explicit browser review.", "DeleteClip", target, ["trackId", "clipId"]),
  operation("add_note", "Add one MIDI note; use prepare_batch for grouped note edits.", "AddNote", { ...target, id: str, ...note }, ["trackId", "clipId", "pitch", "startBeat", "lengthBeats"]),
  operation("update_note", "Edit one identified MIDI note.", "UpdateNote", { ...target, noteId: str, ...note }, ["trackId", "clipId", "noteId"]),
  operation("delete_note", "Remove one identified MIDI note.", "RemoveNote", { ...target, noteId: str }, ["trackId", "clipId", "noteId"]),
  operation("transpose_clip", "Transpose every note in a clip; out-of-range MIDI pitches are rejected.", "TransposeClip", { ...target, semitones: { type: "integer", minimum: -48, maximum: 48 } }, ["trackId", "clipId", "semitones"]),
  operation("quantize_clip", "Quantize clip note starts to a beat grid.", "QuantizeClip", { ...target, gridBeats: { type: "number", minimum: 0.015625, maximum: 16 } }, ["trackId", "clipId", "gridBeats"]),
  operation("set_tempo", "Set the song tempo in BPM.", "SetTempo", { bpm: { type: "number", minimum: 30, maximum: 300 } }, ["bpm"]),
  operation("play", "Start browser audio playback of the current song after browser confirmation.", "StartPlayback", { positionBeats: beat }, []),
  operation("stop", "Stop browser song playback after browser confirmation.", "StopPlayback", {}, []),
  operation("set_playhead", "Move the song playback position.", "SetPlayhead", { positionBeats: beat }, ["positionBeats"]),
];
export const OPERATION_MAP = new Map(MUSICAL_OPERATIONS.map((entry) => [entry.name, entry]));
export const operationSchema = { oneOf: MUSICAL_OPERATIONS.map((entry) => object({ tool: { const: entry.name }, arguments: entry.schema }, ["tool", "arguments"])) };
const planId = { planId: str };
export const EXTRA_DEFINITIONS = [
  { name: "nanodaw_get_status", description: "Read browser connection health and declared capabilities. Does not start or mutate audio.", inputSchema: object(), readOnly: true },
  ...MUSICAL_OPERATIONS.map((entry) => ({ name: entry.name, description: `Prepare only: ${entry.description} Returns an exact plan for human confirmation in NanoDAW; does not execute.`, inputSchema: object({ ...identity, ...entry.schema.properties }, ["songId", "expectedRevision", ...entry.schema.required!]), readOnly: false })),
  { name: "nanodaw_prepare_batch", description: "Prepare 1-256 ordered musical operations as ONE atomic plan and browser confirmation. Use explicit ids for newly created tracks/clips/notes referenced later. Never executes.", inputSchema: object({ ...identity, operations: { type: "array", minItems: 1, maxItems: 256, items: operationSchema } }, ["songId", "expectedRevision", "operations"]), readOnly: false },
  { name: "nanodaw_get_plan", description: "Read an exact retained NanoDAW MCP review plan. Expired plans cannot be applied.", inputSchema: object(planId, ["planId"]), readOnly: true },
  { name: "nanodaw_get_execution_report", description: "Read pending, consumed, uncertain or completed execution status; never executes or retries.", inputSchema: object(planId, ["planId"]), readOnly: true },
  { name: "nanodaw_undo", description: "Prepare recovery of one successful MCP musical plan at its unchanged final revision. Recovery data expires with the original review. Browser confirmation is required; no blind undo of later user edits.", inputSchema: object({ ...identity, ...planId }, ["songId", "expectedRevision", "planId"]), readOnly: false },
  { name: "search_tools", description: "Search the NanoDAW tool catalog by literal terms in names/descriptions. Bounded deterministic paging. Catalog presence is not live browser readiness.", inputSchema: object({ query: { type: "string", maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 20 }, offset: { type: "integer", minimum: 0, maximum: 10000 } }), readOnly: true },
  { name: "call_tool", description: "Call one canonical NanoDAW tool. Preparation still requires human browser confirmation. Cannot call search_tools or call_tool, Bitwig tools or arbitrary methods.", inputSchema: object({ name: str, arguments: object() }, ["name"]), readOnly: false },
].map(({ readOnly, ...entry }) => ({ ...entry, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false } }));
// Generic arguments are validated using the target schema, not an empty-object schema.
EXTRA_DEFINITIONS.find((entry) => entry.name === "call_tool")!.inputSchema.properties!.arguments = { type: "object" };
