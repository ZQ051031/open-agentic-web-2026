import { scenarios, siteActions } from "./site-actions.js";

const NAME = /^[A-Za-z0-9_-]{1,80}$/;
const LIMIT = Object.freeze({ depth: 4, steps: 12, remote: 8, ms: 12_000 });
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const http = value => /^https?:\/\//.test(value);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function schemaFor(schema) {
  assert(object(schema) && schema.type === "object" && object(schema.properties), "Expected an object input schema.");
  assert(schema.required === undefined || (Array.isArray(schema.required) &&
    schema.required.every(name => own(schema.properties, name))), "Invalid required fields.");
  for (const property of Object.values(schema.properties)) {
    assert(object(property) && ["string", "boolean"].includes(property.type), "Unsupported input schema type.");
    assert(property.enum === undefined || (Array.isArray(property.enum) &&
      property.enum.length > 0 && property.enum.every(v => typeof v === property.type)), "Invalid input enum.");
    assert(property.maxLength === undefined || (Number.isSafeInteger(property.maxLength) &&
      property.maxLength >= 0), "Invalid maximum input length.");
  }
}

function checkArgs(schema, args) {
  assert(object(args), "Tool arguments must be an object.");
  for (const name of schema.required ?? []) assert(own(args, name), `Missing argument: ${name}.`);
  for (const [name, value] of Object.entries(args)) {
    assert(own(schema.properties, name), `Unexpected argument: ${name}.`);
    const rule = schema.properties[name];
    assert(typeof value === rule.type && (!rule.enum || rule.enum.includes(value)) &&
      (rule.maxLength === undefined || [...value].length <= rule.maxLength), `Invalid argument: ${name}.`);
  }
}

