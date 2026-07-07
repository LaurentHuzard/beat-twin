loadAPI(10);

host.defineController("Beat Twin", "Beat Twin", "0.1", "761be710-90df-4577-8094-01314323214c", "Laurent Huzard");

var transport;
var application;
var trackBank;
var sceneBank;
var cursorTrack;
var cursorDevice;
var cursorClip;
var remoteControlsBank;
var deviceBanks = [];
var popupBrowser;
var browserResultBank;

// Connection state
var isConnected = false;

function init() {
  transport = host.createTransport();

  // Mark values we need to read as interested
  transport.tempo().value().markInterested();
  transport.getPosition().markInterested();
  transport.isPlaying().markInterested();
  transport.isArrangerRecordEnabled().markInterested();

  application = host.createApplication();

  // --- Track Control Setup ---
  // Create a Cursor Track (follows selection)
  cursorTrack = host.createCursorTrack("MCP_CURSOR", "Cursor Track", 0, 0, true);

  // Mark interested for Cursor Track
  cursorTrack.volume().markInterested();
  cursorTrack.pan().markInterested();
  cursorTrack.mute().markInterested();
  cursorTrack.solo().markInterested();
  cursorTrack.arm().markInterested();
  cursorTrack.name().markInterested();

  // --- Cursor Clip Setup ---
  // Gives MCP a focused step sequencer surface for writing note steps into the
  // currently selected clip.
  cursorClip = host.createCursorClip(16, 128);
  cursorClip.getLoopLength().markInterested();
  cursorClip.getLoopStart().markInterested();
  cursorClip.getPlayStart().markInterested();
  cursorClip.getPlayStop().markInterested();
  cursorClip.playingStep().markInterested();

  cursorClip.addStepDataObserver(function (x, y, state) {
    if (isConnected) {
      // Step events are currently only visible in Bitwig's controller log; the
      // Node bridge ignores unsolicited messages unless they match a request id.
      println("Beat Twin clip.step_update " + JSON.stringify({ x: x, y: y, state: state }));
    }
  });

  cursorClip.addPlayingStepObserver(function (step) {
    if (isConnected) {
      println("Beat Twin clip.play_step " + step);
    }
  });

  // --- Cursor Device Setup ---
  cursorDevice = cursorTrack.createCursorDevice("MCP_DEVICE", "Cursor Device", 0, CursorDeviceFollowMode.FOLLOW_SELECTION);
  cursorDevice.name().markInterested();
  cursorDevice.isWindowOpen().markInterested();
  cursorDevice.isExpanded().markInterested();
  
  // Remote Controls (8 knobs/macros)
  remoteControlsBank = cursorDevice.createCursorRemoteControlsPage(8);
  for (var i = 0; i < 8; i++) {
    var param = remoteControlsBank.getParameter(i);
    param.name().markInterested();
    param.value().markInterested();
    param.setIndication(true);
  }

  // Create Main Track Bank (8 tracks, 0 sends, 8 scenes)
  trackBank = host.createMainTrackBank(8, 0, 8);

  // Mark interested for Track Bank
  for (var i = 0; i < 8; i++) {
    var track = trackBank.getItemAt(i);
    track.volume().markInterested();
    track.pan().markInterested();
    track.mute().markInterested();
    track.solo().markInterested();
    track.arm().markInterested();
    track.name().markInterested();
    track.color().markInterested();

    var deviceBank = track.createDeviceBank(8);
    for (var d = 0; d < 8; d++) {
      var device = deviceBank.getItemAt(d);
      device.exists().markInterested();
      device.name().markInterested();
      device.isEnabled().markInterested();
    }
    deviceBanks.push(deviceBank);
    
    // Clip Launcher Slots
    var clipLauncher = track.clipLauncherSlotBank();
    for (var j = 0; j < 8; j++) {
      var slot = clipLauncher.getItemAt(j);
      slot.hasContent().markInterested();
      slot.isPlaying().markInterested();
      slot.isRecording().markInterested();
      slot.isPlaybackQueued().markInterested();
    }
  }
  
  // Create Scene Bank (8 scenes)
  sceneBank = host.createSceneBank(8);
  for (var i = 0; i < 8; i++) {
     var scene = sceneBank.getScene(i);
     scene.name().markInterested();
     scene.sceneIndex().markInterested();
  }

  // --- Popup Browser Setup ---
  popupBrowser = host.createPopupBrowser();
  popupBrowser.exists().markInterested();
  popupBrowser.title().markInterested();
  popupBrowser.contentTypeNames().markInterested();
  popupBrowser.selectedContentTypeIndex().markInterested();
  popupBrowser.selectedContentTypeName().markInterested();
  browserResultBank = popupBrowser.resultsColumn().createItemBank(32);
  for (var r = 0; r < 32; r++) {
    var browserItem = browserResultBank.getItemAt(r);
    browserItem.exists().markInterested();
    browserItem.name().markInterested();
    browserItem.isSelected().markInterested();
  }

  println("Beat Twin Initialized");

  // Create a TCP server on port 8888 for the Node.js MCP server to connect to.
  // host.createRemoteConnection returns a RemoteSocket.
  var remoteSocket = host.createRemoteConnection("BitwigMCP", 8888);

  remoteSocket.setClientConnectCallback(function (remoteConnection) {
    println("Client connected");
    isConnected = true;
    var receiveBuffer = "";

    remoteConnection.setDisconnectCallback(function () {
      println("Client disconnected");
      isConnected = false;
      receiveBuffer = "";
    });

    remoteConnection.setReceiveCallback(function (data) {
      receiveBuffer += bytesToString(data);
      receiveBuffer = drainReceiveBuffer(receiveBuffer, remoteConnection);
    });
  });
}

