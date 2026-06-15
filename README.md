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

**Proxy**
- `POST /v1/chat/completions` — OpenAI-compatible (streaming + non-streaming).
- `POST /v1/messages` — Anthropic-compatible (streaming + non-streaming; text + tools).

**Control plane**
- `POST /missions` — create a mission → `{ mission_id, api_key, base_url, … }`.
- `GET /missions/:id` — status + memory + step timeline + spend (auth: `?key=` or Bearer).
- `GET /missions/:id/steps?limit=&offset=` — paginated timeline.
- `POST /missions/:id/memory` — manually add a memory item `{ type, content }`.
- `PATCH /missions/:id` — update `status` / `options`.
- `POST /missions/:id/keys` — rotate / add a key. `DELETE /missions/:id/keys/:keyId` — revoke.

Anchor stamps every proxied response with `x-anchor-loop`, `x-anchor-drift`,
`x-anchor-intervened`, and `x-anchor-mission` headers.

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
functions/anchor.ts     The whole proxy + control plane (one Deno edge function)
migrations/             Postgres schema: tables, pgvector, similarity/stats RPCs
demo/demo.mjs           End-to-end demo via the OpenAI SDK
demo/create-mission.mjs Helper: create a mission, print env exports
scripts/calibrate.mjs   Threshold calibration probe (embedding cosine measurements)
```

## Security notes

- API keys are stored as **sha-256 hashes**; only a prefix is ever shown.
- All app DB access goes through the edge function using the service-role key; the
  tables have RLS enabled with default-deny for anon/authenticated.
- Keep `OPENROUTER_API_KEY` server-side (it lives as an InsForge secret, injected into
  the function — never shipped to a client).

## License

MIT