function webURL(value, base) {
  const url = new URL(value, base);
  assert((url.protocol === "https:" ||
    (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
    !url.username && !url.password && !url.search && !url.hash, "Expected a public HTTPS URL or loopback development URL.");
  return url;
}

function entryFor(manifest, name) {
  assert(object(manifest) && Array.isArray(manifest.networks), "Invalid agent-manifest.json.");
  const entries = manifest.networks.filter(entry => entry?.name === name);
  assert(entries.length === 1, `Expected exactly one published network named ${name}.`);
  const [entry] = entries;
  assert(NAME.test(entry.name) && typeof entry.front_man === "string" && NAME.test(entry.front_man) &&
    nonempty(entry.hocon), "Invalid manifest network entry.");
  return entry;
}

export function validateNetwork(definition, front, links = {}) {
  assert(object(definition) && nonempty(definition.metadata?.description) &&
    Array.isArray(definition.tools) && definition.tools.length > 0 && definition.tools.length <= 32,
  "Invalid network description or tools.");
  assert(definition.max_steps === undefined || (Number.isSafeInteger(definition.max_steps) && definition.max_steps > 0),
    "Invalid network step limit.");
  const agents = new Map();
  for (const agent of definition.tools) {
    assert(object(agent) && typeof agent.name === "string" && NAME.test(agent.name) && !agents.has(agent.name),
      "Invalid or duplicate agent name.");
    assert(!["class", "code", "coded_tool", "bundle"].some(key => own(agent, key)),
      "Executable peer definitions are not supported.");
    assert(nonempty(agent.function?.description) && nonempty(agent.instructions) &&
      Array.isArray(agent.tools) && agent.tools.every(tool => typeof tool === "string"),
    `Invalid agent definition: ${agent.name}.`);
    schemaFor(agent.function.parameters);
    agents.set(agent.name, agent);
  }
  assert(agents.has(front) && definition.tools[0].name === front, "Invalid front agent.");
  for (const [name, url] of Object.entries(links)) {
    assert(NAME.test(name) && !agents.has(name) && typeof url === "string" && http(url), "Invalid peer binding.");
    webURL(url);
  }
  const active = new Set();
  const visited = new Set();
  function visit(name) {
    assert(!active.has(name), `Cycle in agent graph at ${name}.`);
    if (visited.has(name)) return;
    active.add(name);
    const targets = agents.get(name).tools;
    assert(new Set(targets).size === targets.length, `Duplicate tool reference on ${name}.`);
    for (const target of targets) {
      if (agents.has(target)) visit(target);
      else if (http(target)) webURL(target);
      else assert(own(links, target), `Missing tool reference: ${target}.`);
    }
    active.delete(name);
    visited.add(name);
  }
  for (const name of agents.keys()) visit(name);
  return agents;
}

const evaluate = (site, brief) => [
  { label: "Crew capacity", pass: site.capacity >= brief.crew, evidence: `${site.capacity} spaces / ${brief.crew} requested` },
  { label: "Step-free access", pass: !brief.stepFree || site.stepFree, evidence: brief.stepFree ? (site.stepFree ? "Step-free route recorded" : "Steps on route") : "Not required for this brief" },
  { label: "Tide window", pass: brief.tide === "low" || site.highTide, evidence: site.highTide ? "High- and low-tide windows" : "Low-tide window only" }
];

export const localRouter = {
  model: "tide-rules-v1",
  async infer({ agent, args, call, action, peer }) {
    if (peer) {
      assert(agent.tools.length === 0 && own(args, "inquiry"), "The local router supports read-only briefing peers.");
      return agent.instructions;
    }
    const brief = scenarios[args.scenario];
    switch (agent.name) {
      case "coordinator": {
        const { site, examined } = await call("scout", { scenario: args.scenario });
        if (!site) return { status: "no_match", examined };
        const checks = await call("checker", { scenario: args.scenario, site: site.id });
        assert(checks.every(check => check.pass), "Checker did not clear the proposed site.");
        const briefing = args.briefing ? await call("briefing_peer", { inquiry: "Give the general volunteer briefing." }) : null;
        return { status: "planned", site, checks, examined, briefing };
      }
      case "scout": {
        const catalog = await action("read_cleanup_sites", {});
        return {
          site: catalog.find(site => evaluate(site, brief).every(check => check.pass)) ?? null,
          examined: catalog.length
        };
      }
      case "checker": {
        const site = (await action("read_cleanup_sites", {})).find(item => item.id === args.site);
        assert(site, "The proposed site is missing from the catalog.");
        return evaluate(site, brief);
      }
      default: throw new Error(`No local inference policy for ${agent.name}.`);
    }
  }
};

export async function createRuntime({
  base = new URL(".", import.meta.url),
  fetcher = globalThis.fetch,
  approve = async () => false,
  onEvent = () => {},
  router = localRouter,
  pace = async () => {}
} = {}) {
  const baseURL = webURL(base);
  const guarded = (promise, signal) => {
    signal.throwIfAborted();
    let rejectAbort;
    const abort = new Promise((_, reject) => { rejectAbort = () => reject(signal.reason); });
    signal.addEventListener("abort", rejectAbort, { once: true });
    return Promise.race([promise, abort]).finally(() => signal.removeEventListener("abort", rejectAbort));
  };
  async function readJSON(url, signal) {
    const response = await guarded(fetcher(url, { signal, credentials: "omit", redirect: "error" }), signal);
    assert(response.ok, `Artifact request failed (HTTP ${response.status}).`);
    const text = await guarded(response.text(), signal);
    assert(text.length <= 131_072, "Agent artifact exceeds the size limit.");
    return JSON.parse(text);
  }
  const startup = AbortSignal.timeout(LIMIT.ms);
  const [manifest, linkMap] = await Promise.all([
    readJSON(new URL("agent-manifest.json", baseURL), startup),
    readJSON(new URL("links.json", baseURL), startup)
  ]);
  assert(linkMap?.version === 1 && object(linkMap.networks), "Invalid links.json.");
  assert(manifest?.peer_policy?.mode === "closed" && Array.isArray(manifest.allowed_peers) &&
    Array.isArray(manifest.peer_policy.deny_origins), "Missing closed peer policy.");
  assert(manifest.llm_router?.model === router.model && typeof router.infer === "function", "Default inference model unavailable.");
  const entry = entryFor(manifest, "tide_desk");
  const localURL = webURL(entry.hocon, baseURL);
  assert(localURL.origin === baseURL.origin, "Local graph must be hosted on the caller origin.");
  const localDefinition = await readJSON(localURL, startup);
  const localLinks = linkMap.networks[entry.name] ?? {};
  const local = {
    agents: validateNetwork(localDefinition, entry.front_man, localLinks),
    links: localLinks, identity: new URL(entry.name, baseURL).href, entry, peer: false
  };
  let running = false;
  async function run(args) {
    assert(!running, "A run is already active.");
    running = true;
    const signal = AbortSignal.timeout(LIMIT.ms);
    const stack = new Set([local.identity]);
    let steps = 0;
    let remote = 0;
    const emit = (type, message, agent) => onEvent({ type, message, agent });
    async function contact(url, purpose) {
      signal.throwIfAborted();
      assert(++remote <= LIMIT.remote, "Remote request budget exceeded.");
      if (url.origin !== baseURL.origin) {
        assert(manifest.allowed_peers.includes(url.origin) && !manifest.peer_policy.deny_origins.includes(url.origin),
          `Origin denied: ${url.origin}.`);
        emit("consent", `Awaiting approval: ${purpose} from ${url.origin}`);
        assert(await guarded(approve({ origin: url.origin, purpose, signal }), signal),
          `Contact declined: ${url.origin}.`);
        emit("consent", `Approved: ${purpose}`);
      }
      return readJSON(url, signal);
    }
    async function invoke(network, name, input, depth) {
      signal.throwIfAborted();
      assert(depth <= LIMIT.depth && ++steps <= Math.min(localDefinition.max_steps ?? LIMIT.steps, LIMIT.steps),
        "Agent invocation budget exceeded.");
      const agent = network.agents.get(name);
      checkArgs(agent.function.parameters, input);
      emit("enter", agent.function.description, name);
      await guarded(pace(), signal);
      const result = await guarded(router.infer({
        agent, args: input, peer: network.peer,
        action: async (actionName, actionArgs) => {
          signal.throwIfAborted();
          const action = own(siteActions, actionName) && siteActions[actionName];
          assert(!network.peer && action?.effect === "read" && manifest.actions?.agentTools?.includes(actionName),
            "Unregistered or unauthorized site action.");
          assert(++steps <= Math.min(localDefinition.max_steps ?? LIMIT.steps, LIMIT.steps), "Tool budget exceeded.");
          checkArgs(action.parameters, actionArgs);
          emit("action", `Read ${actionName} on this site`, name);
          return action.handler(actionArgs);
        },
        call: async (target, targetArgs) => {
          signal.throwIfAborted();
          assert(agent.tools.includes(target), `Undeclared delegation: ${target}.`);
          emit("delegate", `${name} → ${target}`, name);
          if (network.agents.has(target)) return invoke(network, target, targetArgs, depth + 1);
          assert(depth < LIMIT.depth && steps < LIMIT.steps, "Peer composition budget exceeded.");
          const url = webURL(http(target) ? target : network.links[target]);
          assert(!stack.has(url.href), "Peer composition cycle.");
          const peerName = url.pathname.split("/").at(-1);
          assert(NAME.test(peerName), "Invalid peer network name.");
          const peerBase = new URL(".", url);
          const peerManifest = await contact(new URL("agent-manifest.json", peerBase), "read the peer manifest");
          const peerEntry = entryFor(peerManifest, peerName);
          const peerDefinition = await contact(webURL(peerEntry.hocon, peerBase), "read the peer network definition");
          const peer = { agents: validateNetwork(peerDefinition, peerEntry.front_man), links: {}, entry: peerEntry, peer: true };
          stack.add(url.href);
          try {
            return await invoke(peer, peerEntry.front_man, targetArgs, depth + 1);
          } finally {
            stack.delete(url.href);
          }
        }
      }), signal);
      emit("return", `${name} returned its result`, name);
      return result;
    }
    try {
      emit("start", `Using ${router.model} in this browser`);
      const result = await invoke(local, entry.front_man, args, 0);
      emit("done", "Run complete");
      return result;
    } catch (error) {
      emit("error", error.message);
      throw error;
    } finally {
      running = false;
    }
  }
  return { manifest, entry, agents: [...local.agents.values()], run };
}
