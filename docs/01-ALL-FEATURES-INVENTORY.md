# Bitwig MCP Server - Complete Feature Inventory

## Overview
This document catalogs all capabilities that can be exposed through the MCP server based on the Bitwig Controller API (300+ documented APIs).

---

## 1. TRANSPORT CONTROL
- Play / Pause / Stop
- Restart playback
- Loop mode (toggle, length, position)
- Tempo (get/set)
- Time signature (get/set)
- Record arm / enable recording
- Record quantization settings
- Tap tempo
- Follow action mode

---

## 2. TRACK MANAGEMENT
- Create track (audio, instrument, return, master)
- Delete track
- Get track count & list
- Track properties:
  - Name (get/set)
  - Volume (get/set)
  - Pan (get/set)
  - Mute/Solo/Arm (get/set)
  - Input routing
  - Output routing
  - Track type
  - Monitor mode
- Track reordering
- Track visibility
- Track color
- Track auto-arm
- Track scrolling in arrange/mixer

---

## 3. DEVICE CHAIN & PARAMETERS
- Browse devices (categories, subcategories, presets)
- Load device on track
- Delete device
- Get device list & info
- Device parameters:
  - Get parameter value
  - Set parameter value
  - Get parameter range/steps
  - Parameter modulation depth
  - Parameter macros
- Device presets:
  - Load preset
  - Save preset
  - Get preset list
- Device bypass
- Device minimized state
- Device window visibility
- Device macro mapping
- Device remote controls

---

## 4. MIXER & SENDS
- Master track access
- Track volume faders
- Track pan
- Stereo balance
- Channel strips
- Send levels (get/set)
- Send routing
- Return tracks
- Master volume
- Master cue level
- Meter readings (peak, RMS)
- VU meter state
- Track insert effects
- Crossfader assignment
- Crossfader position

---

## 5. CLIP LAUNCHER & SCENES
- Clip slots (status, triggering, launching)
- Clip properties:
  - Name
  - Length
  - Loop start/end
  - Playback position
- Clip colors
- Scene management:
  - Create scene
  - Delete scene
  - Launch scene
  - Scene list
  - Navigate scenes
- Cue markers
- Stop clips

---

## 6. CURSOR & NAVIGATION
- Track cursor (select, navigate)
- Device cursor (navigate chain, select device)
- Layer cursor (navigate device layers)
- Clip cursor
- Arranger cursor
- Navigation modes (scroll, jump, loop)

---

## 7. BROWSER
- Device browser:
  - Categories and subcategories
  - Filter/search devices
  - Load device
- Preset browser:
  - Browse presets
  - Search presets
  - Load preset
- Sample browser:
  - Browse samples
  - Search samples
  - Load sample
- Multi-browser search

---

## 8. ARRANGEMENT & TIMELINE
- Markers:
  - Create/delete marker
  - Get marker list
  - Marker position & name
- Cue markers
- Arranger view:
  - Zoom level
  - Scroll position
  - Show/hide tracks
- Timeline position
- Loop area (start/end)
- Tempo automation
- Time signature automation

---

## 9. CLIP EDITING
- Clip note data access
- Step sequencer control
- Note editing (add, delete, modify)
- Note velocity, pitch, length
- Expressions (mod, expression, release velocity, etc.)
- Quantization
- Groove amount

---

## 10. STATE OBSERVATION & FEEDBACK
- Transport state polling
- Track state changes
- Device parameter changes
- Clip state changes
- User action callbacks
- Performance metrics
- Connection state

---

## 11. HARDWARE INTEGRATION
- MIDI input/output
- Note input
- Keyboard/controller input
- Hardware display support:
  - Pixel displays
  - Text displays
  - Graphics rendering
- Knob/button bindings
- Expression pedal input
- Sync to external hardware
- CC/note feedback

---

## 12. PREFERENCES & SETTINGS
- User preferences access
- Controller settings save/load
- UI theme settings
- Default track type
- Default device chain
- Undo/redo control

---

## 13. ACTIONS & COMMANDS
- Direct action invocation
- Action categories
- Application commands
- Edit commands
- View commands
- Transport commands
- Custom shortcuts

---

## 14. ANALYSIS & INFO
- Performance metrics (CPU, RAM, buffer size)
- Project information
- Track information
- Device information
- File paths

---

## Feature Complexity Matrix

| Category | Complexity | Immediate Value | Impl. Priority |
|----------|-----------|-----------------|-----------------|
| Transport Control | Low | High | P0 |
| Track Management | Low-Med | High | P0 |
| Device Chain Control | Med | High | P0 |
| Mixer & Sends | Med | High | P1 |
| Clip Launcher | Med | High | P1 |
| Browser | Low | Med | P1 |
| Cursor Navigation | Med | Low | P2 |
| Clip Editing | High | Med | P2 |
| State Observation | Med | High | P1 |
| Hardware Integration | High | Low | P3 |
| Arrangement Tools | Med | Med | P2 |
| Actions & Commands | Med | Low | P3 |

---

## Next Steps
- Prioritize implementation based on LLM control workflow
- Group features into must-have (MVP), nice-to-have, and killer features
- Design MCP tool schema for each feature group