function bytesToString(data) {
  var msgString = "";
  for (var i = 0; i < data.length; i++) {
    msgString += String.fromCharCode(data[i]);
  }
  return msgString;
}

function drainReceiveBuffer(buffer, connection) {
  while (buffer.length > 0) {
    if (buffer.charAt(0) === "{") {
      try {
        handleRequest(JSON.parse(buffer), connection);
        return "";
      } catch (rawError) {
        println("Error parsing raw JSON: " + rawError);
        sendError(connection, null, -32700, "Parse error");
        return "";
      }
    }

    if (buffer.length < 4) return buffer;

    var bodyLength = (
      (buffer.charCodeAt(0) << 24) |
      (buffer.charCodeAt(1) << 16) |
      (buffer.charCodeAt(2) << 8) |
      buffer.charCodeAt(3)
    ) >>> 0;

    if (bodyLength < 1 || bodyLength > 1048576) {
      println("Invalid frame length: " + bodyLength);
      sendError(connection, null, -32700, "Parse error");
      return "";
    }

    if (buffer.length < bodyLength + 4) return buffer;

    var body = buffer.substring(4, bodyLength + 4);
    buffer = buffer.substring(bodyLength + 4);

    try {
      handleRequest(JSON.parse(body), connection);
    } catch (frameError) {
      println("Error parsing framed JSON: " + frameError);
      sendError(connection, null, -32700, "Parse error");
    }
  }

  return buffer;
}

function resolveCursorClipStep(step) {
  var stepNumber = Math.max(0, Math.floor(step));
  var pageStart = Math.floor(stepNumber / 16) * 16;
  cursorClip.scrollToStep(pageStart);
  return stepNumber - pageStart;
}

