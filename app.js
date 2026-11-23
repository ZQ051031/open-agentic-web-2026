import { createRuntime } from "./runtime.js";
import { scenarios } from "./site-actions.js";

const get = id => document.getElementById(id);
const log = get("log");
const status = get("status");
const result = get("result");
const fieldset = get("scenarios");
const runButton = get("run");
const peer = get("peer");
const cards = new Map();
const names = { coordinator: "Coordinator", scout: "Site scout", checker: "Constraint checker" };
const roles = { coordinator: "Routes the brief", scout: "Reads catalog", checker: "Verifies fit" };

function node(tag, text, className) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (className) value.className = className;
  return value;
}

for (const [key, brief] of Object.entries(scenarios)) {
  const label = node("label", undefined, "scenario");
  const input = node("input");
  Object.assign(input, { type: "radio", name: "scenario", value: key, checked: key === "accessible" });
  const copy = node("span");
  copy.append(node("strong", brief.label), node("small", brief.detail));
  label.append(input, copy);
  fieldset.append(label);
}

function onEvent({ type, message, agent }) {
  const item = node("li", undefined, type);
  item.append(node("span", String(log.children.length + 1).padStart(2, "0")), node("span", message));
  log.append(item);
  log.scrollTop = log.scrollHeight;
  const card = cards.get(agent);
  if (type === "enter" && card) card.dataset.state = "running";
  if (type === "return" && card) card.dataset.state = "done";
}

function approve({ origin, purpose, details, signal }) {
  const dialog = get("consent");
  get("consent-detail").textContent = `May Tide Desk ${purpose}? Destination: ${origin}. ${details
    ? `Arguments: ${details}` : "No cookies or crew details are sent."}`;
  dialog.returnValue = "deny";
  return new Promise(resolve => {
    function abort() { dialog.close("deny"); }
    dialog.addEventListener("close", () => {
      signal.removeEventListener("abort", abort);
      resolve(dialog.returnValue === "allow");
    }, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    dialog.showModal();
  });
}

function showPlan(plan) {
  result.replaceChildren();
  if (plan.status === "no_match") {
    result.append(node("p", "NO MATCH", "badge no-match"), node("h3", "No site meets this brief"),
      node("p", `The scout screened all ${plan.examined} catalog sites. No constraints were relaxed and no plan was issued.`));
    return;
  }
  result.append(node("p", "CHECKED AGAINST DEMO DATA", "badge"), node("h3", plan.site.name),
    node("p", `Meeting point: ${plan.site.meeting}`));
  const checks = node("ul", undefined, "checks");
  for (const check of plan.checks) {
    const item = node("li");
    item.append(node("strong", check.label), node("span", check.evidence));
    checks.append(item);
  }
  result.append(checks, node("p", `Receipt · Demo catalog v1 · ${plan.site.id}`, "receipt"));
  if (plan.briefing) result.append(node("h4", "Peer briefing"), node("p", plan.briefing));
}

try {
  const runtime = await createRuntime({ onEvent, approve, pace: () => new Promise(resolve => setTimeout(resolve, 380)) });
  for (const agent of runtime.agents) {
    const card = node("li");
    card.append(node("strong", names[agent.name] ?? agent.name), node("span", roles[agent.name] ?? agent.function.description));
    get("agents").append(card);
    cards.set(agent.name, card);
  }
  status.textContent = "Ready";
  fieldset.disabled = runButton.disabled = peer.disabled = false;
  get("brief").addEventListener("submit", async event => {
    event.preventDefault();
    const scenario = new FormData(event.currentTarget).get("scenario");
    fieldset.disabled = runButton.disabled = peer.disabled = true;
    status.textContent = "Running";
    for (const card of cards.values()) delete card.dataset.state;
    log.replaceChildren();
    result.replaceChildren(node("p", "Building the plan…", "placeholder"));
    try {
      showPlan(await runtime.run({ scenario, briefing: peer.checked }));
      status.textContent = "Complete";
    } catch (error) {
      status.textContent = "Stopped";
      result.replaceChildren(node("h3", "Run stopped"), node("p", error.message));
      for (const card of cards.values()) if (card.dataset.state === "running") card.dataset.state = "stopped";
    } finally {
      fieldset.disabled = runButton.disabled = peer.disabled = false;
    }
  });
} catch (error) {
  status.textContent = "Unavailable";
  onEvent({ type: "error", message: error.message });
  result.replaceChildren(node("p", "Could not load the agent network. Serve the site over HTTPS or localhost."));
}
