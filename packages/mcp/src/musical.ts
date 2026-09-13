import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createCommandState, materializeCommandBatch, type BeatTwinCommand, type ExecutableBeatTwinCommand } from "@beat-twin/commands";
import { validateDawCapabilities, validateDawSnapshot, type ExecutablePlan } from "@beat-twin/daw-contract";
import { deriveRequiredCommandScopes } from "@beat-twin/gateway-core";
import type { NanoDawMcpReview, NanoDawMcpServiceOptions } from "./index.ts";
import { EXTRA_DEFINITIONS, OPERATION_MAP } from "./catalog.ts";

export function createMusicalPreparation(context: {
  options: NanoDawMcpServiceOptions;
  token: string;
  id: () => string;
  getReview: (id: string) => NanoDawMcpReview | null;
  reserve: (id: string) => void;
  release: (id: string) => void;
  save: (review: NanoDawMcpReview) => void;
}) {
  const { options } = context;
  const validator = new AjvJsonSchemaValidator();
  const validators = new Map(EXTRA_DEFINITIONS.filter((tool) => OPERATION_MAP.has(tool.name) || ["nanodaw_prepare_batch", "nanodaw_undo"].includes(tool.name)).map((tool) => [tool.name, validator.getValidator(tool.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0])]));
  return async (name: string, input: Record<string, unknown>): Promise<NanoDawMcpReview> => {
    const encoded = JSON.stringify(input);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > 65536) throw new Error("invalid_arguments: input exceeds 64 KiB");
    const args = JSON.parse(encoded) as Record<string, unknown>;
    if (!validators.get(name)?.(args).valid) throw new Error("invalid_arguments: invalid musical input");
    const [capabilities, snapshot] = await Promise.all([options.adapter.capabilities(), options.adapter.inspect()]);
    if (!validateDawCapabilities(capabilities, "nanodaw").ok || !validateDawSnapshot(snapshot, "nanodaw", capabilities.capabilityVersion).ok) throw new Error("Invalid NanoDAW capabilities or snapshot");
    const original = snapshot.commandSnapshot;
    if (!original.song || args.songId !== original.song.id || args.expectedRevision !== original.revision) throw new Error("stale_revision: song identity or revision changed; inspect again");
    let commands: readonly ExecutableBeatTwinCommand[];
    let recovery: readonly ExecutableBeatTwinCommand[] = [];
    let label: string;
    if (name === "nanodaw_undo") {
      const source = context.getReview(args.planId as string);
      const status = options.planStore.getExecutionStatus(args.planId as string);
      if (!source?.recovery?.length || status?.state !== "completed" || !status.report?.ok || status.report.status !== "succeeded") throw new Error("Recovery unavailable: expected one retained successful musical plan");
      // Strict equality of snapshot content, not just the revision supplied by a client.
      if (status.report.finalSnapshot.revision !== original.revision || canonical(status.report.finalSnapshot) !== canonical(original)) throw new Error("stale_revision: later edits cannot be undone by this plan");
      commands = source.recovery;
      label = `Undo musical plan ${source.plan.planId}`;
    } else {
      const operations = name === "nanodaw_prepare_batch"
        ? args.operations as { tool: string; arguments: Record<string, unknown> }[]
        : [{ tool: name, arguments: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "songId" && key !== "expectedRevision")) }];
      let working = createCommandState(original.song, original.revision);
      const materialized: ExecutableBeatTwinCommand[] = [];
      const affectedTracks = new Set<string>();
      let tempoChanged = false;
      let transportChanged = false;
      for (const entry of operations) {
        const spec = OPERATION_MAP.get(entry.tool);
        if (!spec) throw new Error("Unknown musical operation");
        if ((spec.command === "UpdateClip" && !["name", "startBeat", "lengthBeats"].some((key) => key in entry.arguments)) || (spec.command === "UpdateNote" && !["pitch", "velocity", "startBeat", "lengthBeats"].some((key) => key in entry.arguments))) throw new Error("An edit must change at least one field");
        const command = { ...entry.arguments, type: spec.command } as BeatTwinCommand;
        const projection = materializeCommandBatch(working, [command], { idFactory: (scope) => `${scope}-${context.id()}` });
        if (!projection.ok) throw new Error(projection.error);
        const executable = projection.commands[0]!;
        if (executable.type === "CreateTrack") affectedTracks.add(executable.id);
        else if (executable.type === "SetTempo") tempoChanged = true;
        else if (["StartPlayback", "StopPlayback", "SetPlayhead"].includes(executable.type)) transportChanged = true;
        else affectedTracks.add((executable as { trackId: string }).trackId);
        materialized.push(executable);
        working = projection.state;
      }
      commands = materialized;
      const inverse: ExecutableBeatTwinCommand[] = [];
      for (const trackId of affectedTracks) {
        if (!original.song.tracks.some((track) => track.id === trackId) && working.song!.tracks.some((track) => track.id === trackId)) inverse.push({ type: "DeleteTrack", trackId });
      }
      original.song.tracks.forEach((track, index) => {
        if (affectedTracks.has(track.id)) inverse.push({ type: "RestoreTrack", track, index });
      });
      if (tempoChanged) inverse.push({ type: "SetTempo", bpm: original.song.transport.bpm });
      if (transportChanged) inverse.push({ type: original.song.transport.isPlaying ? "StartPlayback" : "StopPlayback", positionBeats: original.song.transport.positionBeats });
      recovery = inverse;
      label = `${operations.length} musical operation${operations.length === 1 ? "" : "s"}`;
    }
    // Bound generated payloads too: duplication/recovery may expand small inputs.
    if (Buffer.byteLength(JSON.stringify({ commands, recovery }), "utf8") > 262144) throw new Error("Generated plan and recovery exceed 256 KiB; split the edit");
    const projection = materializeCommandBatch(createCommandState(original.song, original.revision), commands);
    if (!projection.ok) throw new Error(projection.error);
    const requiredScopes = deriveRequiredCommandScopes(commands);
    if (commands.some((command) => !capabilities.supportedCommands.includes(command.type)) || requiredScopes.some((scope) => !capabilities.scopes.includes(scope))) throw new Error("NanoDAW does not support this plan");
    const requestId = `mcp-${context.id()}`;
    const planId = `plan-${context.id()}`;
    context.reserve(planId);
    try {
      const plan: ExecutablePlan = await options.planStore.createPlan({ token: context.token, plan: { planId, requestId, adapterId: "nanodaw", capabilityVersion: capabilities.capabilityVersion, baseRevision: original.revision, commands, requiredScopes } });
      const review: NanoDawMcpReview = { patch: null, title: label, preview: { summary: [label, `Song: ${original.song.title}`, "Prepared only. Review every change, then confirm in NanoDAW."], commands }, plan, recovery };
      context.save(review);
      return context.getReview(planId)!;
    } finally {
      context.release(planId);
    }
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
