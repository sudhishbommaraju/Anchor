# ⚓ Anchor

**Set the mission once. Anchor keeps your agent on it.**

Anchor is a drop-in proxy that keeps AI coding agents on task. You write your goal
once (a **mission**); Anchor turns it into an API key. Point your agent — Claude
Code, Cursor, the OpenAI/Anthropic SDK, or any script — at Anchor's endpoint with
that key, and from then on **every model call flows through Anchor**. On *every
single call* it:

1. **Re-injects the mission + a continuously-updated memory** into the model's
   context, so the agent never forgets the goal or loses earlier decisions.
2. **Detects looping and drift** by comparing the agent's current step (semantically)
   against its recent steps and against the goal — and injects a corrective when it
   catches one.
3. **Logs everything** — each step, the memory state, where it looped, and the exact
   token/cost spend.

It fixes three of the loudest agent complaints at once: **losing context**, **going
in circles**, and **burning tokens** doing it.

Built entirely on [InsForge](https://insforge.dev) — Postgres + pgvector, the
OpenRouter AI gateway, and a Deno edge function. No separate server stack.

**Anchor is a real-time supervisor — a control plane for AI agents, not a memory store.**
It sits *on top of* whatever memory the agent has and actively intervenes: it tracks failed
approaches, detects loops and drift, and re-grounds the agent mid-run. The point isn't to
remember more; it's to keep the agent *on task*.

---

## Benchmark — measured, not asserted

The same task run twice (`node bench/bench.mjs`): implement two functions one-per-turn under an
arbitrary naming convention stated once, with a bounded context window standing in for a long
session where early turns scroll out. The convention is un-guessable on purpose — remembering it
is the whole job.

| Metric | Baseline (no Anchor) | With Anchor |
|---|---|---|
| Completed the task? | **NO** (hit 12-step cap) | **yes** (2 steps) |
| Steps spent looping on the forgotten rule | 11× | 0× |
| Tokens (in + out) | 1,102 | 467 |
| Cost (USD) | $0.00025 | $0.00009 |

**Net 635 tokens saved (58%), and the task completed *only* with Anchor** — the baseline lost the
convention and looped until the step cap. This is the counterfactual for "saved vs. what?": the
baseline is the same agent without re-injection. (Numbers from a live run; reproduce with
`node bench/bench.mjs`. Engine correctness is verified by `scripts/enginetest.mjs`.)

---

## Isn't this just mem0 / Letta / Zep?

No. Those are **memory stores** — they persist and retrieve facts so the agent can recall more.
Anchor is a **supervisor / control plane**: it watches the agent act and *intervenes in real time*.

- It **detects loops** (semantic repeats, trend + cluster + cyclic) and **drift** (phase-gated,
  plan-aware), with a suspected→confirmed debounce so it doesn't misfire.
- On a confirmed loop its corrective is **dead-end-aware**: it names the approaches you already
  tried, the attempt count, and demands a *categorically different* strategy — restating the goal
  is not enough. It **escalates** to a re-plan / needs-input after repeated failures.
- Its injection is **bounded** (a hard token budget with top-k retrieval), so re-grounding every
  call doesn't blow up cost — net tokens stay positive (see the benchmark).

You can put a memory store *behind* Anchor. Anchor is the layer that decides the agent has gone
off the rails and pulls it back.

---

## Why one injection isn't enough

Agents drift and loop because their original instructions get buried as the
conversation grows. Anchor's core mechanic is **continuous, sequential memory
injection**: the mission and a live, deduped memory are rebuilt and re-injected as a
fresh system block on *every* forwarded request, and the memory is updated after
*every* response. The agent is re-anchored to its goal every time it acts.

---

## Quickstart (under 60 seconds)

### 1. Create a mission

```bash
curl -X POST https://<appkey>.functions.insforge.app/anchor/missions \
  -H "content-type: application/json" \
  -d '{
    "goal": "Build a CLI todo app in Python with add/list/done and JSON persistence",
    "constraints": ["Use only the Python standard library", "Persist tasks to todos.json"]
  }'
```

Returns (the key is shown **once**):

```json
{
  "mission_id": "….",
  "api_key": "anc_live_….",
  "base_url": "https://<appkey>.functions.insforge.app/anchor/v1",
  "anthropic_base_url": "https://<appkey>.functions.insforge.app/anchor"
}
```

Or use the helper, which prints ready-to-paste env exports:

```bash
node demo/create-mission.mjs "Build a CLI todo app in Python" "Use only the standard library"
```

### 2. Point your agent at Anchor — the *only* change

**OpenAI-compatible** (OpenAI SDK, Cursor, most tools):

```bash
export OPENAI_BASE_URL="https://<appkey>.functions.insforge.app/anchor/v1"
export OPENAI_API_KEY="anc_live_…"
```

```js
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY });
// ...use it exactly as normal. Streaming and tools pass through unchanged.
```

**Anthropic-compatible** (Claude Code, Anthropic SDK):

```bash
export ANTHROPIC_BASE_URL="https://<appkey>.functions.insforge.app/anchor"
export ANTHROPIC_AUTH_TOKEN="anc_live_…"
```

### 3. Watch the run

```bash
curl "https://<appkey>.functions.insforge.app/anchor/missions/<mission_id>?key=anc_live_…"
```

Returns the live memory, the step timeline with loop/drift flags, and total spend.

---

## See it in action

```bash
npm install
node demo/demo.mjs
```

The demo creates a mission, points the **OpenAI SDK** at Anchor, and runs a scripted
agent that does real work, then gets stuck and **repeats itself**. Sample output:

```
TURN 4   ✓ on track          agent → I get a JSONDecodeError when todos.json is empty. Fix load_tasks.
TURN 5   🔁 LOOP  ⚓ INTERVENED   (same ask again → caught at 100% similarity, corrective injected)
TURN 6   🔁 LOOP  ⚓ INTERVENED
TURN 7   🧭 DRIFT ⚓ INTERVENED   agent → Quick tangent — best pizza toppings?  (off-task → re-grounded)
TURN 8   ✓ on track          agent → Now add the done(index) command.

STEP TIMELINE
  # 9  ⚠ LOOP 100% INTERVENED   user: I get a JSONDecodeError ...
  #13  ⚠ DRIFT  INTERVENED      user: Quick tangent — best pizza toppings?

SPEND   tokens in: 7370  out: 1372  cost: $0.001909   loops: 2  drifts: 1  interventions: 3
```

On a detected loop the model's reply literally starts *"It seems we're encountering a
loop…"* — proof the corrective was injected and re-grounded it.

---

## How loop & drift detection work

On each call Anchor builds a normalized text of the agent's current action (its last
user/tool message), embeds it with `openai/text-embedding-3-small` (1536-dim) via the
InsForge gateway, and runs one pgvector query:

