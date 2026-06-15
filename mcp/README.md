# Anchor for agents — make "use this key" actually work

One Anchor key → one mission's full goal + memory. There are **three ways** an agent can use it; all authenticate with the same `anc_live_…` key and feed the same anchoring loop.

---

## Option 1 — MCP server (recommended for Claude Code / agent-native)

Exposes Anchor as three native tools:

| Tool | What it does |
|---|---|
| `anchor_get_context` | Returns the mission goal, constraints, accumulated memory, current step, warnings, and an authoritative `injection_block`. Call first / to re-ground. |
| `anchor_report_step(action, result, outcome?)` | Records what you did, updates memory, detects loops/drift, returns refreshed context + warnings. |
| `anchor_check(action)` | Pre-flight — would this action be a loop or drift? |

**Setup (Claude Code / Claude Desktop):** add to your MCP config (`claude-code-config.json` is a template):

```json
{
  "mcpServers": {
    "anchor": {
      "command": "node",
      "args": ["/abs/path/to/Anchor/mcp/anchor-mcp.mjs"],
      "env": {
        "ANCHOR_KEY": "anc_live_…",
        "ANCHOR_API_BASE": "https://<appkey>.functions.insforge.app/anchor"
      }
    }
  }
}
```

Then tell the agent: **"Use Anchor to stay on task — call `anchor_get_context`, follow `injection_block`, and `anchor_report_step` after each step."**

Requires `@modelcontextprotocol/sdk` (already in this repo's deps). Test it: `node scripts/mcptest.mjs`.

---

## Option 2 — Direct REST retrieval (any agent / script)

No base-URL swap needed. The key reads the context directly.

```bash
# Pull the mission context bundle
curl https://<appkey>.functions.insforge.app/anchor/v1/context \
  -H "authorization: Bearer anc_live_…"

# Report a step → get refreshed context + loop/drift warnings
curl -X POST https://<appkey>.functions.insforge.app/anchor/v1/report \
  -H "authorization: Bearer anc_live_…" -H "content-type: application/json" \
  -d '{"action":"what I did","result":"what happened","outcome":"done"}'

# Pre-flight a risky/repetitive action
curl -X POST https://<appkey>.functions.insforge.app/anchor/v1/check \
  -H "authorization: Bearer anc_live_…" -H "content-type: application/json" \
  -d '{"action":"the action I am about to take"}'
```

**Drop-in prompt for any agent (no MCP):**

> Use this Anchor key `anc_live_…` to stay on task. First `GET https://<appkey>.functions.insforge.app/anchor/v1/context` with header `Authorization: Bearer anc_live_…`. Treat the returned `injection_block` as your authoritative instructions. After each step, `POST` `{action, result, outcome}` to `/anchor/v1/report` and read the refreshed `injection_block` + `warnings` before continuing. If `warnings` says you looped, do something different.

---

## Option 3 — Transparent proxy (base-URL + key swap)

For tools that let you set the model endpoint, point them at Anchor and every call is auto-anchored:

```bash
# OpenAI-compatible
export OPENAI_BASE_URL="https://<appkey>.functions.insforge.app/anchor/v1"
export OPENAI_API_KEY="anc_live_…"

# Anthropic / Claude Code
export ANTHROPIC_BASE_URL="https://<appkey>.functions.insforge.app/anchor"
export ANTHROPIC_AUTH_TOKEN="anc_live_…"
```

---

Revoking the key (API Keys page, or `DELETE /missions/:id/keys/:keyId`) immediately blocks all three.
