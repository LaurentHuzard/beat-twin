loadAPI(25);
println("Script loaded - API 25");

host.setShouldFailOnDeprecatedUse(true);

host.defineController("BitwigMCP", "Bitwig MCP Controller", "15.0", "229fb466-63d5-529e-a179-e439002c39d0", "taenia");
host.defineMidiPorts(0, 0);

var application;
var transport;
var buffer = "";

// Polyfill for String.endsWith
if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (search, this_len) {
    if (this_len === undefined || this_len > this.length) {
      this_len = this.length;
    }
    return this.substring(this_len - search.length, this_len) === search;
  };
}

function setupUDPListener() {
  var port = 19561;
  println("Setting up UDP listener on port " + port + "...");

  // Use UDP instead of TCP - this is simpler and more reliable
  var success = host.addDatagramPacketObserver("BitwigMCP", port, function (data) {
    host.showPopupNotification("UDP Data received!");
    try {
      var msgString = new java.lang.String(data, "UTF-8");
      var jsString = "" + msgString;
      println("Received UDP: " + jsString);
      handleDataRef(jsString);
    } catch (e) {
      println("Error processing UDP data: " + e);
    }
  });

  if (success) {
    println("UDP listener bound to port " + port);
    host.showPopupNotification("Bitwig MCP listening on UDP port " + port);
  } else {
    println("ERROR: Failed to bind UDP port " + port);
    host.showPopupNotification("FAILED to bind UDP port!");
  }
}

function handleDataRef(newData) {
  buffer += newData;
  var lines = buffer.split("\n");

  if (!buffer.endsWith("\n")) {
    buffer = lines.pop();
  } else {
    buffer = "";
    lines.pop();
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim().length > 0) {
      try {
        var msg = JSON.parse(line);
        handleMessage(msg);
      } catch (e) {
        println("JSON Parse Error: " + e + " in: " + line);
      }
    }
  }
}

function handleMessage(msg) {
  println("Handling command: " + msg.method);
  host.showPopupNotification("CMD: " + msg.method);

  if (msg.method === "tracks.create") {
    application.createInstrumentTrack(0);
  } else if (msg.method === "transport.play") {
    transport.play();
  } else if (msg.method === "transport.stop") {
    transport.stop();
  } else if (msg.method === "transport.restart") {
    transport.restart();
  } else {
    println("Unknown command: " + msg.method);
  }
}

function init() {
  try {
    application = host.createApplication();
    transport = host.createTransport();

    println("Bitwig POC Initialized - API 25");
    host.showPopupNotification("Bitwig MCP Ready!");

    setupUDPListener();
  } catch (e) {
    println("Error in init: " + e);
    host.showPopupNotification("Error: " + e);
  }
}

function flush() { }

function exit() {
  println("Bitwig POC Exiting");
}