- **Loop** — cosine similarity to the most-recent *N* agent steps ≥ `loopThreshold`.
- **Drift** — cosine similarity to the mission goal ≤ `driftThreshold`.

Thresholds are **calibrated empirically** for this embedding model (see
`scripts/calibrate.mjs`), not guessed: distinct on-topic steps land at ~0.50–0.55,
exact repeats at ~1.0, and off-topic content at ~0.07 against the goal. Defaults:

| Option | Default | Meaning |
|---|---|---|
| `autoCorrect` | `true` | Inject a corrective on loop/drift (off = alert-only, still logged) |
| `loopThreshold` | `0.85` | Loop if a recent step is this similar or more |
| `driftThreshold` | `0.15` | Drift if goal similarity is this low or less |
| `window` | `8` | How many recent steps to compare against |
| `sequencing` | `false` | Decompose the goal into ordered steps, fed one at a time |
| `model` | `openai/gpt-4o-mini` | Fallback model when the request omits one |
| `byok` | `null` | `{ apiKey, baseUrl }` to bill calls to your own provider key |

Set per-mission in the `options` object at creation, or update with `PATCH`.

---

## API

Base: `https://<appkey>.functions.insforge.app/anchor`

**Proxy** (Path 1 — base-URL + key swap; auto-anchored)
- `POST /v1/chat/completions` — OpenAI-compatible (streaming + non-streaming).
- `POST /v1/messages` — Anthropic-compatible (streaming + non-streaming; text + tools).

