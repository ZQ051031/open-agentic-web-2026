# Tide Desk

Tide Desk is a browser-local team that plans fictional shoreline cleanups. Pick a sample brief and watch the coordinator hand it to a site scout. The scout reads a local catalog. The constraint checker independently reads it again before clearing the plan. If all sites fail, the coordinator returns no match rather than relaxing the brief. The displayed catalog ID is a demo evidence receipt, not a reservation or a report about real conditions.

**GitHub Pages:** <https://zq051031.github.io/open-agentic-web-2026/>

**Discovery:** [`agent-manifest.json`](https://zq051031.github.io/open-agentic-web-2026/agent-manifest.json)

## Run and test

From the repository root:

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080/> in a current browser. Use HTTP, not a `file://` URL, so the browser can load the modules and JSON. Try **Step-free crew**, **High-tide switch**, and **No safe match**. No install, build, keys, or sign-in are needed. The local server and sample cases work without internet; the opt-in cross-origin briefing needs access to the public GitHub raw artifact origin.

```sh
npm test
```

Tests use the Node 22 built-in test runner. They check the published fields and schema subset, deterministic outputs, tool dispatch and delegation, exact remote resolution, consent and closed peer policy, a fixture MCP exchange, and visible failure paths.

## Open Agentic Web profile mapping

The [official rules](https://cognizant-agenticweb.devpost.com/rules) refer to the spec as published at the start of the submission period: [MVP Profile 0.2](https://github.com/cognizant-ai-labs/agentic-web/blob/fd872b9221aeb8ff762b75a5badbf84b23c133cc/docs/worldwide_agentic_web_mvp_spec.md). The later 0.3 edit makes editorial changes to that document.

| Profile surface | Tide Desk |
| --- | --- |
| §2 and §3.3 — description and discovery | Site-base `agent-manifest.json` includes `networks[].name`, `front_man`, `hocon`, `llm_router` and peer policy. The `hocon` values resolve to JSON documents in the Neuro SAN data model. Each agent has a description, typed parameters, instructions, and allowed tool references. `links.json` resolves the symbolic `briefing_peer` reference. No `.well-known` file is required. |
| §3.1 — browser agent execution | `runtime.js` fetches and validates the actual graph, enforces declared call edges, validates tool inputs and emits live enter, handoff, action, result and error events. `read_cleanup_sites` is a same-site, read-only registered action. There are no write paths. |
| §3.2 and §5 — composition and boundaries | The opt-in briefing resolves the exact `briefing` entry from a second origin hosting the same published repo. The browser asks before each artifact fetch. It does not send credentials, crew details, or private context. The caller runs the peer locally and ignores its router configuration. The runtime rejects redirects, executable peer definitions, disallowed origins, invalid graphs, cycles and over-budget runs. |
| §4 — default inference | `tide-rules-v1` is a deterministic, browser-local inference adapter, not an LLM or a simulated remote call. The adapter is separate from graph orchestration. There is no BYOK. |

The demo uses the site-action path and the published read-only briefing. The runtime also supports an allowlisted, read-only MCP subset over Streamable HTTP, covered by a fixture rather than a live MCP service. Inference adapters can emit text chunks; the demo streams the rule-based briefing by sentence rather than inventing LLM tokens. This is not a general-purpose nsDeploy or arbitrary LLM runtime. The briefing text is rendered as text, never executed as code or HTML.

### Programmatic caller

From a module on the site, use the same entry point as the UI:

```js
import { createRuntime } from "./runtime.js";
const tide = await createRuntime({ onEvent: console.log });
const plan = await tide.run({ scenario: "accessible", briefing: false });
```

An agent-site client can discover the hosted graph from the site base plus `agent-manifest.json`; the peer-reference form for the main network is `https://zq051031.github.io/open-agentic-web-2026/tide_desk`. This identifies a manifest entry; it is not a REST execution endpoint. An independent caller needs an inference and capability implementation compatible with the graph. Tide Desk does not expose an execution server.

## File map

- `index.html`, `styles.css`, `app.js`: responsive UI, activity stream and consent dialog.
- `agent-manifest.json`, `links.json`: public discovery and peer bindings.
- `tide_desk.network.json`, `briefing.network.json`: data-only network definitions.
- `runtime.js`, `site-actions.js`: browser orchestration, deterministic adapter, sample data and read action.
- `runtime.test.mjs`, `package.json`: dependency-free Node tests.
- `DEMO_SCRIPT.md`: recording guide for the entrant.
