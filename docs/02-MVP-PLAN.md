# Bitwig MCP Server - MVP Features & Implementation Plan

## Vision
Create a **production-ready LLM controller** for Bitwig that enables AI to:
1. Manage projects (tracks, scenes, organization)
2. Control playback and recording
3. Create and manipulate sounds (devices, parameters)
4. Mix tracks (volume, pan, routing)
5. Monitor state and respond to changes

---

## MUST-HAVE FEATURES (MVP - Phase 1)

### Feature Set A: Transport Control
**What:** Full playback control + tempo/loop management
**Why:** Fundamental for any LLM interaction; enables music production automation

**Tools to implement:**
- `transport.play()` ✅ (exists)
- `transport.stop()` ✅ (exists)
- `transport.restart()` ✅ (exists)
- `transport.toggleRecord()`
- `transport.getTempo()` → returns float (BPM)
- `transport.setTempo(bpm)` → sets tempo
- `transport.getPosition()` → returns time in beats
- `transport.setPosition(beats)`
- `transport.toggleLoop()`
- `transport.setLoopStart(beats)`
- `transport.setLoopEnd(beats)`
- `transport.getIsPlaying()` → boolean
- `transport.getIsRecording()` → boolean
- `transport.getTimeSignature()` → {numerator, denominator}

**Estimated Effort:** 4-6 hours (API learning + testing)

---

### Feature Set B: Track Management
**What:** Create, organize, and configure tracks
**Why:** Core workflow for composition and arrangement

**Tools to implement:**
- `track.create(type, name?, position?)` → returns trackId ✅ (partial)
- `track.delete(trackId)`
- `track.list()` → returns [{id, name, type, volume, pan, muted, armed}...]
- `track.getInfo(trackId)` → detailed track properties
- `track.rename(trackId, newName)`
- `track.setVolume(trackId, volume)` → 0-100 or -∞ to 6dB
- `track.setPan(trackId, pan)` → -100 to 100
- `track.setMuted(trackId, isMuted)`
- `track.setSolo(trackId, isSolo)`
- `track.setArmed(trackId, isArmed)`
- `track.setInputSource(trackId, sourceId)`
- `track.setOutputRouting(trackId, destinationId)`
- `track.getTrackVolume(trackId)` → current volume
- `track.getTrackPan(trackId)` → current pan

**Estimated Effort:** 6-8 hours

---

### Feature Set C: Device Chain Control
**What:** Load, configure, and manipulate VST/AU devices
**Why:** Essential for sound design and parameter automation

**Tools to implement:**
- `device.load(trackId, deviceBrowserPath)` → loads device
- `device.delete(trackId, deviceSlotIndex)`
- `device.list(trackId)` → returns [{id, name, vendor, type}...]
- `device.getInfo(trackId, deviceId)` → device details
- `device.bypass(trackId, deviceId, isBypassed)`
- `device.getParameter(trackId, deviceId, paramName)` → value + range
- `device.setParameter(trackId, deviceId, paramName, value)`
- `device.loadPreset(trackId, deviceId, presetPath)`
- `device.savePreset(trackId, deviceId, presetName)`
- `device.openWindow(trackId, deviceId)`
- `device.minimizeWindow(trackId, deviceId)`
- `device.browseDevices(category?)` → returns device list to load from

**Estimated Effort:** 8-10 hours

---

### Feature Set D: Mixer & Sends
**What:** Control sends, returns, and mixing topology
**Why:** Essential for mixing and sidechain operations

**Tools to implement:**
- `mixer.getMasterVolume()` → current master volume
- `mixer.setMasterVolume(volume)`
- `mixer.setTrackVolume(trackId, volume)` (duplicate for consistency)
- `mixer.setSend(trackId, sendIndex, level)` → 0-100
- `mixer.getSend(trackId, sendIndex)` → current send level
- `mixer.createReturnTrack(name?)` → returns trackId
- `mixer.getReturnTracks()` → list of return tracks
- `mixer.setChannelRouting(trackId, outputTrackId)` → route track to another
- `mixer.getMeterReading(trackId)` → {peak, rms}

**Estimated Effort:** 4-6 hours

---

### Feature Set E: Clip Launcher & Scenes
**What:** Trigger clips and scenes; navigate arrangement
**Why:** Performance control and scene-based composition

**Tools to implement:**
- `clip.launch(trackId, clipSlotIndex)`
- `clip.stop(trackId)`
- `clip.stopAll()`
- `clip.list(trackId)` → returns clip slot info
- `clip.getInfo(trackId, clipSlotIndex)` → clip properties
- `clip.getClipName(trackId, clipSlotIndex)`
- `clip.setClipName(trackId, clipSlotIndex, name)`
- `scene.list()` → returns scene list with names
- `scene.launch(sceneIndex)`
- `scene.create(name?, atPosition?)`
- `scene.delete(sceneIndex)`
- `scene.rename(sceneIndex, name)`

**Estimated Effort:** 6-8 hours

---

