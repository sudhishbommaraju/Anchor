// Backend auth + user-scoping + key-history acceptance. Run: node scripts/authtest.mjs
const OSS = process.env.ANCHOR_OSS || 'https://2ecpc69u.us-west.insforge.app';
const API = process.env.ANCHOR_API_BASE || 'https://2ecpc69u.functions.insforge.app/anchor';
const must = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) process.exitCode = 1; };
const stamp = Date.now();
const signup = (email) => fetch(`${OSS}/api/auth/users?client_type=desktop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'anchor123', name: 'Tester' }) }).then((r) => r.json());
const authed = (tok, p, method = 'GET', body) => fetch(`${API}${p}`, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const A = await signup(`a-${stamp}@anchor.test`);
must(!!A.accessToken, 'user A signup returns accessToken (email verification off)');
const tokA = A.accessToken;

const cmA = await (await authed(tokA, '/missions', 'POST', { name: 'Todo App', goal: 'Build a CLI todo app in Python', constraints: ['stdlib only'] })).json();
must(!!cmA.mission_id, 'A creates a mission (user-scoped)');
const keyA = cmA.api_key, midA = cmA.mission_id;

const listA = await (await authed(tokA, '/missions')).json();
must(listA.missions?.some((m) => m.id === midA), 'GET /missions (A) includes A mission');
must(listA.missions?.find((m) => m.id === midA)?.name === 'Todo App', 'mission name returned in list');

await fetch(`${API}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + keyA }, body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }) });
await new Promise((r) => setTimeout(r, 1200)); // let fire-and-forget touch land

const keysA = await (await authed(tokA, '/keys')).json();
const kA = keysA.keys?.find((k) => k.mission.id === midA);
must(!!kA, 'GET /keys (A) includes the key with mission context');
must(kA?.mission?.name === 'Todo App', 'key shows mission name (the "For" context)');
must((kA?.request_count || 0) >= 1, 'request_count bumped after /v1 call (' + kA?.request_count + ')');
must(!!kA?.last_used_at, 'last_used_at set after /v1 call');
must((kA?.usage?.tokens || 0) > 0, 'usage.tokens > 0');

const lab = await (await authed(tokA, `/keys/${kA.id}`, 'PATCH', { label: 'Prod key' })).json();
must(lab.key?.label === 'Prod key', 'PATCH /keys/:id label works');

const B = await signup(`b-${stamp}@anchor.test`);
const tokB = B.accessToken;
const listB = await (await authed(tokB, '/missions')).json();
must(!listB.missions?.some((m) => m.id === midA), 'GET /missions (B) excludes A mission (isolation)');
const keysB = await (await authed(tokB, '/keys')).json();
must(!keysB.keys?.some((k) => k.mission.id === midA), 'GET /keys (B) excludes A key (isolation)');
const labB = await authed(tokB, `/keys/${kA.id}`, 'PATCH', { label: 'hack' });
must(labB.status === 401, 'B cannot label A key (401)');

const un = await fetch(`${API}/missions`);
must(un.status === 401, 'GET /missions without token → 401');

const loginA = await (await fetch(`${OSS}/api/auth/sessions?client_type=desktop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: A.user.email, password: 'anchor123' }) })).json();
must(!!loginA.accessToken, 'login returns accessToken');

console.log(process.exitCode ? '\nAUTH BACKEND FAIL' : '\nAUTH BACKEND PASS');
