import { useEffect, useRef, useState } from "react";
import { inspectMidiImport, MAX_MIDI_IMPORT_BYTES, type MidiImportPreview } from "./midiImport";
import { usePlaygroundStore } from "./store";

export function MidiImportPanel() {
  const commandState = usePlaygroundStore(state => state.commandState);
  const accept = usePlaygroundStore(state => state.acceptMidiImport);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { generation.current++; }, []);
  const [openNotes, setOpenNotes] = useState<number[]>([]);
  const [pending, setPending] = useState<{ preview: MidiImportPreview; revision: number; filename: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const clear = () => { generation.current++; setPending(null); setOpenNotes([]); setReading(false); setInputKey(key => key + 1); setTimeout(() => fileInput.current?.focus(), 0); };
  return <section aria-label="Import MIDI" className="midi-import-panel">
    <h3>Bring in a MIDI sketch</h3>
    <p>Preview a local MIDI file, then add its notes as new tracks. Your current tracks stay intact.</p>
    <label>Local MIDI file <input ref={fileInput} key={inputKey} type="file" accept=".mid,.midi,audio/midi" disabled={reading} onChange={async event => {
      const file = event.currentTarget.files?.[0];
      const request = ++generation.current, revision = commandState.revision;
      setPending(null); setOpenNotes([]); setError(""); setMessage("");
      if (!file) return;
      if (file.size > MAX_MIDI_IMPORT_BYTES) { setError("Choose a MIDI file no larger than 1 MiB."); setInputKey(key => key + 1); return; }
      setReading(true);
      try {
        const preview = inspectMidiImport(new Uint8Array(await file.arrayBuffer()));
        if (request === generation.current) setPending({ preview, revision, filename: file.name });
      } catch (cause) {
        if (request === generation.current) setError(cause instanceof Error ? cause.message : "MIDI preview failed.");
      } finally { if (request === generation.current) { setReading(false); setInputKey(key => key + 1); } }
    }} /></label>
    {reading ? <p role="status">Reading local MIDI…</p> : null}
    {pending ? <div>
      <p><strong>{pending.filename}</strong></p>
      <p>{pending.preview.tracks.length} new {pending.preview.tracks.length === 1 ? "track" : "tracks"} · {pending.preview.noteCount} {pending.preview.noteCount === 1 ? "note" : "notes"} · Source {pending.preview.bpm.toFixed(2)} BPM</p>
      <p>Note beat positions and lengths below are displayed to six decimal places.</p>
      <ul>{pending.preview.tracks.map((track, index) => <li key={index}>
        {track.name}: {track.notes.length} {track.notes.length === 1 ? "note" : "notes"}, {track.channel === 9 ? "Drums" : "Lead"}
        <details onToggle={event => {
          const open = event.currentTarget.open;
          setOpenNotes(current => open ? [...new Set([...current, index])] : current.filter(i => i !== index));
        }}>
          <summary>Review notes in {track.name}</summary>
          {openNotes.includes(index) ? <table aria-label={`Notes in ${track.name}`}>
            <thead><tr><th scope="col">Pitch</th><th scope="col">Velocity</th><th scope="col">Beat</th><th scope="col">Length</th></tr></thead>
            <tbody>{track.notes.map((note, noteIndex) => <tr key={noteIndex}><td>{note.pitch}</td><td>{note.velocity}</td><td>{Number(note.startBeat.toFixed(6))}</td><td>{Number(note.lengthBeats.toFixed(6))}</td></tr>)}</tbody>
          </table> : null}
        </details>
      </li>)}</ul>
      <p>{commandState.song ? `Current tempo stays at ${commandState.song.transport.bpm} BPM. Imported notes keep their beat positions.` : `A new song will use ${pending.preview.bpm.toFixed(2)} BPM.`}</p>
      {pending.preview.warnings.map(warning => <p key={warning}>{warning}</p>)}
      {commandState.revision !== pending.revision ? <p role="alert">Song changed since preview. Select the file again before adding tracks.</p> : null}
      <div className="storage-actions">
        <button type="button" disabled={commandState.revision !== pending.revision} onClick={() => {
          if (accept(pending.preview, pending.revision)) { clear(); setMessage("MIDI tracks added. Undo restores the previous song."); setError(""); }
          else setError(usePlaygroundStore.getState().lastError ?? "MIDI import failed.");
        }}>Add MIDI tracks</button>
        <button type="button" onClick={() => { clear(); setMessage("MIDI preview discarded. Song unchanged."); setError(""); }}>Discard MIDI preview</button>
      </div>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
