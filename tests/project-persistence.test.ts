import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { getToolDefinitions, handleToolCall } from "../index.ts";

const source = await readFile(new URL("../bitwig-controller/BeatTwin/BeatTwin.control.ts", import.meta.url), "utf8");
function controller(actions: any = []) {
  let catalogueReads = 0, invokes = 0;
  const ctx: any = { loadAPI(version: number) { assert.equal(version, 15); }, println() {}, host: { defineController() {} } };
  runInNewContext(source, ctx);
  ctx.application = { getActions() { catalogueReads += 1; return actions; } };
  function rpc(params: any = [0, 64]) {
    let reply: any;
    ctx.handleRequest({ id: 1, method: "application.list_actions", params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated: false });
    return reply;
  }
  return { ctx, rpc, reads: () => catalogueReads, invokes: () => invokes,
    action: (id: string) => ({ getId: () => id, getName: () => `Action ${id}`, invoke() { invokes += 1; } }) };
}

test("action catalogue reads are unauthenticated, bounded and never invoke actions", () => {
  const actions: any[] = [], h = controller(actions);
  for (let i = 0; i < 70; i++) actions.push(h.action(String(i)));
  const first = h.rpc().result;
  assert.equal(first.count, 70); assert.equal(first.actions.length, 64);
  assert.deepEqual(first.actions[0], { id: "0", name: "Action 0" });
  assert.deepEqual(first.coverage, { offset: 0, limit: 64, returned: 64, hasMore: true, nextOffset: 64, complete: false });
  const last = h.rpc([64, 64]).result;
  assert.equal(last.actions.length, 6); assert.equal(last.coverage.hasMore, false); assert.equal(last.coverage.nextOffset, null);
  assert.equal(h.rpc([4096, 1]).result.actions.length, 0);
  assert.equal(h.invokes(), 0); assert.equal(h.reads(), 3);
});

test("empty and oversized catalogues report honest coverage", () => {
  const empty = controller().rpc().result;
  assert.deepEqual(empty.actions, []); assert.equal(empty.count, 0); assert.equal(empty.coverage.complete, true);
  const actions: any[] = [], h = controller(actions);
  for (let i = 0; i < 4162; i++) actions.push(h.action(String(i)));
  const bounded = h.rpc([4096, 64]).result;
  assert.equal(bounded.actions.length, 64); assert.equal(bounded.coverage.hasMore, true);
  assert.equal(bounded.coverage.nextOffset, null); assert.equal(bounded.coverage.complete, false);
});

test("controller rejects malformed action ranges before accessing the host", () => {
  const h = controller();
  for (const params of [[], [0], [0, 1, 2], [-1, 1], [4097, 1], [0, 0], [0, 65], [0.5, 1], [0, 1.5], ["0", 1], [0, NaN], [Infinity, 1], null]) {
    assert.equal(h.rpc(params).error.code, -32602);
  }
  assert.equal(h.reads(), 0); assert.equal(h.invokes(), 0);
});

test("missing catalogue or invalid action metadata fail explicitly", () => {
  for (const actions of [null, {}, [null], [{ getId: () => "id" }], [{ getId: () => "", getName: () => "Name" }], [{ getId: () => "id", getName: () => undefined }]]) {
    assert.equal(controller(actions).rpc().error.code, -32004);
  }
  const h = controller(); delete h.ctx.application.getActions;
  assert.equal(h.rpc().error.code, -32004);
});

