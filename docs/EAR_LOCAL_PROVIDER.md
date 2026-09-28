# Optional local Ear provider

This included provider is an explicitly started Linux companion to the existing Ear MCP
client. Importing it, starting the MCP server, requesting status, or listing
devices does **not** capture audio. It requires local `pactl` and `ffmpeg` with
Pulse support; PipeWire's Pulse compatibility service is supported.

## Start explicitly

Choose an output monitor from `pactl --format=json list sources`. A microphone,
`default`, or an unverified source is never selected automatically.

```sh
BITWIG_EAR_MONITOR_SOURCE='your.output.sink.monitor' \
  node --experimental-strip-types scripts/ear-local.ts
```

Then configure the separately launched MCP process:

```sh
BITWIG_EAR_BASE_URL='http://127.0.0.1:8765'
```

Enable the MCP `audio_capture` policy explicitly through the existing policy
configuration. The provider is bound to `127.0.0.1` only. Set `BITWIG_EAR_PORT`
to change the default `8765`. Stop it with Ctrl-C. No audio file is persisted.
The selected monitor captures the entire output sink, potentially including
other applications; it does not establish that a signal came from Bitwig.

## Endpoints and evidence

| Endpoint | Behavior |
| --- | --- |
| `GET /devices` | Lists available output monitors and their Pulse indices. |
| `POST /device/:index` | Selects an available monitor; resets cached levels. |
| `GET /levels` | Returns the last completed capture's levels and timestamp, or `not-yet-captured`. Never initiates capture. |
| `GET /listen?seconds=5` | Captures 1–10 integer seconds; returns base64 PCM WAV plus analysis. |
| `GET /analyze?seconds=1` | Captures 0.1–10 seconds; returns analysis without audio bytes. |

`ear_status` uses `/levels`, so service connectivity alone does not prove capture
or sound. Start an explicit analyze/listen request to measure the current output.

Payload schema `beat-twin-ear-pcm-v1` describes 48 kHz, stereo, signed 16-bit
little-endian PCM. RMS and peak are linear full-scale amplitudes; `rmsDbfs` and
`peakDbfs` are dBFS. Digital silence is zero PCM, with dBFS `null` representing
negative infinity. `clippedSamples` counts samples at the signed integer limits;
it is not a claim about earlier clipping in the signal chain. Musical analysis
is explicitly unsupported: BPM/key remain null. The Ear MCP adapter retains its
`external-unverified` envelope and does not certify this provider's DSP.

One operation involving local commands runs at a time; concurrent requests get
HTTP 409. Capture is limited to 10 seconds / 1,920,000 PCM bytes. Subprocesses
have byte/deadline bounds, use argv without a shell, and are killed when the
HTTP client disconnects. The provider verifies monitor availability before each
capture. A failed capture can have captured partial audio; such errors report
`captureAttempted: true, audioCaptured: null`. No result fabricates silence on
failure. HTTP rejects browser origins, foreign Host values, and request bodies;
it exposes no CORS headers. As with other local services, trusted local
processes can access it while it is running.

## Verification scope

`tests/ear-local-provider.test.ts` uses synthetic PCM and bounded dummy child
processes. Those checks establish parsing, math, WAV layout and process limits;
they are **not** live Pulse/PipeWire/Bitwig evidence. Real capture needs a
separate explicitly authorized run and source provenance.

## Authorized live capture evidence — 2026-09-28

All six MCP Ear tools were exercised against this provider: status, device list,
device selection, levels, listen and analyze. These are six tools over five HTTP
endpoint paths: status and levels both use `/levels`. A 3-second listen returned
a PCM WAV with 144000 stereo frames at 48000 Hz. Its reported RMS was
−12.2881 dBFS and peak −5.1315 dBFS. Independent ffmpeg measurement of that WAV
reported −12.3 dBFS mean and −5.1 dBFS peak, consistent at the displayed precision.

This establishes actual output-monitor capture, WAV framing and the measured
signal in that bounded run. That capture alone does not establish musical quality,
BPM/key, exclusive Bitwig provenance, or successful instrument loading.

A later end-to-end probe on the installed controller independently observed an
empty device inventory, inserted Polysynth through the browser and confirmed its
device identity. A four-beat clip with five notes was created and read back.
During playback, a separate three-second Ear capture contained 144000 frames,
peak −18.2917 dBFS and RMS −33.2474 dBFS. Captures before playback and for three
seconds after stopping showed digital silence. These combined observations
establish the tested insertion/clip/playback/capture workflow, not musical quality
or proof that every individual note rendered.

A separate MIDI exit/reload test still showed an audio tail around −40 dBFS at
nine seconds despite an empty tracker and sustain false after reload. It does
not prove immediate audible cleanup; the clip stop/silence result above must not
be substituted for that different scenario. Raw audio and local device/project
identities are not included in this public document.
