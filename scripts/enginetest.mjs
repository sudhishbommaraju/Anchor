// Phase 1 engine acceptance: dead-end corrective, escalation, bounded injection, phase-gated drift.
// Run: node scripts/enginetest.mjs
const API = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const must = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) process.exitCode = 1; };

const cm = await (await fetch(`${API}/missions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Engine test', goal: 'Fix the failing test_parse_empty unit test in parser.py', constraints: ['No external deps'] }) })).json();
const KEY = cm.api_key;
const report = (action, result, outcome) => fetch(`${API}/v1/report`, { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' }, body: JSON.stringify({ action, result, outcome }) }).then((r) => r.json());

const LOOP_ACTION = 'Wrap json.loads in a try/except and return {} on JSONDecodeError in parser.py';

// Step 1-2: scaffolding / exploration (should NOT drift-flag, and not loop)
const s1 = await report('Set up the project structure and read parser.py', 'created files', 'done');
must(!s1.detection.drift, '(phase-gate) early scaffolding step is not flagged as drift');
const s2 = await report('Run the failing test to see the actual error', 'JSONDecodeError on empty input', 'partial');

// Step 3: first attempt at the buggy fix
const s3 = await report(LOOP_ACTION, 'still failing, empty input not handled', 'failure');
// Step 4: repeat the same failing approach
const s4 = await report(LOOP_ACTION, 'same failure', 'failure');
// Step 5: repeat again
const s5 = await report(LOOP_ACTION, 'same failure', 'failure');
// Step 6: repeat again
const s6 = await report(LOOP_ACTION, 'same failure', 'failure');

const anyLoop = [s4, s5, s6].some((s) => s.detection.loop);
must(anyLoop, 'repeated failing approach is flagged as a CONFIRMED loop');
const loopStep = [s6, s5, s4].find((s) => s.detection.loop) || s6;
const block = loopStep.injection_block || '';
must(/ALREADY FAILED|LOOP DETECTED/i.test(block), 'corrective names the failed approach (dead-end-aware)');
must(/attempt|time\(s\)/i.test(block), 'corrective cites the attempt count');
must(/CATEGORICALLY DIFFERENT|RE-PLAN/i.test(block), 'corrective demands a different/strategy change (not just "restate goal")');

// escalation after repeated hits
const s7 = await report(LOOP_ACTION, 'same failure again', 'failure');
must(/RE-PLAN|missing|assumption/i.test(s7.injection_block || ''), 'escalates to re-plan / needs-input after repeated failures');

// bounded injection: block stays small regardless of accumulated memory
const sizes = [s4, s5, s6, s7].map((s) => (s.injection_block || '').length);
const maxChars = Math.max(...sizes);
must(maxChars < 4800, `injection block bounded (max ${maxChars} chars ≈ ${Math.round(maxChars / 4)} tok, budget 1000)`);

// dead-ends recorded
const ctx = await (await fetch(`${API}/v1/context`, { headers: { authorization: 'Bearer ' + KEY } })).json();
must((ctx.memory.items || []).some((i) => i.type === 'dead_end'), 'dead_end memory items recorded');

console.log('\nSample corrective:\n' + (block.match(/⚠ LOOP DETECTED[\s\S]{0,400}/)?.[0] || '(none)'));
console.log(process.exitCode ? '\nENGINE FAIL' : '\nENGINE PASS');