**Agent context** (Path 2 — read the key directly; for agents that can't swap the base URL)
- `GET /v1/context` — full bundle behind the key: `{ mission, current_step, memory, warnings, injection_block, guidance }`. Treat `injection_block` as authoritative system context.
- `POST /v1/report` — report `{ action, result, outcome }` → updates memory, detects loop/drift, advances the plan, returns the refreshed `injection_block` + warnings.
- `POST /v1/check` — pre-flight `{ action }` → `{ loop, drift, detail }` without recording.

Also available as an **MCP server** (`anchor_get_context` / `anchor_report_step` / `anchor_check`) for Claude Code — see [`mcp/README.md`](mcp/README.md).

**Control plane**
- `POST /missions` — create a mission → `{ mission_id, api_key, base_url, … }`.
- `GET /missions/:id` — status + memory + step timeline + spend (auth: `?key=` or Bearer).
- `GET /missions/:id/steps?limit=&offset=` — paginated timeline.
- `POST /missions/:id/memory` — manually add a memory item `{ type, content }`.
- `PATCH /missions/:id` — update `status` / `options`. `DELETE /missions/:id` — delete (cascades).
- `GET/POST /missions/:id/keys`, `DELETE /missions/:id/keys/:keyId` — list / rotate / revoke keys.
- `POST /refine` — sharpen a rough goal into `{ goal, constraints }` (Prompt Builder helper).

Anchor stamps every proxied response with `x-anchor-loop`, `x-anchor-drift`,
`x-anchor-intervened`, and `x-anchor-mission` headers.

## Web console

A light, OS-grade multi-page console lives in `web/` (vanilla JS, no build step).
Run `npm run web` → open `http://localhost:8123`.

- **Public:** a landing page (`/`) and `/docs`, plus **email/password auth** (`/signup`, `/login`)
  backed by InsForge JWT. Every mission, key, step, and memory item is scoped to the signed-in user.
- **App (signed in):** Dashboard (aggregate spend + loops), Missions, live **Monitor**
  (memory, timeline, loops/drift, talk-to-your-agent, run-looping-demo), Prompt Builder,
  **API Keys history** (every key with the mission it was for, status, last used, usage),
  Integration (prefilled OpenAI / Claude Code / Direct / MCP snippets), and Settings.
- ⌘K command palette. Protected routes redirect to `/login` when signed out.

---

## How it works (architecture)

```
Agent (Claude Code / Cursor / SDK)
   │  base_url = Anchor,  api_key = mission key
   ▼
Anchor edge function (Deno on InsForge)
   1. authenticate key (sha-256 hash) → resolve mission
   2. embed the agent's current step
   3. loop/drift detection (pgvector, one RPC)
   4. build + inject fresh system block: mission + memory + corrective
   5. forward to the model (OpenRouter, or your BYOK key) — stream passthrough
   6. on response: store step + embedding, extract & dedupe memory, log spend
   ▼
InsForge: Postgres + pgvector · OpenRouter gateway (chat + embeddings) · Deno functions
```

**Reliability:** anchoring is best-effort and wrapped in fallbacks — if any
enhancement step fails, Anchor degrades to a transparent passthrough so it never
breaks the agent. There is no `waitUntil` in the runtime, so post-response work
(memory extraction, step logging) completes within the stream's lifecycle, just
before the stream's final `[DONE]`.

### Data model (Postgres + pgvector)

`missions` · `api_keys` (hash only — raw keys are never stored) · `steps` (with
`vector(1536)` embeddings, loop/drift flags, tokens, cost) · `memory_items` (typed,
deduped, embedded) · `plan_steps`. Schema lives in `migrations/`.

---

## Deploy your own

```bash
npx @insforge/cli create --name Anchor --template empty          # provision project
npx @insforge/cli ai setup                                       # fetch OPENROUTER_API_KEY → .env.local
npx @insforge/cli secrets add OPENROUTER_API_KEY "$(grep OPENROUTER_API_KEY .env.local | cut -d= -f2-)"
npx @insforge/cli db migrations up --all                         # apply the schema
npx @insforge/cli functions deploy anchor --file ./functions/anchor.ts
```

Your base URL is `https://<appkey>.functions.insforge.app/anchor` (the appkey is in
`.insforge/project.json`).

---

## Repo layout

```
functions/anchor.ts     Proxy + agent-context endpoints + control plane (one Deno edge function)
migrations/             Postgres schema: tables, pgvector, similarity/stats RPCs
web/                    Light multi-page operator console (index.html, styles.css, app.js, server.mjs)
mcp/                    MCP server (anchor-mcp.mjs) + Claude Code config + setup README
demo/demo.mjs           End-to-end demo via the OpenAI SDK
demo/create-mission.mjs Helper: create a mission, print env exports
scripts/calibrate.mjs   Threshold calibration probe (embedding cosine measurements)
scripts/uitest.mjs      Headless (jsdom) render test for the web console
scripts/mcptest.mjs     MCP stdio handshake + tool-call test
scripts/acceptance.mjs  Part B end-to-end acceptance tests
```

## Security notes

- API keys are stored as **sha-256 hashes**; only a prefix is ever shown.
- All app DB access goes through the edge function using the service-role key; the
  tables have RLS enabled with default-deny for anon/authenticated.
- Keep `OPENROUTER_API_KEY` server-side (it lives as an InsForge secret, injected into
  the function — never shipped to a client).

## License

MIT
