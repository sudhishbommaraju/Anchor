// Anchor hot-path latency probe — measures the overhead Anchor adds on the proxy
// path BEFORE the upstream model starts streaming. Real numbers, not asserted.
//
// For each call it captures:
//   • server preflight (x-anchor-overhead-ms): key-resolve + rate-limit + embed +
//     detect + retrieval + block-build, measured inside the edge function.
//   • per-stage breakdown from the Server-Timing header (embed / detect / retrieve).
//   • client TTFB: wall-clock from request send to first streamed byte (includes
//     network RTT + the server preflight + upstream model's own time-to-first-token).
//
// Run: node bench/latency.mjs   (no OpenRouter key needed — the proxy uses its own)
import fs from 'node:fs';

const API = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const MODEL = 'openai/gpt-4o-mini';
const N = 14;      // total calls
const WARMUP = 2;  // dropped from stats (cold function / connection setup)

function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[i];
}
const median = (a) => pct(a, 50);
const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

function parseServerTiming(h) {
  const out = {};
  if (!h) return out;
  for (const part of h.split(',')) {
    const name = part.trim().split(';')[0].trim();
    const m = part.match(/dur=([0-9.]+)/);
    if (name && m) out[name] = Math.round(parseFloat(m[1]));
  }
  return out;
}

async function oneCall(key, userText) {
  const t0 = Date.now();
  const res = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'You are an autonomous coding agent. Output only a short code snippet.' },
        { role: 'user', content: userText },
      ],
    }),
  });
  const tHeaders = Date.now();
  const overhead = Number(res.headers.get('x-anchor-overhead-ms') || 0);
  const st = parseServerTiming(res.headers.get('server-timing'));
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  // read stream; record first byte
  const reader = res.body.getReader();
  let ttfb = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!ttfb && value && value.length) ttfb = Date.now() - t0;
  }
  return { overhead, embed: st.embed || 0, detect: st.detect || 0, retrieve: st.retrieve || 0, ttfb, headerMs: tHeaders - t0 };
}

const STEPS = [
  'Implement add(a, b) returning a + b.',
  'Now implement subtract(a, b) returning a - b.',
  'Now implement multiply(a, b).',
  'Add a divide(a, b) that guards against zero.',
  'Write a function to reverse a string.',
  'Implement is_palindrome(s).',
  'Write fizzbuzz up to n.',
  'Implement a function to count vowels in a string.',
  'Write a function that returns the max of a list.',
  'Implement binary search over a sorted list.',
  'Write a function to flatten a nested list one level.',
  'Implement a simple memoize decorator.',
  'Write a function to compute factorial iteratively.',
  'Implement a function to check if a number is prime.',
];

async function main() {
  process.stdout.write('Creating mission… ');
  const cm = await (await fetch(`${API}/missions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Latency probe', goal: 'Implement a series of small Python utility functions, one per turn.', constraints: ['Pure standard library'] }),
  })).json();
  const key = cm.api_key;
  if (!key) throw new Error('no api_key from /missions: ' + JSON.stringify(cm).slice(0, 200));
  console.log('ok');

  const rows = [];
  for (let i = 0; i < N; i++) {
    const r = await oneCall(key, STEPS[i % STEPS.length]);
    rows.push(r);
    const tag = i < WARMUP ? ' (warmup)' : '';
    console.log(`call ${String(i + 1).padStart(2)}: overhead=${String(r.overhead).padStart(4)}ms  [embed=${r.embed} detect=${r.detect} retrieve=${r.retrieve}]  ttfb=${r.ttfb}ms${tag}`);
  }

  const m = rows.slice(WARMUP); // measured (drop warmup)
  const col = (k) => m.map((r) => r[k]);
  const stat = (k) => ({ median: median(col(k)), mean: mean(col(k)), p90: pct(col(k), 90) });
  const o = stat('overhead'), e = stat('embed'), d = stat('detect'), rt = stat('retrieve'), t = stat('ttfb');

  const md = `# Anchor hot-path latency

Measured against the live InsForge deployment (\`${API}\`), model \`${MODEL}\`, streaming.
${N} calls, first ${WARMUP} dropped as warm-up; ${m.length} measured.

**Preflight overhead** = everything Anchor adds before the upstream model starts streaming
(key resolve + rate-limit + embed + loop/drift detect + memory retrieval + bounded block build),
measured server-side inside the edge function.

| Metric | Median | Mean | p90 |
|---|---|---|---|
| **Preflight overhead (total)** | **${o.median} ms** | ${o.mean} ms | ${o.p90} ms |
| ↳ embed (text-embedding-3-small) | ${e.median} ms | ${e.mean} ms | ${e.p90} ms |
| ↳ detect (loop/drift RPC) | ${d.median} ms | ${d.mean} ms | ${d.p90} ms |
| ↳ retrieve (memory + plan step) | ${rt.median} ms | ${rt.mean} ms | ${rt.p90} ms |
| Client TTFB (incl. network + model TTFT) | ${t.median} ms | ${t.mean} ms | ${t.p90} ms |

The embedding call dominates preflight (it's the irreducible part — detecting a loop/drift
requires embedding the latest turn). Detect and retrieval run **concurrently** (each only needs
the embedding, not the other), and key-resolve / rate-limit / body-parse are also overlapped, so
preflight is roughly \`embed + max(detect, retrieve)\` rather than their sum.

Anchor's added latency is bounded and independent of session length: the injected block is
token-budgeted, so overhead does not grow as the agent's history grows.

_Regenerate: \`node bench/latency.mjs\`_
`;
  fs.writeFileSync('bench/latency.md', md);
  console.log('\n' + md);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
