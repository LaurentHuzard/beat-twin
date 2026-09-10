# NanoDAW UI / Product Design

## Product identity

NanoDAW is a **small playable musical instrument**, not a miniature desktop DAW and not an administration interface for Beat Twin.

Its primary promise is simple:

> Open it, make sound immediately, build a loop, mutate it, and keep the musical flow alive.

The interface must optimize for:

1. playing;
2. musical feedback;
3. improvisation;
4. fast editing;
5. capturing useful accidents.

Architecture, command logs, JSON, adapters, revisions and agent protocols must remain inspectable, but they are not the product surface.

## Design principles

### Instrument before application

The main screen should feel closer to a groovebox, sampler or live looping instrument than to a CRUD application.

Large musical targets beat small informational widgets. Movement, rhythm and hierarchy are desirable. Administrative density is not.

### Hear first, configure later

The first useful interaction should produce music.

A new session should not begin with configuration choices. Primary first-run actions are:

- Start Jam
- Open Jam

Bitwig connection, import/export and advanced configuration are secondary surfaces.

### One dominant surface

At any moment, one musical activity owns most of the screen.

NanoDAW should not display Launcher + Step Editor + Timeline + Inspector + Agent + Logs simultaneously. Use progressive disclosure.

## Main information architecture

NanoDAW has three user-facing spaces.

### JAM

Default surface.

Purpose: perform, launch, record and transform loops.

Contains:

- global transport;
- 4 x 4 launcher;
- four track strips;
- four performance macros;
- recording state;
- scene launch controls;
- Capture Jam.

This view should comfortably occupy one laptop screen without vertical scrolling.

### EDIT

Purpose: modify musical material.

Contains:

- step sequencer;
- piano/note editor where appropriate;
- clip properties;
- instrument selection;
- quantize;
- transpose;
- duplicate / variation;
- timeline when useful.

Editing opens in place or in a focused lower panel. The launcher remains partially visible whenever possible so context is preserved.

### TWIN

Agent-assisted composition.

Twin is not a permanent dashboard panel. It is a contextual drawer opened from the side.

Examples:

- Make scene 3 darker.
- Give me a bass variation.
- Turn this 2-bar loop into 4 bars.

Agent proposals must appear as musical proposals, not protocol output.

A proposal should show:

- affected tracks/clips;
- musical summary;
- preview;
- Accept;
- Reject;
- Create Variation.

Technical tool calls belong in developer mode.

## Developer surfaces

The following are intentionally excluded from the normal workspace:

- command event log;
- raw JSON;
- adapter diagnostics;
- MCP details;
- revision information;
- Gateway status;
- internal message log.

Expose them through Settings -> Developer or an explicit Developer Mode.

Developer mode can be precise and extremely informative. The musical workspace cannot become an infrastructure console.

## Main layout

Desktop reference layout:

```text
+-------------------------------------------------------------------+
| BEAT TWIN      124 BPM      2.3.1        PLAY       Settings TWIN |
+--------------+--------------+--------------+--------------+-------+
|    DRUMS     |     BASS     |    CHORDS    |     LEAD     | SCENE |
+--------------+--------------+--------------+--------------+-------+
|    CLIP 1    |    CLIP 1    |    CLIP 1    |    CLIP 1    |   >   |
+--------------+--------------+--------------+--------------+-------+
|    CLIP 2    |    CLIP 2    |    CLIP 2    |    CLIP 2    |   >   |
+--------------+--------------+--------------+--------------+-------+
|    CLIP 3    |    CLIP 3    |    CLIP 3    |    CLIP 3    |   >   |
+--------------+--------------+--------------+--------------+-------+
|    CLIP 4    |    CLIP 4    |    CLIP 4    |    CLIP 4    |   >   |
+--------------+--------------+--------------+--------------+-------+
| TONE          SPACE          ECHO          REPEAT      CAPTURE JAM |
+-------------------------------------------------------------------+
```

The launcher is a matrix. Tracks are columns. Scenes are rows. Scene controls remain spatially attached to their row.

## Clip design

A clip slot is primarily an expressive control. Do not fill it with metadata.

Default contents:

```text
+------------------+
|                  |
|   KICK LADDER    |
|                  |
|  _|^^|_|^|__     |
|                  |
+------------------+
```

Optional micro-information:

- clip name;
- pattern silhouette;
- loop length.

Avoid permanent visible labels such as:

- `Slot 2`
- `idle`
- `16 notes`
- `Observed active`
- `Queued for bar 4`

Those belong in accessible labels, tooltips or diagnostics.

## State language

Performance state must be instantly readable.

### Empty

Quiet surface with a subtle add affordance.

### Idle clip

Visible identity, no visual noise.

### Queued

Distinct outline. Slow pulse toward the launch boundary. Optional small countdown such as `1 BAR`.

### Playing

Strong track colour. Loop-progress animation around or underneath the pad. Movement communicates that the musical engine is alive.

### Recording

Clearly different from playing. Record glyph plus animated edge. Never rely on red alone.

### Overdub

Playing state plus record overlay.

### Stop queued

Playing state remains visible while a secondary stopping indicator appears. The UI must communicate: still playing, but scheduled to stop.

## Transport

There is one global musical transport.

Do not expose separate competing product concepts such as preview transport, live transport and timeline transport.

Reference:

```text
PLAY  STOP       124 BPM       2 . 3 . 1       Q: 1 BAR
```

Clip audition inside EDIT is local to the editor and visually subordinate.

## Track strips

Each track gets a recognisable identity.