function handleRequest(request, connection) {
  if (!request.method) {
    sendError(connection, request.id, -32600, "Invalid Request");
    return;
  }

  var result;
  try {
    switch (request.method) {
      // --- Transport ---
      case "transport.play":
        transport.play();
        result = "OK";
        break;
      case "transport.stop":
        transport.stop();
        result = "OK";
        break;
      case "transport.restart":
        transport.restart();
        result = "OK";
        break;
      case "transport.record":
        transport.record();
        result = "OK";
        break;
      case "transport.getTempo":
        // Tempo is a bit complex in Bitwig API, usually requires an observer.
        // For immediate sync return, we might need to cache observed values.
        // OR we just return the currently cached value.
        result = transport.tempo().value().getRaw();
        break;
      case "transport.setTempo":
        if (request.params && request.params[0]) {
          transport.tempo().value().setRaw(request.params[0]);
          result = "OK";
        } else {
          throw "Missing tempo parameter";
        }
        break;
      case "transport.getPosition":
        result = transport.getPosition().get();
        break;
      case "transport.setPosition":
        if (request.params && request.params[0]) {
          transport.getPosition().set(request.params[0]);
          result = "OK";
        } else {
          throw "Missing position parameter";
        }
        break;
      case "transport.getIsPlaying":
        result = transport.isPlaying().get();
        break;
      case "transport.getIsRecording":
        result = transport.isArrangerRecordEnabled().get();
        break;

      // --- Track Bank Control ---
      case "track.bank.get_status":
        var tracks = [];
        for (var i = 0; i < 8; i++) {
          var t = trackBank.getItemAt(i);
          tracks.push({
            index: i,
            name: t.name().get(),
            volume: t.volume().get(),
            pan: t.pan().get(),
            mute: t.mute().get(),
            solo: t.solo().get(),
            arm: t.arm().get(),
            color: {
              red: t.color().red(),
              green: t.color().green(),
              blue: t.color().blue()
            }
          });
        }
        result = tracks;
        break;

      case "track.bank.volume":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          trackBank.getItemAt(request.params[0]).volume().set(request.params[1]);
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "track.bank.pan":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          trackBank.getItemAt(request.params[0]).pan().set(request.params[1]);
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "track.bank.mute":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          trackBank.getItemAt(request.params[0]).mute().set(request.params[1]);
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "track.bank.solo":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          trackBank.getItemAt(request.params[0]).solo().set(request.params[1]);
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "track.bank.select":
        if (request.params && request.params[0] !== undefined) {
          trackBank.getItemAt(request.params[0]).selectInMixer();
          result = "OK";
        } else throw "Missing parameters";
        break;

      // --- Clip Launcher ---
      case "clip.launch":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // track index, slot index
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).launch();
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "clip.record":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // track index, slot index
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).record();
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "clip.stop":
         if (request.params && request.params[0] !== undefined) {
            // track index
            trackBank.getItemAt(request.params[0]).stop();
            result = "OK";
         } else throw "Missing parameters";
         break;

      case "scene.launch":
        if (request.params && request.params[0] !== undefined) {
          sceneBank.getScene(request.params[0]).launch();
          result = "OK";
        } else throw "Missing parameters";
        break;

      case "scene.list":
        var scenes = [];
        for (var i = 0; i < 8; i++) {
           var s = sceneBank.getScene(i);
           scenes.push({
             index: i,
             name: s.name().get()
           });
        }
        result = scenes;
        break;

      case "scene.create":
        sceneBank.createScene();
        result = "OK";
        break;

      case "clip.create":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined && request.params[2] !== undefined) {
          // track index, slot index, length in beats
          trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]).createEmptyClip(request.params[2]);
          result = "OK";
        } else throw "Missing parameters (trackIndex, slotIndex, length)";
        break;

      case "clip.select_slot":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          var selectSlot = trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]);
          selectSlot.select();
          result = "OK";
        } else throw "Missing parameters (trackIndex, slotIndex)";
        break;

      case "clip.show_in_editor":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          var editorSlot = trackBank.getItemAt(request.params[0]).clipLauncherSlotBank().getItemAt(request.params[1]);
          editorSlot.select();
          editorSlot.showInEditor();
          result = "OK";
        } else throw "Missing parameters (trackIndex, slotIndex)";
        break;

      case "clip.get_info":
        result = {
          loopLength: cursorClip.getLoopLength().get(),
          loopStart: cursorClip.getLoopStart().get(),
          playStart: cursorClip.getPlayStart().get(),
          playStop: cursorClip.getPlayStop().get(),
          playingStep: cursorClip.playingStep().get()
        };
        break;

      case "clip.set_note":
        if (
          request.params &&
          request.params[0] !== undefined &&
          request.params[1] !== undefined &&
          request.params[2] !== undefined &&
          request.params[3] !== undefined
        ) {
          // step, pitch, velocity, duration
          cursorClip.setStep(0, resolveCursorClipStep(request.params[0]), request.params[1], request.params[2], request.params[3]);
          result = "OK";
        } else throw "Missing parameters (step, pitch, velocity, duration)";
        break;

      case "clip.clear_note":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // step, pitch
          cursorClip.clearStep(0, resolveCursorClipStep(request.params[0]), request.params[1]);
          result = "OK";
        } else throw "Missing parameters (step, pitch)";
        break;

      case "clip.toggle_note":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          // step, pitch, velocity
          cursorClip.toggleStep(resolveCursorClipStep(request.params[0]), request.params[1], request.params[2] || 127);
          result = "OK";
        } else throw "Missing parameters (step, pitch)";
        break;

      // --- Selected Track Control ---
      case "track.selected.get_status":
        result = {
          name: cursorTrack.name().get(),
          volume: cursorTrack.volume().get(),
          pan: cursorTrack.pan().get(),
          mute: cursorTrack.mute().get(),
          solo: cursorTrack.solo().get(),
          arm: cursorTrack.arm().get()
        };
        break;

      case "track.selected.volume":
        if (request.params && request.params[0] !== undefined) {
          cursorTrack.volume().set(request.params[0]);
          result = "OK";
        } else throw "Missing parameter";
        break;

      case "track.selected.pan":
        if (request.params && request.params[0] !== undefined) {
          cursorTrack.pan().set(request.params[0]);
          result = "OK";
        } else throw "Missing parameter";
        break;

      case "track.selected.mute":
        if (request.params && request.params[0] !== undefined) {
          cursorTrack.mute().set(request.params[0]);
          result = "OK";
        } else throw "Missing parameter";
        break;

      case "track.selected.solo":
        if (request.params && request.params[0] !== undefined) {
          cursorTrack.solo().set(request.params[0]);
          result = "OK";
        } else throw "Missing parameter";
        break;

      case "track.selected.arm":
        if (request.params && request.params[0] !== undefined) {
          cursorTrack.arm().set(request.params[0]);
          result = "OK";
        } else throw "Missing parameter";
        break;

      case "ping":
        result = "pong";
        break;

      case "application.createInstrumentTrack":
        application.createInstrumentTrack(-1); // -1 means add at end
        result = "OK";
        break;
      
      case "application.createAudioTrack":
        application.createAudioTrack(-1);
        result = "OK";
        break;

      // --- Device Control ---
      case "device.get_status":
        result = {
          name: cursorDevice.name().get(),
          isWindowOpen: cursorDevice.isWindowOpen().get(),
          isExpanded: cursorDevice.isExpanded().get()
        };
        break;

      case "device.toggle_window":
        cursorDevice.isWindowOpen().toggle();
        result = "OK";
        break;

      case "device.toggle_expanded":
        cursorDevice.isExpanded().toggle();
        result = "OK";
        break;

      case "device.get_remote_controls":
        var controls = [];
        for (var i = 0; i < 8; i++) {
          var param = remoteControlsBank.getParameter(i);
          controls.push({
            index: i,
            name: param.name().get(),
            value: param.value().get()
          });
        }
        result = controls;
        break;

      case "device.set_remote_control":
        if (request.params && request.params[0] !== undefined && request.params[1] !== undefined) {
          remoteControlsBank.getParameter(request.params[0]).value().set(request.params[1]);
          result = "OK";
        } else throw "Missing parameters (index, value)";
        break;

      case "device.page_next":
        remoteControlsBank.selectNextPage(true);
        result = "OK";
        break;

      case "device.page_previous":
        remoteControlsBank.selectPreviousPage(true);
        result = "OK";
        break;

      case "device.list":
        if (request.params && request.params[0] !== undefined) {
          var trackIndex = request.params[0];
          var devices = [];
          for (var di = 0; di < 8; di++) {
            var listedDevice = deviceBanks[trackIndex].getItemAt(di);
            if (listedDevice.exists().get()) {
              devices.push({
                index: di,
                name: listedDevice.name().get(),
                enabled: listedDevice.isEnabled().get()
              });
            }
          }
          result = devices;
        } else throw "Missing trackIndex parameter";
        break;

      case "device.browse_insert":
        if (request.params && request.params[0] !== undefined) {
          var insertTrackIndex = request.params[0];
          var insertPosition = request.params[1] !== undefined ? request.params[1] : 0;
          trackBank.getItemAt(insertTrackIndex).selectInMixer();
          deviceBanks[insertTrackIndex].browseToInsertDevice(insertPosition);
          result = "OK";
        } else throw "Missing parameters (trackIndex, position)";
        break;

      case "device.browse_start":
        if (request.params && request.params[0] !== undefined) {
          var startTrackIndex = request.params[0];
          var startTrack = trackBank.getItemAt(startTrackIndex);
          startTrack.selectInMixer();
          startTrack.startOfDeviceChainInsertionPoint().browse();
          result = "OK";
        } else throw "Missing trackIndex parameter";
        break;

      case "device.browse_end":
        if (request.params && request.params[0] !== undefined) {
          var endTrackIndex = request.params[0];
          var endTrack = trackBank.getItemAt(endTrackIndex);
          endTrack.selectInMixer();
          endTrack.endOfDeviceChainInsertionPoint().browse();
          result = "OK";
        } else throw "Missing trackIndex parameter";
        break;

      // --- Browser Control ---
      case "browser.get_status":
        result = {
          exists: popupBrowser.exists().get(),
          title: popupBrowser.title().get(),
          contentTypeNames: popupBrowser.contentTypeNames().get(),
          selectedContentTypeIndex: popupBrowser.selectedContentTypeIndex().get(),
          selectedContentTypeName: popupBrowser.selectedContentTypeName().get()
        };
        break;

      case "browser.list_results":
        var items = [];
        for (var bi = 0; bi < 32; bi++) {
          var item = browserResultBank.getItemAt(bi);
          var name = item.name().get();
          if (item.exists().get() || (name && name.length > 0)) {
            items.push({ index: bi, exists: item.exists().get(), name: name, selected: item.isSelected().get() });
          }
        }
        result = items;
        break;

      case "browser.select_result":
        if (request.params && request.params[0] !== undefined) {
          popupBrowser.selectFirstFile();
          // In Bitwig 5's popup browser, commit() lands on the previous result
          // unless we advance one extra step from the first visible item.
          for (var si = 0; si <= request.params[0]; si++) {
            popupBrowser.selectNextFile();
          }
          result = "OK";
        } else throw "Missing index parameter";
        break;

      case "browser.select_first_file":
        popupBrowser.selectFirstFile();
        result = "OK";
        break;

      case "browser.select_next_file":
        popupBrowser.selectNextFile();
        result = "OK";
        break;

      case "browser.select_previous_file":
        popupBrowser.selectPreviousFile();
        result = "OK";
        break;

      case "browser.commit":
        popupBrowser.commit();
        result = "OK";
        break;

      case "browser.cancel":
        popupBrowser.cancel();
        result = "OK";
        break;

      default:
        sendError(connection, request.id, -32601, "Method not found: " + request.method);
        return;
    }

    // Success response
    sendResponse(connection, request.id, result);

  } catch (e) {
    sendError(connection, request.id, -32603, "Internal error: " + e);
  }
}

function sendResponse(connection, id, result) {
  var response = {
    jsonrpc: "2.0",
    id: id,
    result: result
  };
  sendJSON(connection, response);
}

function sendError(connection, id, code, message) {
  var response = {
    jsonrpc: "2.0",
    id: id,
    error: {
      code: code,
      message: message
    }
  };
  sendJSON(connection, response);
}

function sendJSON(connection, data) {
  var str = JSON.stringify(data) + "\n"; // Newline delimiter
  // Convert string to byte array
  // Explicitly converting char codes to Java byte array-like structure if needed, 
  // but Bitwig SDK usually handles string-compatible byte arrays or we use a helper.
  // However, setReceiveCallback gives us raw bytes, send expects raw bytes.

  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  connection.send(bytes);
}

function flush() {
  // Called by Bitwig generally after init and usually per frame/gui refresh
}

function exit() {
  println("Beat Twin Exited");
}
