# NanoDAW MCP musical catalog (#72)

The standalone NanoDAW MCP server exposes 27 tools, including its three original
instruments/inspect/instrument-clip tools. The new catalog is enabled by default
in this server. It does not depend on BITWIG_MCP_TOOL_DISCOVERY and does not
change the Bitwig server or the model-visible V1/V2 provider projections.
Restart the NanoDAW MCP process, re-pair the browser (the NanoDAW token now
includes transport.write for confirmed playback), and refresh the MCP client's tool list after
installing the new build. The existing pairing and browser connection setup in
[NANODAW_MCP.md](NANODAW_MCP.md) still applies.

## Discover, inspect, prepare, review

1. Open NanoDAW and choose Start Jam (or load a saved song). The original
   `nanodaw_prepare_instrument_clip` can also prepare the initial song/track.
2. Pair the browser with the standalone MCP process.
3. Call `nanodaw_get_status` and `nanodaw_inspect`. Health describes the connected
   browser, not audible quality. Capabilities are declared support, not proof of
   playback. Keep the returned song id and revision.
4. Search the catalog and call a tool directly or through `call_tool`.
5. Select the incoming proposal in TWIN. Inspect the exact musical changes,
   including deletions, and click **Confirm and apply once**.
6. Read `nanodaw_get_execution_report` and inspect again before the next edit.
   No MCP tool confirms, executes or retries a plan autonomously.

```json
{"name":"search_tools","arguments":{"query":"clip","limit":10,"offset":0}}
```

```json
{
  "name":"call_tool",
  "arguments":{
    "name":"nanodaw_create_track",
    "arguments":{
      "songId":"SONG_ID_FROM_INSPECT",
      "expectedRevision":1,
      "id":"demo-bass",
      "name":"Night Bass",
      "instrumentId":"bass"
    }
  }
}
```

The example revision is illustrative: always substitute the current inspection.
Preparation validates the song identity and revision and projects the complete
batch before storing a plan. The browser checks the expected revision again at
application time. Preparation changes neither the song nor audio.

## Tool inventory

Every musical edit below returns a preparation plan. `songId` and
`expectedRevision` are required on the new edit/transport tools.

| Tool | Additional arguments / behavior |
| --- | --- |
| `nanodaw_list_instruments` | Existing built-in instrument catalog |
| `nanodaw_inspect` | Existing browser song/revision inspection |
| `nanodaw_prepare_instrument_clip` | Existing strict SongPatchV2 input; unchanged shape |
| `nanodaw_get_status` | Browser health, capabilities and confirmation boundary |
| `nanodaw_create_track` | name, instrumentId; optional id for later references |
| `nanodaw_rename_track` | trackId, name |
| `nanodaw_set_track_instrument` | trackId, instrumentId |
| `nanodaw_delete_track` | trackId; deletes all contained clips/notes |
| `nanodaw_create_clip` | trackId, name, lengthBeats; optional id/startBeat |
| `nanodaw_edit_clip` | trackId, clipId; at least one name/startBeat/lengthBeats |
| `nanodaw_duplicate_clip` | trackId, clipId; optional id/name/startBeat |
| `nanodaw_delete_clip` | trackId, clipId; deletes contained notes |
| `nanodaw_add_note` | trackId, clipId, pitch, startBeat, lengthBeats; optional id/velocity |
| `nanodaw_update_note` | trackId, clipId, noteId; at least one pitch/velocity/startBeat/lengthBeats |
| `nanodaw_delete_note` | trackId, clipId, noteId |
| `nanodaw_transpose_clip` | trackId, clipId, semitones |
| `nanodaw_quantize_clip` | trackId, clipId, gridBeats |
| `nanodaw_set_tempo` | bpm |
| `nanodaw_play` | optional positionBeats |
| `nanodaw_stop` | no additional arguments |
| `nanodaw_set_playhead` | positionBeats |
| `nanodaw_prepare_batch` | operations: ordered array of {tool, arguments} |
| `nanodaw_get_plan` | planId; retained exact preview/plan |
| `nanodaw_get_execution_report` | planId; pending/consumed/completed/uncertain status |
| `nanodaw_undo` | planId of the successful musical plan to recover |
| `search_tools` | optional query, limit, offset |
| `call_tool` | name, optional arguments object |

Search matches all whitespace-separated terms literally and case-insensitively
against names/descriptions. Results contain canonical descriptions, schemas and
annotations, `total`, and `nextOffset` (null at the end). Generic wrappers do
not appear in search results. Neither wrapper can invoke another wrapper,
Bitwig tools, arbitrary methods, or NanoDAW confirmation/execution.

## One grouped musical plan

