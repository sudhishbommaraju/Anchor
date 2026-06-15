// Anchor end-to-end demo.
// Proves: (1) create a mission → working key, (2) the OpenAI SDK works against
// Anchor with only a base-URL + key swap, (3) the mission/memory is re-injected
// every call, (4) a repeated step is flagged as a LOOP and corrected, (5) memory
// accumulates + dedupes, (6) token/cost are tracked.
//
// Run:  node demo/demo.mjs
// Optional: ANCHOR_API_BASE=https://<appkey>.functions.insforge.app/anchor
import OpenAI from 'openai';

const API_BASE = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';

const GOAL = 'Build a command-line todo app in Python with add, list, and done commands and JSON file persistence';
const CONSTRAINTS = ['Use only the Python standard library', 'Persist tasks to todos.json'];

const hr = (s = '') => console.log('\n' + '─'.repeat(70) + (s ? '\n' + s : ''));

async function createMission() {
  const r = await fetch(`${API_BASE}/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goal: GOAL, constraints: CONSTRAINTS }),
  });
  const j = await r.json();
  if (!j.mission_id) throw new Error('create failed: ' + JSON.stringify(j));
  return j;
}

function flagStr(h) {
  const tags = [];
  if (h.get('x-anchor-loop') === 'true') tags.push('🔁 LOOP');
  if (h.get('x-anchor-drift') === 'true') tags.push('🧭 DRIFT');
  if (h.get('x-anchor-intervened') === 'true') tags.push('⚓ INTERVENED');
  return tags.length ? tags.join('  ') : '✓ on track';
}

async function main() {
  hr('ANCHOR DEMO — "Set the mission once. Anchor keeps your agent on it."');
  console.log('Goal       :', GOAL);
  console.log('Constraints:', CONSTRAINTS.join(' | '));

  const m = await createMission();
  console.log('\nMission created :', m.mission_id);
  console.log('Anchor base URL :', m.base_url);
  console.log('API key         :', m.key_prefix + '…   (drop-in: OPENAI_BASE_URL + OPENAI_API_KEY)');

  // The ONLY integration change: point the OpenAI SDK at Anchor.
  const client = new OpenAI({ baseURL: m.base_url, apiKey: m.api_key });

  const messages = [
    { role: 'system', content: 'You are a senior Python engineer helping build a CLI tool. Be concise.' },
  ];

  // A scripted "agent": a few real steps, then it gets STUCK and repeats itself.
  const turns = [
    'Give me a one-line plan for building this todo app.',
    'Write the add_task(task) function that appends a task and saves to todos.json.',
    'Write the list command that prints all tasks with an index and status.',
    'I get a JSONDecodeError when todos.json is empty. Fix the load_tasks function.',
    'I get a JSONDecodeError when todos.json is empty. Fix the load_tasks function.', // exact repeat → loop
    'I get a JSONDecodeError when todos.json is empty. Fix the load_tasks function.', // repeat again → loop
    'Quick tangent — what are the best pizza toppings to order tonight?', // off-task → drift
    'Perfect. Now add the done(index) command to mark a task complete.',
  ];

  let tIn = 0, tOut = 0, tCost = 0;
  for (let i = 0; i < turns.length; i++) {
    messages.push({ role: 'user', content: turns[i] });
    const { data: completion, response } = await client.chat.completions
      .create({ model: 'openai/gpt-4o-mini', messages })
      .withResponse();
    const reply = completion.choices[0]?.message?.content ?? '';
    messages.push({ role: 'assistant', content: reply });
    const u = completion.usage || {};
    tIn += u.prompt_tokens || 0;
    tOut += u.completion_tokens || 0;
    tCost += u.cost || 0;

    hr(`TURN ${i + 1}   ${flagStr(response.headers)}`);
    console.log('agent →', turns[i]);
    console.log('model ←', reply.replace(/\s+/g, ' ').slice(0, 170) + (reply.length > 170 ? '…' : ''));
    console.log(`        tokens ${u.prompt_tokens}/${u.completion_tokens}   cost $${(u.cost || 0).toFixed(6)}`);
  }

  // Inspect the run through Anchor's read API (what the live window will render).
  const sres = await fetch(`${API_BASE}/missions/${m.mission_id}?key=${encodeURIComponent(m.api_key)}`);
  const state = await sres.json();

  hr('ANCHOR STATE   (GET /missions/:id — the live window reads this)');
  console.log('status:', state.mission.status);
  console.log('\nPROGRESS SUMMARY (re-injected into every call):');
  console.log('  ' + (state.mission.memory_summary || '(none)'));

  console.log('\nACCUMULATED MEMORY (extracted + deduped across the run):');
  for (const it of state.memory_items) console.log(`  • [${it.type}] ${it.content}`);

  console.log('\nSTEP TIMELINE (agent actions):');
  for (const s of state.steps) {
    if (s.role !== 'agent_request') continue;
    const flags = [];
    if (s.loop_flag) flags.push(`LOOP ${(Number(s.loop_similarity) * 100).toFixed(0)}%`);
    if (s.drift_flag) flags.push('DRIFT');
    if (s.intervened) flags.push('INTERVENED');
    const mark = flags.length ? '⚠ ' + flags.join(' ') : 'ok';
    console.log(`  #${String(s.seq).padStart(2)}  ${mark.padEnd(26)} ${s.content.replace(/\s+/g, ' ').slice(0, 60)}`);
  }

  const st = state.stats || {};
  hr('SPEND');
  console.log(`tokens in: ${st.tokens_in}   tokens out: ${st.tokens_out}   cost: $${Number(st.cost_usd).toFixed(6)}`);
  console.log(`loops: ${st.loops}   drifts: ${st.drifts}   interventions: ${st.interventions}`);
  hr('Set the mission once. Anchor keeps your agent on it.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
