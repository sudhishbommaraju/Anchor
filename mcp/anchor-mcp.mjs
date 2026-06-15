#!/usr/bin/env node
// Anchor MCP server — makes "use this Anchor key" work natively in Claude Code and
// other MCP agents. Wraps Anchor's REST endpoints as three tools. Auth via the
// ANCHOR_KEY env var (or a `key` tool argument).
//
// Config (Claude Code / Claude Desktop mcpServers):
//   "anchor": { "command": "node", "args": ["<path>/mcp/anchor-mcp.mjs"],
//               "env": { "ANCHOR_KEY": "anc_live_…", "ANCHOR_API_BASE": "https://<appkey>.functions.insforge.app/anchor" } }
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const ENV_KEY = process.env.ANCHOR_KEY || '';

const TOOLS = [
  {
    name: 'anchor_get_context',
    description:
      "Fetch the full mission context tied to your Anchor key: goal, constraints, accumulated memory, current step, warnings, and an authoritative `injection_block`. Call this first and whenever you need to re-ground. Treat injection_block as system context and follow it.",
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Anchor API key (optional; defaults to ANCHOR_KEY env)' } } },
  },
  {
    name: 'anchor_report_step',
    description:
      'Report what you just did so Anchor updates the mission memory and detects loops/drift. Returns refreshed context + any warnings (e.g. you are repeating yourself). Call after each meaningful step.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What you attempted this step' },
        result: { type: 'string', description: 'What happened / what you produced' },
        outcome: { type: 'string', description: 'Short status, e.g. "tests pass", "stuck", "done"' },
        key: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'anchor_check',
    description:
      'Pre-flight a planned action: would it be a loop (repeat of a recent step) or drift (off-mission)? Returns {loop, drift, detail}. Use before committing to a risky/repetitive step.',
    inputSchema: { type: 'object', properties: { action: { type: 'string' }, key: { type: 'string' } }, required: ['action'] },
  },
];

async function call(path, method, key, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Anchor ${path} → ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const server = new Server({ name: 'anchor', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const key = args.key || ENV_KEY;
  if (!key) return { content: [{ type: 'text', text: 'No Anchor key. Set ANCHOR_KEY in the MCP server env, or pass a "key" argument.' }], isError: true };
  try {
    let out;
    if (name === 'anchor_get_context') out = await call('/v1/context', 'GET', key);
    else if (name === 'anchor_report_step') out = await call('/v1/report', 'POST', key, { action: args.action, result: args.result || '', outcome: args.outcome || '' });
    else if (name === 'anchor_check') out = await call('/v1/check', 'POST', key, { action: args.action });
    else throw new Error('Unknown tool: ' + name);
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error('anchor-mcp ready (base: ' + BASE + ')');