test("action catalogue MCP direct and discovery routes remain read-only", async () => {
  const env = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
  assert.ok(getToolDefinitions({ env: {} }).some((tool: any) => tool.name === "application_list_actions"));
  for (const generic of [false, true]) {
    const calls: any[] = [], args = { offset: 4096, limit: 64 };
    const request = { params: generic ? { name: "call_tool", arguments: { name: "application_list_actions", arguments: args } } : { name: "application_list_actions", arguments: args } };
    const result = await handleToolCall(request, { env, call: async (...args: any[]) => { calls.push(args); return { actions: [] }; } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [["application.list_actions", [4096, 64], { requiresAuthentication: false }]]);
    for (const bad of [{}, { offset: -1, limit: 1 }, { offset: 4097, limit: 1 }, { offset: 0, limit: 65 }, { offset: 0, limit: 0 }, { offset: 0.5, limit: 1 }, { offset: 0, limit: 1, invoke: "save" }, { offset: "0", limit: 1 }]) {
      const rejected = await handleToolCall({ params: generic ? { name: "call_tool", arguments: { name: "application_list_actions", arguments: bad } } : { name: "application_list_actions", arguments: bad } }, { env, call: async () => assert.fail("invalid input contacted host") });
      assert.equal(rejected.isError, true);
    }
  }
});

function saveController() {
  const h = controller(), calls: string[] = [], observers: Array<() => void> = [];
  function value(initial: any) {
    let current = initial;
    return { get: () => current, update(next: any) { current = next; }, markInterested() {},
      addValueObserver(fn: () => void) { observers.push(fn); } };
  }
  const project = value("New 3"), playing = value(false), recording = value(false);
  h.ctx.watchMixValue(project, "projectName", "application");
  h.ctx.watchMixValue(playing, "playing", "mixSafety"); h.ctx.watchMixValue(recording, "recording", "mixSafety");
  h.ctx.application.projectName = () => project;
  h.ctx.application.getAction = (id: string) => ({ getId: () => id, invoke() { calls.push(id); } });
  h.ctx.transport = { isPlaying: () => playing, isArrangerRecordEnabled: () => recording };
  observers.forEach((fn) => fn()); h.ctx.flush(); h.ctx.flush();
  function rpc(method = "project.save", params: any = ["New 3"], authenticated = true) {
    let reply: any;
    h.ctx.handleRequest({ id: 1, method, params }, { send(bytes: number[]) { reply = JSON.parse(String.fromCharCode(...bytes)); } }, { authenticated });
    return reply;
  }
  return { ...h, calls, project, playing, recording, rpc };
}

test("dedicated save actions invoke only exact host IDs and never claim persisted content", () => {
  for (const [method, id] of [["project.save", "Save"], ["project.save_as", "Save as"]]) {
    const h = saveController(), response = h.rpc(method).result;
    assert.deepEqual(h.calls, [id]); assert.equal(response.status, "dispatched");
    assert.equal(response.actionId, id); assert.equal(response.projectName, "New 3");
    assert.equal(response.identityScope, "project_name_only"); assert.equal(response.projectPath, null);
    assert.equal(response.saved, null); assert.equal(response.verified, false); assert.equal(response.persistenceVerified, false);
    assert.equal(response.mayOpenDialog, true); assert.equal(response.requiresUserInteraction, true);
    assert.equal(h.ctx.constructionPending, null); assert.equal(h.ctx.globalUiPending, 0);
    assert.equal(h.rpc("application.list_actions", [0, 1], false).error, undefined);
  }
});

test("save requires observed matching project, stopped transport and write authentication", () => {
  const denied = saveController(); assert.equal(denied.rpc("project.save", ["New 3"], false).error.code, -32001);
  for (const invalidate of [
    (h: any) => h.project.update("Other"),
    (h: any) => { h.ctx.advancedState.application.seen.projectName = false; },
    (h: any) => { h.ctx.advancedState.application.settledVersion = -1; },
    (h: any) => h.playing.update(true),
    (h: any) => h.recording.update(true),
    (h: any) => { h.ctx.advancedState.mixSafety.seen.playing = false; },
    (h: any) => { h.ctx.application.getAction = (id: string) => { h.project.update("Other"); return { getId: () => id, invoke: () => h.calls.push(id) }; }; },
  ]) {
    const h = saveController(); invalidate(h); assert.ok(h.rpc().error); assert.deepEqual(h.calls, []);
  }
});

test("save refuses missing/mismatched actions, arbitrary IDs and paths before dispatch", () => {
  for (const action of [null, {}, { getId: () => "Quit", invoke() { assert.fail("wrong action invoked"); } }, { getId: () => "Save" }]) {
    const h = saveController(); h.ctx.application.getAction = () => action;
    assert.equal(h.rpc().error.code, -32004); assert.deepEqual(h.calls, []);
  }
  const unavailable = saveController(); delete unavailable.ctx.application.getAction;
  assert.equal(unavailable.rpc().error.code, -32004);
  for (const params of [[], [""], ["   "], ["New\n3"], ["a".repeat(257)], [null], ["New 3", "/tmp/project.bwproject"], [{ action: "Quit" }]]) {
    const h = saveController(); assert.equal(h.rpc("project.save", params).error.code, -32602); assert.deepEqual(h.calls, []);
  }
  const failed = saveController(); failed.ctx.application.getAction = () => ({ getId: () => "Save", invoke() { throw new Error("host rejected"); } });
  assert.ok(failed.rpc().error); assert.equal(failed.ctx.constructionPending, null);
});

test("MCP save policies and schemas reject bypasses in direct and discovery calls", async () => {
  for (const name of ["project_save", "project_save_as"]) for (const generic of [false, true]) {
    const request = (args: any) => ({ params: generic ? { name: "call_tool", arguments: { name, arguments: args } } : { name, arguments: args } });
    for (const policy of [undefined, "transport", "device_write"]) {
      const env = { BITWIG_MCP_TOOL_DISCOVERY: "1", BITWIG_MCP_WRITE_POLICY: policy };
      assert.ok(!getToolDefinitions({ env }).some((tool: any) => tool.name === name));
      const rejected = await handleToolCall(request({ expectedProjectName: "New 3" }), { env, call: async () => assert.fail("policy rejected save contacted host") });
      assert.equal(rejected.isError, true);
    }
    const env = { BITWIG_MCP_TOOL_DISCOVERY: "1", BITWIG_MCP_WRITE_POLICY: "application_write" };
    const calls: any[] = [];
    const valid = await handleToolCall(request({ expectedProjectName: "New 3" }), { env, call: async (...args: any[]) => { calls.push(args); return { status: "dispatched", saved: null, verified: false }; } });
    assert.equal(valid.isError, undefined); assert.deepEqual(calls, [[name.replace("project_", "project."), ["New 3"], { requiresAuthentication: true }]]);
    for (const args of [{}, { expectedProjectName: "" }, { expectedProjectName: "   " }, { expectedProjectName: "New\n3" }, { expectedProjectName: 3 }, { expectedProjectName: "New 3", path: "/tmp/new.bwproject" }, { expectedProjectName: "New 3", actionId: "Quit" }]) {
      const rejected = await handleToolCall(request(args), { env, call: async () => assert.fail("invalid save contacted host") });
      assert.equal(rejected.isError, true);
    }
  }
});
