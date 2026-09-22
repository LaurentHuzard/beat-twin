import test from "node:test";
import assert from "node:assert/strict";

import {
  DuoCollaborationError,
  resolveChatCompletionUrl,
  runDuoCollaboration,
} from "../scripts/duo-collab-core.ts";

test("resolves root and /v1 provider bases to chat completions", () => {
  assert.equal(
    resolveChatCompletionUrl("http://mue.local:8003/").href,
    "http://mue.local:8003/v1/chat/completions",
  );
  assert.equal(
    resolveChatCompletionUrl("http://android.local:8080/v1").href,
    "http://android.local:8080/v1/chat/completions",
  );
});

test("keeps Android witness evidence out of MUE independent prompt then cross-examines", async () => {
  const calls: Array<{
    host: string;
    authorization?: string;
    body: Record<string, unknown>;
  }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    calls.push({
      host: url.host,
      authorization: headers.get("authorization") ?? undefined,
      body,
    });

    const messages = body.messages as Array<{ role: string; content: string }>;
    const joined = messages.map((message) => message.content).join("\n");
    const isMue = url.hostname === "mue.local";

    let content: string;
    if (joined.includes("PHASE: synthesis")) {
      content = "FINAL: proceed only because the Android observation supplied the required code.";
    } else if (joined.includes("PHASE: challenge")) {
      content = isMue
        ? "ACCEPT: Android has the missing observation. REVISION: proceed is now supported."
        : "ACCEPT: MUE correctly withheld judgment before seeing my observation.";
    } else {
      content = isMue
        ? "CLAIM: insufficient evidence. UNCERTAINTY: beacon code is missing."
        : "CLAIM: observed beacon_code=ORBIT-GREEN-47, which satisfies the task condition.";
    }

    return new Response(JSON.stringify({
      id: "chat-" + calls.length,
      object: "chat.completion",
      created: 1,
      model: isMue ? "gemma4_e4b" : "android-scout",
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  let tick = 0;
  const transcript = await runDuoCollaboration({
    task: "Recommend proceed only when the observed beacon code is ORBIT-GREEN-47.",
    witnessEvidence: "private-secret: beacon_code=ORBIT-GREEN-47",
    mue: {
      id: "mue",
      role: "analyst",
      baseUrl: "http://mue.local:8003/",
      model: "gemma4_e4b",
      apiKey: "mue-token",
    },
    android: {
      id: "android",
      role: "witness",
      baseUrl: "http://android.local:8080/v1",
      model: "android-scout",
      apiKey: "android-token",
    },
  }, {
    fetch: fetchImpl,
    now: () => ++tick,
  });

  assert.equal(calls.length, 5);
  const independentMue = calls.find((call) =>
    call.host === "mue.local:8003" &&
    JSON.stringify(call.body).includes("PHASE: independent")
  );
  const independentAndroid = calls.find((call) =>
    call.host === "android.local:8080" &&
    JSON.stringify(call.body).includes("PHASE: independent")
  );
  assert.ok(independentMue);
  assert.ok(independentAndroid);
  assert.doesNotMatch(JSON.stringify(independentMue.body), /private-secret/);
  assert.match(JSON.stringify(independentAndroid.body), /private-secret/);

  assert.deepEqual(
    transcript.turns.map((turn) => turn.phase + ":" + turn.agent),
    [
      "independent:mue",
      "independent:android",
      "challenge:mue",
      "challenge:android",
      "synthesis:mue",
    ],
  );
  assert.match(transcript.finalSynthesis, /Android observation/);
  assert.equal(transcript.witnessEvidenceSha256.length, 64);
  assert.doesNotMatch(JSON.stringify(transcript), /mue-token|android-token|private-secret/);
});

test("provider HTTP errors do not leak response bodies or API keys", async () => {
  await assert.rejects(
    runDuoCollaboration({
      task: "bounded task",
      witnessEvidence: "bounded evidence",
      mue: {
        id: "mue",
        role: "analyst",
        baseUrl: "http://mue.local:8003/",
        model: "mue",
        apiKey: "do-not-leak-mue",
      },
      android: {
        id: "android",
        role: "witness",
        baseUrl: "http://android.local:8080/",
        model: "android",
        apiKey: "do-not-leak-android",
      },
    }, {
      fetch: async () => new Response(
        JSON.stringify({ secret: "do-not-leak-mue" }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof DuoCollaborationError);
      assert.equal(error.code, "provider_http_error");
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    },
  );
});
