// Part B acceptance tests (1,2,3,5). #4 (MCP "use this key") is covered by scripts/mcptest.mjs.
// Run: node scripts/acceptance.mjs
import OpenAI from 'openai';
const BASE = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const must = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) process.exitCode = 1; };
const post = (p, key, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const cm = await (await fetch(`${BASE}/missions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Write a function to reverse a singly linked list in C', constraints: ['No recursion'] }) })).json();
const KEY = cm.api_key, MID = cm.mission_id;
console.log('mission', MID, '\n');

// (1) proxy via the real OpenAI SDK (base-url + key swap only)
const client = new OpenAI({ baseURL: cm.base_url, apiKey: KEY });
const comp = await client.chat.completions.create({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'In one sentence, what is the first step?' }] });
must(!!comp.choices[0]?.message?.content, '(1) proxy: OpenAI SDK returns a normal completion');
const st1 = await (await fetch(`${BASE}/missions/${MID}?key=${KEY}`)).json();
must((st1.stats?.tokens_out || 0) > 0, '(1) proxy: mission stats updated live (tokens_out>0)');

// (2) retrieval
const ctx = await (await fetch(`${BASE}/v1/context`, { headers: { authorization: 'Bearer ' + KEY } })).json();
must(ctx.mission?.goal?.includes('linked list'), '(2) retrieval: /v1/context returns the real mission goal');
must(typeof ctx.injection_block === 'string' && ctx.injection_block.includes('MISSION'), '(2) retrieval: injection_block present and authoritative');

// (3) loop closes via report
await (await post('/v1/report', KEY, { action: 'Implemented reverse() with a three-pointer iterative loop', result: 'prev/cur/next', outcome: 'compiles' })).json();
const rep2 = await (await post('/v1/report', KEY, { action: 'Implemented reverse() with a three-pointer iterative loop', result: 'same', outcome: 'stuck' })).json();
must(rep2.detection?.loop === true, '(3) loop closes: repeated report is flagged as a loop');
must((rep2.memory?.items?.length || 0) > 0, '(3) loop closes: memory accumulated + refreshed injection_block returned');
must(typeof rep2.injection_block === 'string' && rep2.injection_block.length > 0, '(3) loop closes: report returns next injection_block');

// (5) revoke blocks all paths
const keys = await (await fetch(`${BASE}/missions/${MID}/keys?key=${KEY}`)).json();
await fetch(`${BASE}/missions/${MID}/keys/${keys.keys[0].id}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + KEY } });
const [p, ctxA, repA, chkA] = await Promise.all([
  fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }) }),
  fetch(`${BASE}/v1/context`, { headers: { authorization: 'Bearer ' + KEY } }),
  post('/v1/report', KEY, { action: 'x' }),
  post('/v1/check', KEY, { action: 'x' }),
]);
must(p.status === 401 && ctxA.status === 401 && repA.status === 401 && chkA.status === 401, `(5) revoke blocks proxy/context/report/check (got ${p.status}/${ctxA.status}/${repA.status}/${chkA.status})`);

console.log(process.exitCode ? '\nACCEPTANCE FAIL' : '\nACCEPTANCE PASS — #4 (MCP "use this key") verified separately by scripts/mcptest.mjs');
