// Independently handcrafted SMF; parser and exporter are not involved.
export function fixtureMidi(events: number[] = [
  0, 255, 81, 3, 7, 161, 32, // 120 BPM
  0, 255, 3, 4, 83, 101, 101, 100, // track name Seed
  0, 144, 60, 100, 96, 60, 0, // running note-off after one beat
], format = 0, ppq = 96): Uint8Array {
  const data = [...events, 0, 255, 47, 0];
  return Uint8Array.from([77,84,104,100,0,0,0,6,0,format,0,1,ppq >> 8,ppq & 255,
    77,84,114,107,0,0,(data.length >> 8) & 255,data.length & 255,...data]);
}
