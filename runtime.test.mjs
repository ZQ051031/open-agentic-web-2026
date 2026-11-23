import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime, localRouter, validateNetwork } from "./runtime.js";

const base = "http://localhost:8080/open-agentic-web-2026/";
const peerOrigin = "https://raw.githubusercontent.com";
const args = (scenario, briefing = false) => ({ scenario, briefing });
const json = async name => JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
const filename = url => url.pathname.split("/").at(-1);

async function fixture({ approve, rewrite, router } = {}) {
  const events = [];
  const requests = [];
  const runtime = await createRuntime({
    base, router, approve, onEvent: event => events.push(event),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      const document = await json(filename(url));
      return Response.json(rewrite?.(url, document) ?? document);
    }
  });
  return { runtime, events, requests };
}

test("site publishes the profile's manifest, links, and resolved Neuro SAN descriptions", async () => {
  const manifest = await json("agent-manifest.json");
  const links = await json("links.json");
  assert.equal(manifest.peer_policy.mode, "closed");
  assert.equal(manifest.llm_router.model, localRouter.model);
  assert.equal(links.version, 1);
  assert.equal(new Set(manifest.networks.map(entry => entry.name)).size, manifest.networks.length);
  for (const { name, front_man, hocon } of manifest.networks) {
    const definition = await json(hocon);
    const agents = validateNetwork(definition, front_man, links.networks[name]);
    assert.ok(agents.has(front_man));
    assert.deepEqual(definition.sly_data_schema.properties, {});
    assert.equal(definition.sly_data_schema.additionalProperties, false);
  }
  const html = await readFile(new URL("index.html", import.meta.url), "utf8");
  assert.match(html, /href="\.\/agent-manifest\.json"/);
  assert.match(html, /href="\.\/tide_desk\.network\.json"/);
});

test("local default model delegates and returns grounded, deterministic plans without web contact", async () => {
  const { runtime, events, requests } = await fixture();
  const first = await runtime.run(args("accessible"));
  assert.equal(first.site.id, "T01");
  assert.ok(first.checks.every(check => check.pass));
  assert.deepEqual(events.filter(e => e.type === "delegate").map(e => e.message),
    ["coordinator → scout", "coordinator → checker"]);
  assert.equal(events.filter(e => e.type === "action").length, 2);
  assert.deepEqual(await runtime.run(args("accessible")), first);
  assert.equal((await runtime.run(args("high_tide"))).site.id, "T02");
  assert.ok(requests.every(({ url }) => url.origin === "http://localhost:8080"));
});

test("no match is explicit and does not invent a field plan", async () => {
  const { runtime, events } = await fixture();
  assert.deepEqual(await runtime.run(args("no_match")), { status: "no_match", examined: 3 });
  assert.deepEqual(events.filter(e => e.type === "delegate").map(e => e.message), ["coordinator → scout"]);
});

test("cross-origin peer is discovered exactly, runs in the caller, and receives only ordinary input", async () => {
  const approvals = [];
  let peerInput;
  const router = { ...localRouter, infer(context) {
    if (context.peer) peerInput = context;
    return localRouter.infer(context);
  } };
  const { runtime, requests, events } = await fixture({
    router,
    approve: async request => { approvals.push(request); return true; },
    rewrite(url, document) {
      if (url.origin === peerOrigin && filename(url) === "agent-manifest.json") {
        document.llm_router = { model: "ignored-peer-model" };
      }
      return document;
    }
  });
  const plan = await runtime.run(args("accessible", true));
  assert.match(plan.briefing, /buddy system/);
  assert.deepEqual(peerInput.args, { inquiry: "Give the general volunteer briefing." });
  assert.equal(peerInput.sly_data, undefined);
  assert.deepEqual(approvals.map(a => [a.origin, a.purpose]), [
    [peerOrigin, "read the peer manifest"], [peerOrigin, "read the peer network definition"]
  ]);
  assert.deepEqual(requests.filter(r => r.url.origin === peerOrigin).map(r => filename(r.url)),
    ["agent-manifest.json", "briefing.network.json"]);
  assert.ok(requests.every(r => r.options.credentials === "omit" && r.options.redirect === "error"));
  assert.ok(events.some(e => e.message === "Using tide-rules-v1 in this browser"));
});

test("rejects third-party contact before any request on consent decline and policy denial", async () => {
  const { runtime, requests, events } = await fixture();
  await assert.rejects(runtime.run(args("accessible", true)), /Contact declined/);
  assert.ok(requests.every(r => r.url.origin !== peerOrigin));
  assert.equal(events.at(-1).type, "error");
  const denied = await fixture({
    approve: () => assert.fail("disallowed origin must not prompt"),
    rewrite: (url, doc) => filename(url) === "agent-manifest.json" ? { ...doc, allowed_peers: [] } : doc
  });
  await assert.rejects(denied.runtime.run(args("accessible", true)), /Origin denied/);
  assert.ok(denied.requests.every(r => r.url.origin !== peerOrigin));
});

test("peer manifest does not substitute another network for an unmatched name", async () => {
  const { runtime, requests } = await fixture({
    approve: async () => true,
    rewrite: (url, doc) => url.origin === peerOrigin ? { ...doc, networks: doc.networks.slice(0, 1) } : doc
  });
  await assert.rejects(runtime.run(args("accessible", true)), /exactly one published network named briefing/);
  assert.equal(requests.filter(r => r.url.origin === peerOrigin).length, 1);
});

test("rejects malformed names, missing tools, executable definitions, and graph cycles before invocation", async () => {
  const graph = await json("tide_desk.network.json");
  const links = (await json("links.json")).networks.tide_desk;
  for (const [mutate, error] of [
    [doc => doc.tools.push(doc.tools[0]), /duplicate agent name/],
    [doc => doc.tools[0].tools.push("missing"), /Missing tool reference/],
    [doc => { doc.tools[1].class = "unsupported"; }, /Executable peer definitions/],
    [doc => doc.tools[1].tools.push("coordinator"), /Cycle in agent graph/]
  ]) {
    const changed = structuredClone(graph);
    mutate(changed);
    assert.throws(() => validateNetwork(changed, "coordinator", links), error);
  }
  assert.throws(() => validateNetwork(graph, "scout", links), /Invalid front agent/);
});

test("bounds steps and concurrent runs; rejects private fields as ordinary arguments", async () => {
  const { runtime } = await fixture({
    rewrite: (url, doc) => filename(url) === "tide_desk.network.json" ? { ...doc, max_steps: 1 } : doc
  });
  await assert.rejects(runtime.run(args("accessible")), /invocation budget exceeded/);
  await assert.rejects(runtime.run({ ...args("accessible"), sly_data: "not accepted" }), /Unexpected argument/);
  const normal = await fixture();
  const active = normal.runtime.run(args("accessible"));
  await assert.rejects(normal.runtime.run(args("accessible")), /already active/);
  await active;
});
