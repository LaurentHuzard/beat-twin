loadAPI(10);

host.defineController("BitwigPOC", "BitwigPOC", "0.1", "761be710-90df-4577-8094-01314323214c", "Laurent Huzard");

var transport;
var application;
var trackBank;
var sceneBank;
var cursorTrack;

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

  println("BitwigPOC Initialized");

  // Create a TCP server on port 8888 for the Node.js MCP server to connect to.
  // host.createRemoteConnection returns a RemoteSocket.
  var remoteSocket = host.createRemoteConnection("BitwigMCP", 8888);

  remoteSocket.setClientConnectCallback(function (remoteConnection) {
    println("Client connected");
    isConnected = true;

    remoteConnection.setDisconnectCallback(function () {
      println("Client disconnected");
      isConnected = false;
    });

    remoteConnection.setReceiveCallback(function (data) {
      // data is a byte[]
      var msgString = "";
      for (var i = 0; i < data.length; i++) {
        msgString += String.fromCharCode(data[i]);
      }

      // Handle JSON-RPC
      try {
        var request = JSON.parse(msgString);
        handleRequest(request, remoteConnection);
      } catch (e) {
        println("Error parsing JSON: " + e);
        sendError(remoteConnection, null, -32700, "Parse error");
      }
    });
  });
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
  println("BitwigPOC Exited");
}
