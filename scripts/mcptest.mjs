// MCP server smoke test: spawns anchor-mcp.mjs, does the JSON-RPC handshake over
// stdio, lists tools, and calls each against a freshly-created mission.
// Run: node scripts/mcptest.mjs
import { spawn } from 'node:child_process';

const BASE = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';

const cm = await (await fetch(`${BASE}/missions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'MCP smoke test mission', constraints: ['be brief'] }) })).json();
if (!cm.mission_id) { console.error('create mission failed:', cm); process.exit(1); }
const KEY = cm.api_key;

const srv = spawn('node', ['mcp/anchor-mcp.mjs'], { env: { ...process.env, ANCHOR_KEY: KEY, ANCHOR_API_BASE: BASE }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
const send = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
const rpc = (id, method, params) => new Promise((res) => { pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });
const must = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) process.exitCode = 1; };

const init = await rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
must(!!init.result, 'initialize ok');
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const tools = await rpc(2, 'tools/list', {});
must(tools.result?.tools?.length === 3, 'tools/list returns 3 tools (' + (tools.result?.tools?.length) + ')');

const ctx = await rpc(3, 'tools/call', { name: 'anchor_get_context', arguments: {} });
must((ctx.result?.content?.[0]?.text || '').includes('MCP smoke test mission'), 'anchor_get_context returns the mission goal');

const rep = await rpc(4, 'tools/call', { name: 'anchor_report_step', arguments: { action: 'Did step one of the test', result: 'wrote a function', outcome: 'done' } });
must((rep.result?.content?.[0]?.text || '').includes('injection_block'), 'anchor_report_step returns refreshed injection_block');

const chk = await rpc(5, 'tools/call', { name: 'anchor_check', arguments: { action: 'go bake some bread, totally unrelated' } });
must((chk.result?.content?.[0]?.text || '').includes('"drift"'), 'anchor_check returns a detection verdict');

srv.kill();
setTimeout(() => console.log(process.exitCode ? '\nMCP FAIL' : '\nMCP ALL PASS'), 50);
