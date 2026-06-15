// Anchor benchmark — the SAME task, run twice (no Anchor vs with Anchor), real numbers.
//
// What it models: a long agent session where an early instruction gets buried and lost.
// Both agents run with a bounded CONTEXT WINDOW (last few messages only) — a transparent
// stand-in for early turns scrolling out of a real long session. The task is two functions
// done one-per-turn under an ARBITRARY naming convention ("prefix every function with qz_")
// stated ONCE up front. By the 2nd function the convention has scrolled out of the window:
//   • Baseline: forgot the convention, can't guess it, loops on the 2nd function → never finishes.
//   • With Anchor: the mission constraints (the convention) are re-injected on every call, so
//     it remembers and finishes.
// The convention is un-guessable on purpose — remembering it is the whole job, which is Anchor's.
//
// Run: node bench/bench.mjs   (reads OPENROUTER_API_KEY from .env.local for the baseline)
import OpenAI from 'openai';
import fs from 'node:fs';

const API = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const ORKEY = fs.readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith('OPENROUTER_API_KEY=')).split('=').slice(1).join('=').trim();
const MODEL = 'openai/gpt-4o-mini';
const MAX_STEPS = 12;
const CTX_WINDOW = 2; // messages kept after the system message (simulates a long session losing early context)
const CONVENTION = "Naming convention for this codebase: EVERY function must be prefixed with 'qz_' (e.g. qz_add, qz_sub).";

const AGENT_SYS = 'You are an autonomous coding agent. Each turn output ONLY the requested Python function definition — no prose. Follow all conventions you were given.';
const TASK = `Implement two tiny functions, ONE PER TURN. ${CONVENTION}\nStart now: implement the first function, "add" (returns a + b).`;

// State-machine environment. Accepts a function only if it carries the qz_ prefix.
function makeEnv() {
  let stage = 'add';
  return {
    get done() { return stage === 'done'; },
    step(action) {
      const a = action.toLowerCase();
      if (stage === 'add') {
        if (/def\s+qz_add/.test(a)) { stage = 'sub'; return { ok: true, feedback: 'Accepted. Now implement the second function, "sub" (returns a - b).' }; }
        return { ok: false, badName: /def\s+(?!qz_)/.test(a), feedback: 'Rejected: the function was not accepted. Retry the first function ("add").' };
      }
      // stage === 'sub'
      if (/def\s+qz_sub/.test(a)) { stage = 'done'; return { ok: true, feedback: 'Accepted. Both functions done.' }; }
      return { ok: false, badName: /def\s+(?!qz_)/.test(a), feedback: 'Rejected: the function was not accepted. Retry the second function ("sub").' };
    },
  };
}

async function runAgent(client, label) {
  const messages = [{ role: 'system', content: AGENT_SYS }, { role: 'user', content: TASK }];
  const env = makeEnv();
  let tokIn = 0, tokOut = 0, cost = 0, steps = 0, forgot = 0, completed = false;
  const t0 = Date.now();
  for (let i = 0; i < MAX_STEPS; i++) {
    steps++;
    const windowed = [messages[0], ...messages.slice(1).slice(-CTX_WINDOW)]; // bounded context
    let comp;
    try { comp = await client.chat.completions.create({ model: MODEL, messages: windowed, temperature: 0.4 }); } catch (e) { console.error(label, 'error', e.message); break; }
    const action = comp.choices?.[0]?.message?.content ?? '';
    const u = comp.usage || {};
    tokIn += u.prompt_tokens || 0; tokOut += u.completion_tokens || 0; cost += u.cost || 0;
    messages.push({ role: 'assistant', content: action });
    const r = env.step(action);
    if (r.badName) forgot++;
    process.stdout.write(`  [${label}] step ${steps}: ${r.ok ? '✓ accepted' : r.badName ? '✗ forgot convention' : '✗ rejected'}${env.done ? ' — DONE' : ''}\n`);
    if (env.done) { completed = true; break; }
    messages.push({ role: 'user', content: r.feedback });
  }
  return { label, steps, tokIn, tokOut, tokens: tokIn + tokOut, cost, completed, forgot, ms: Date.now() - t0 };
}

console.log('Running BASELINE (no Anchor)…');
const baseClient = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: ORKEY });
const baseline = await runAgent(baseClient, 'baseline');

console.log('\nRunning WITH ANCHOR (proxy re-injects the convention every call)…');
const cm = await (await fetch(`${API}/missions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bench: naming convention', goal: 'Implement two functions (add, sub), one per turn, following the codebase naming convention.', constraints: [CONVENTION] }) })).json();
const anchorClient = new OpenAI({ baseURL: cm.base_url, apiKey: cm.api_key });
const withAnchor = await runAgent(anchorClient, 'anchor');
const state = await (await fetch(`${API}/missions/${cm.mission_id}?key=${encodeURIComponent(cm.api_key)}`)).json();
withAnchor.anchorLoops = state.stats?.loops ?? 0;
withAnchor.anchorInterventions = state.stats?.interventions ?? 0;

const fmt = (n) => Number(n).toLocaleString();
const net = baseline.tokens - withAnchor.tokens;
const table = `| Metric | Baseline (no Anchor) | With Anchor |
|---|---|---|
| Completed the task? | ${baseline.completed ? `yes (${baseline.steps} steps)` : `**NO** (hit ${MAX_STEPS}-step cap)`} | ${withAnchor.completed ? `**yes** (${withAnchor.steps} steps)` : `no (cap)`} |
| Steps spent forgetting the convention | ${baseline.forgot}× | ${withAnchor.forgot}× |
| Tokens (in + out) | ${fmt(baseline.tokens)} | ${fmt(withAnchor.tokens)} |
| Cost (USD) | $${baseline.cost.toFixed(5)} | $${withAnchor.cost.toFixed(5)} |
| Wall-clock | ${(baseline.ms / 1000).toFixed(1)}s | ${(withAnchor.ms / 1000).toFixed(1)}s |
| Loops Anchor flagged | — | ${withAnchor.anchorLoops} |
| Anchor interventions | — | ${withAnchor.anchorInterventions} |`;
const net2 = baseline.tokens - withAnchor.tokens;
const summary = `**Net tokens saved: ${fmt(net2)}** (${baseline.tokens ? Math.round((net2 / baseline.tokens) * 100) : 0}%). ${withAnchor.completed && !baseline.completed ? 'The task completed **only** with Anchor — the baseline lost the convention and looped on the second function until the step cap.' : `Baseline: ${baseline.steps} steps, Anchor: ${withAnchor.steps} steps.`}`;

console.log('\n' + table + '\n\n' + summary);
fs.mkdirSync('bench', { recursive: true });
fs.writeFileSync('bench/results.md', `# Anchor benchmark — a task that loops\n\nSame task, run twice. Model: \`${MODEL}\`, step cap ${MAX_STEPS}, context window ${CTX_WINDOW} (a transparent stand-in for a long session where early turns scroll out).\n\nThe job: implement two functions one-per-turn under an arbitrary naming convention ("prefix every function with \`qz_\`") stated once up front. By the second function the convention has scrolled out of the window. It is un-guessable on purpose — remembering it is the whole task, which is Anchor's job.\n\n${table}\n\n${summary}\n\n_Reproduce: \`node bench/bench.mjs\`._\n`);
console.log('\nwrote bench/results.md');