Recommended default roles:

1. Drums
2. Bass
3. Chords
4. Lead

Track identity may use colour, but colour must not encode semantic state alone.

Track controls should expose at minimum:

- name;
- level;
- mute;
- solo;
- instrument identity.

## Performance macros

The four global macros are central to NanoDAW's personality:

- Tone
- Space
- Echo
- Repeat

They should be large enough to grab during playback. Avoid tiny form controls.

Rotary controls, vertical gestures or horizontal performance faders are acceptable if keyboard and touch equivalents exist.

Macro movement should feel continuous.

## Visual direction

### Mood

Nocturnal studio. Hardware instrument. Digital, but tactile. Focused rather than decorative.

Avoid both extremes:

- enterprise SaaS dashboard;
- fake vintage synthesizer.

### Base palette

```text
Background          #101312
Raised surface      #171C1A
Secondary surface   #202622
Primary text        #F0F4EF
Secondary text      #8E9B94
```

### Track colours

Suggested direction:

- Drums: warm amber
- Bass: electric cyan
- Chords: violet
- Lead: mint / acid green

Colours should be vivid against the dark background without becoming fluorescent wallpaper.

### Semantic accents

- queued: amber;
- recording: coral / record red;
- error: red-orange;
- selection: high-luminance neutral outline.

## Typography

Use a modern sans-serif for labels and controls. Use tabular numerals for BPM, bar/beat, timing and note values.

Musical object names should be visually stronger than technical labels.

Prefer:

```text
KICK LADDER
4 bars
```

Instead of:

```text
SLOT 2 - PLAYING
Kick Ladder
16 notes
```

## Density

Performance controls are large. Technical information is small or hidden.

Minimum touch target: 44 x 44 px. Primary launcher pads should normally be considerably larger.

On desktop, maximise useful musical area instead of adding cards and padding around every feature.

## Borders and cards

Not every concept needs a card. Use spatial grouping, contrast and alignment before borders.

Avoid nested generic white/raised boxes. Launcher pads themselves provide enough structure for JAM mode.

## Motion

Motion has semantic value.

Allowed:

- loop progress;
- queued pulse;
- recording pulse;
- scene transition flash;
- smooth macro movement;
- playhead movement.

Avoid decorative motion unrelated to musical state. Respect `prefers-reduced-motion`.

## Interaction grammar

- Primary click/tap on populated clip: launch.
- Click playing clip: queue stop.
- Click empty slot: record/create.
- Scene button: launch scene.
- Double click or explicit edit affordance: open clip editor.
- Duplicate: create variation in next available slot.
- Long press on touch: context actions.

## Agent interaction

Twin should extend the musician's actions, not interrupt them.

During JAM, Twin can prepare material in unused slots. It must never silently replace audible material.

Suggested proposal UX:

```text
Twin prepared:

Bass / Scene 3
"Darker syncopated variation"

[Listen] [Put in slot] [Discard]
```

Agent operations use musical language first. Technical plan details are expandable.

## NanoDAW vs Bitwig

Target selection belongs in the shell, not inside the composition surface.

NanoDAW remains independently useful. Connecting Bitwig must not turn the composition interface into an infrastructure console.

## Responsive behaviour

### Wide desktop

Four tracks visible side by side.

### Small laptop

Keep four columns when usable. Prefer narrower labels and denser track headers before collapsing the musical matrix.

### Tablet

Performance-first layout, 4 x 4 pads with compact headers.

### Phone

Prefer two tracks at a time with horizontal paging rather than flattening every track vertically into unrelated cards. Scene relationships must remain visually understandable.

## Accessibility

State cannot depend solely on colour.

Every clip exposes an accessible state:

- idle;
- queued;
- playing;
- recording;
- overdubbing;
- stopping.

All essential functions work without hover. Keyboard operation remains first-class. Focus indication must remain highly visible.

## Progressive disclosure

Default experience:

```text
Transport
Launcher
Macros
```

One interaction deeper:

```text
Step editor
Clip properties
Instrument controls
Twin
```

Developer-only:

```text
Commands
Raw JSON
Gateway
MCP
Adapters
Event logs
Revision details
```

## Front-end implementation direction

Keep the current foundation:

- React;
- Vite;
- Zustand;
- Tone.js;
- Lucide.

Recommended additions:

- `react-aria-components` for accessible unstyled interaction primitives;
- `motion` for semantic musical animation and loop/queued/recording feedback;
- `@use-gesture/react` for tactile knobs and faders;
- `dnd-kit` later, when drag/drop becomes a real product requirement;
- `wavesurfer.js` later for real audio clips, not MIDI pattern previews.

Avoid adopting a large visually opinionated dashboard component library for JAM mode.

The majority of the visible instrument should remain custom NanoDAW components.

Initial component vocabulary:

```text
<Transport />
<LauncherMatrix />
<ClipPad />
<SceneButton />
<TrackStrip />
<MacroRack />
<MacroKnob />
<EditSurface />
<TwinDrawer />
<DeveloperTools />
```

## Definition of success

NanoDAW's UI redesign succeeds when a new user can:

1. open NanoDAW;
2. hear music;
3. launch a loop;
4. understand what is currently playing;
5. queue a variation;
6. change scene;
7. record something;
8. tweak a macro;
9. Capture Jam;

without seeing or understanding JSON, command batches, revisions, Gateway, MCP or adapters.

The internal architecture should remain rigorous. The musical experience should hide that rigor behind immediacy.

## Design mantra

> Keep the machinery deterministic. Make the surface musical.