Arguments for `nanodaw_prepare_batch`:

```json
{
  "songId":"SONG_ID_FROM_INSPECT",
  "expectedRevision":1,
  "operations":[
    {"tool":"nanodaw_create_track","arguments":{"id":"demo-bass","name":"Night Bass","instrumentId":"bass"}},
    {"tool":"nanodaw_create_clip","arguments":{"trackId":"demo-bass","id":"demo-verse","name":"Verse","lengthBeats":4}},
    {"tool":"nanodaw_add_note","arguments":{"trackId":"demo-bass","clipId":"demo-verse","pitch":36,"velocity":110,"startBeat":0,"lengthBeats":1}},
    {"tool":"nanodaw_add_note","arguments":{"trackId":"demo-bass","clipId":"demo-verse","pitch":39,"velocity":96,"startBeat":2,"lengthBeats":1}},
    {"tool":"nanodaw_set_tempo","arguments":{"bpm":118}}
  ]
}
```

Add drum/chord track operations to the same batch for a multipiste groove.
Operation arguments omit the outer identity/revision. Earlier explicit ids can
be referenced later in the batch. Generated ids appear in the resulting plan.
Batch operations are only the 17 musical operations, never another batch,
undo, inspection, discovery or generic dispatch. Grouped note editing uses the
same ordered batch rather than a second note editing engine.

## Playback and recovery semantics

Confirmed playback uses the browser's shared exclusive audio engine to audition
the current MIDI arrangement across instrument tracks. Clips use their document
positions; the complete arrangement loops at its last clip end. The playhead is
a start offset, not a continuously persisted clock. Instrument identities are
preserved. This does not launch the JAM scene matrix or implement the 4x4 issue.

JAM/EDIT and MCP song audition cannot simultaneously own the audio engine. Stop
other audio first. Browser autoplay failure, unsupported/empty material or lease
conflicts reject playback rather than report success. Audio is prepared before
the document batch; CAS is rechecked after the asynchronous preparation. Any
failure after dispatch remains uncertain through the existing adapter contract.

TWIN displays song audition activity and a human **Stop song audio** button.
Disabling/disconnecting the panel or unmounting releases its audio lease; local
song edits stop an active audition. An edit confirmed while song playback is
active re-prepares the audible arrangement from the resulting document. No
listening quality or remote provider success is implied by a document report.

`nanodaw_undo` prepares recovery of one retained successful musical plan. It
requires the exact final revision AND snapshot from that plan's verified report.
A later edit, uncertain/failed/pending outcome or expired recovery is rejected.
The stored recovery contains original affected tracks and changed transport/
tempo values, never a second independently mutable song. Original tracks are
restored once each with exact instrument, clip/note content and ordering.
Recovery has its own preview, confirmation and one revision; it does not pop
unrelated browser undo history. Native browser undo/redo remain available.
The legacy SongPatchV2 tool does not gain MCP recovery; recovery of a recovery
plan is not offered.

## Bounds and failure handling

- Input JSON: 64 KiB UTF-8 per direct/generic call; no type coercion or unknown fields.
- Search: query <=200 characters, limit 1–20 (default 10), offset 0–10000.
- Batch: 1–256 operations; generated commands + recovery <=256 KiB.
- At most 32 retained review records, including completed plans needed for recovery;
  plans/recovery expire after two minutes. Process restart clears in-memory reviews.
- IDs <=128 characters; names <=200; tempo 30–300 BPM; beat positions <=4096;
  lengths <=1024 beats; transposition -48..48; MIDI pitch/velocity 0..127.
- Audio audition: <=32 instrument tracks, <=8192 notes, arrangement <=4096 beats.
- Clip shrink across existing notes is rejected: remove/shorten notes explicitly.
- `unknown_tool`, `recursive_tool_call`, `invalid_arguments`, `stale_revision`
  classify wrapper/identity errors. Existing service failures retain
  `tool_call_failed`. MCP errors use `isError: true`.
- Lost/uncertain execution replies are never retried automatically. Inspect and
  reconcile the existing execution status before proposing any new mutation.

## Acceptance scenario

Inspect → search → prepare a grouped groove → review/confirm → inspect/report →
prepare play → review/confirm → duplicate/transpose a clip → review/confirm →
delete a clip → review/confirm → prepare undo of that deletion → review/confirm →
prepare stop → review/confirm. Inspect the current revision between plans.

Offline tests and a disposable browser using a simulated Gateway establish
implementation behavior. A live MCP client/Gateway session with real provider,
audio listening acceptance (#36), launcher expansion (#29), mix/macros (#32),
Capture Jam (#33) and Live endurance (#34) remain separate evidence/work.