### Feature Set F: State Observation & Feedback
**What:** Async callbacks for state changes to inform LLM of changes
**Why:** Essential for responsive LLM interactions (e.g., "tell me when track 3 is done playing")

**Tools to implement:**
- `state.subscribe(event, callback)` → subscribe to changes
  - Events: `transport.playing`, `transport.stopped`, `clip.launched`, `track.armed`, `device.bypassed`, `parameter.changed`, `scene.launched`
- `state.unsubscribe(eventId)`
- `state.getTrackState(trackId)` → full track state object
- `state.getTransportState()` → full transport state object
- `state.getDeviceState(trackId, deviceId)` → full device state object

**Estimated Effort:** 4-6 hours

---

## Implementation Roadmap - MVP (Phase 1)

```
WEEK 1:
  ☐ Task 1.1: Refactor MCP/Controller Communication
    ☐ 1.1.1: Replace UDP with proper RPC (JSON-RPC or gRPC)
    ☐ 1.1.2: Implement request/response pattern with error handling
    ☐ 1.1.3: Add connection state management
    ☐ 1.1.4: Create integration tests

  ☐ Task 1.2: Implement Transport Control (Feature Set A)
    ☐ 1.2.1: getTempo / setTempo
    ☐ 1.2.2: toggleRecord + getIsRecording
    ☐ 1.2.3: getPosition / setPosition
    ☐ 1.2.4: toggleLoop + setLoopStart/End
    ☐ 1.2.5: getTimeSignature
    ☐ 1.2.6: Test with manual playback scenarios

WEEK 2:
  ☐ Task 2.1: Implement Track Management (Feature Set B)
    ☐ 2.1.1: track.list() - enumerate all tracks
    ☐ 2.1.2: track.create() - enhanced (with type, name, position)
    ☐ 2.1.3: track.delete() + track.rename()
    ☐ 2.1.4: Volume/Pan getters and setters
    ☐ 2.1.5: Mute/Solo/Arm controls
    ☐ 2.1.6: Input/Output routing
    ☐ 2.1.7: Integration test suite

  ☐ Task 2.2: Implement Device Chain Control (Feature Set C)
    ☐ 2.2.1: device.list() - scan track device chain
    ☐ 2.2.2: device.load() - load from browser
    ☐ 2.2.3: device.delete() + device.bypass()
    ☐ 2.2.4: device.getParameter() / setParameter()
    ☐ 2.2.5: device.browseDevices() - category navigation
    ☐ 2.2.6: Test with standard plugins (Wavetable, Sampler, etc.)

WEEK 3:
  ☐ Task 3.1: Implement Mixer & Sends (Feature Set D)
    ☐ 3.1.1: Master volume control
    ☐ 3.1.2: Send level control (trackId + sendIndex)
    ☐ 3.1.3: Create return tracks
    ☐ 3.1.4: Channel routing
    ☐ 3.1.5: Meter readings (for feedback)

  ☐ Task 3.2: Implement Clip Launcher (Feature Set E)
    ☐ 3.2.1: clip.launch() / clip.stop()
    ☐ 3.2.2: scene.launch() / scene.create() / scene.delete()
    ☐ 3.2.3: Clip naming and info
    ☐ 3.2.4: Scene list and navigation

  ☐ Task 3.3: Implement State Observation (Feature Set F)
    ☐ 3.3.1: Event subscription system (observer pattern)
    ☐ 3.3.2: Transport state callbacks
    ☐ 3.3.3: Track state callbacks
    ☐ 3.3.4: Device state callbacks
    ☐ 3.3.5: Test with MCP notification pattern

WEEK 4:
  ☐ Task 4.1: MCP Server Integration
    ☐ 4.1.1: Create MCP tool definitions for all features
    ☐ 4.1.2: Integrate with NodeJS MCP framework
    ☐ 4.1.3: Error handling and validation
    ☐ 4.1.4: Documentation strings for each tool

  ☐ Task 4.2: Testing & Validation
    ☐ 4.2.1: End-to-end test scenarios
    ☐ 4.2.2: LLM interaction testing (Claude/GPT)
    ☐ 4.2.3: Performance benchmarking
    ☐ 4.2.4: Documentation

  ☐ Task 4.3: Deployment & Release
    ☐ 4.3.1: Package as distributable
    ☐ 4.3.2: Setup instructions
    ☐ 4.3.3: Example prompts for LLM
```

---

## Success Criteria (MVP Complete)
- [ ] LLM can create a track, load a device, and play back
- [ ] LLM can adjust parameters (volume, tempo, send levels)
- [ ] LLM can launch clips and scenes
- [ ] LLM receives state feedback (transport, device changes)
- [ ] All 6 feature sets have >90% API coverage
- [ ] Zero crashes on 100+ command sequences
- [ ] Response time <500ms per tool call (median)

---

## Notes
- API learning curve: Bitwig controller API is extensive but well-documented
- Testing strategy: Use mock tracks/devices for unit tests; real Bitwig for integration
- Performance: State observation should use efficient callbacks, not polling
