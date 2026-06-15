// Anchor console — accounts, public landing, and user-scoped app.
const DEFAULT_API_BASE = 'https://2ecpc69u.functions.insforge.app/anchor';
const OSS_BASE = 'https://2ecpc69u.us-west.insforge.app';
const MODELS = ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-haiku', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001'];

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const ICONS = {
  anchor: '<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/>',
  dashboard: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};
function icon(name, cls = 'ic') { return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
const fmtCost = (c) => { const n = Number(c || 0); return '$' + (n === 0 ? '0' : n < 0.01 ? n.toFixed(6) : n.toFixed(4)); };
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
const ago = (iso) => { if (!iso) return 'never'; const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return Math.floor(d) + 's ago'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return Math.floor(d / 86400) + 'd ago'; };
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hide'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hide'), 2600); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); } }
function modal(html, cls = '') { const m = el(`<div class="modal-bg"><div class="modal ${cls}">${html}</div></div>`); document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m) m.remove(); }); return m; }

// ---------- state ----------
const KEY = 'anchor_v3';
let S = Object.assign({ auth: null, selected: null, collapsed: false, keyCache: {}, apiBase: DEFAULT_API_BASE, pending: null }, readStore());
let MISSIONS = [];
let _refreshing = null; // shared in-flight token refresh (refresh tokens rotate; avoid concurrent double-refresh)
function readStore() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
const apiBase = () => S.apiBase || DEFAULT_API_BASE;
const selRef = () => MISSIONS.find((m) => m.id === S.selected);
const openaiBase = () => `${apiBase()}/v1`;

// ---------- auth ----------
const auth = {
  async signUp(email, password, name) {
    const r = await fetch(`${OSS_BASE}/api/auth/users?client_type=desktop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.accessToken) return { error: j.message || j.error || `Signup failed (${r.status})` };
    S.auth = { accessToken: j.accessToken, refreshToken: j.refreshToken, user: j.user }; S.keyCache = {}; save();
    return { ok: true };
  },
  async signIn(email, password) {
    const r = await fetch(`${OSS_BASE}/api/auth/sessions?client_type=desktop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.accessToken) return { error: j.message || j.error || `Login failed (${r.status})` };
    S.auth = { accessToken: j.accessToken, refreshToken: j.refreshToken, user: j.user }; save();
    return { ok: true };
  },
  async refresh() {
    if (!S.auth?.refreshToken) return false;
    if (_refreshing) return _refreshing; // coalesce concurrent refreshes
    _refreshing = (async () => {
      try {
        const r = await fetch(`${OSS_BASE}/api/auth/refresh?client_type=desktop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: S.auth.refreshToken }) });
        if (!r.ok) return false;
        const j = await r.json();
        S.auth = { accessToken: j.accessToken, refreshToken: j.refreshToken || S.auth.refreshToken, user: j.user || S.auth.user }; save();
        return true;
      } catch { return false; }
    })();
    const ok = await _refreshing; _refreshing = null; return ok;
  },
  async signOut() {
    try { await fetch(`${OSS_BASE}/api/auth/logout`, { method: 'POST' }); } catch { /* best effort */ }
    S.auth = null; S.keyCache = {}; S.selected = null; MISSIONS = []; save();
  },
};

// ---------- api client (control plane = user JWT) ----------
async function apiFetch(path, { method = 'GET', body } = {}) {
  const doFetch = (tok) => fetch(`${apiBase()}${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let r = await doFetch(S.auth?.accessToken);
  if (r.status === 401 && S.auth?.refreshToken) {
    if (await auth.refresh()) r = await doFetch(S.auth?.accessToken);
  }
  if (r.status === 401) { await auth.signOut(); location.hash = '#/login'; throw new Error('unauthorized'); }
  return r;
}
const api = {
  refine: (goal) => fetch(`${apiBase()}/refine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal }) }).then((r) => r.json()),
  createMission: (b) => apiFetch('/missions', { method: 'POST', body: b }).then((r) => r.json()),
  listMissions: () => apiFetch('/missions').then((r) => r.json()),
  getMission: (id) => apiFetch(`/missions/${id}`).then((r) => r.json()),
  patch: (id, b) => apiFetch(`/missions/${id}`, { method: 'PATCH', body: b }).then((r) => r.json()),
  del: (id) => apiFetch(`/missions/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  listKeys: () => apiFetch('/keys').then((r) => r.json()),
  createKey: (id, label) => apiFetch(`/missions/${id}/keys`, { method: 'POST', body: { label } }).then((r) => r.json()),
  revokeKey: (id, keyId) => apiFetch(`/missions/${id}/keys/${keyId}`, { method: 'DELETE' }).then((r) => r.json()),
  labelKey: (keyId, label) => apiFetch(`/keys/${keyId}`, { method: 'PATCH', body: { label } }).then((r) => r.json()),
  chat: (missionId, messages, model) => fetch(`${apiBase()}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.keyCache[missionId] }, body: JSON.stringify({ model: model || 'openai/gpt-4o-mini', messages }) }),
};
async function loadMissions() { try { const j = await api.listMissions(); MISSIONS = j.missions || []; } catch { /* handled by apiFetch */ } return MISSIONS; }

// ---------- router ----------
const NAV = [
  { key: 'dashboard', icon: 'dashboard', lbl: 'Dashboard', href: () => '#/dashboard', match: (h) => h === '/dashboard' },
  { key: 'missions', icon: 'list', lbl: 'Missions', href: () => '#/missions', match: (h) => h === '/missions' },
  { key: 'monitor', icon: 'activity', lbl: 'Monitor', href: () => (S.selected ? `#/missions/${S.selected}` : '#/missions'), match: (h) => h.startsWith('/missions/') && h !== '/missions/new' },
  { key: 'builder', icon: 'edit', lbl: 'Prompt Builder', href: () => '#/missions/new', match: (h) => h === '/missions/new' },
  { key: 'keys', icon: 'key', lbl: 'API Keys', href: () => '#/keys', match: (h) => h === '/keys' },
  { key: 'integration', icon: 'link', lbl: 'Integration', href: () => '#/integration', match: (h) => h === '/integration' },
  { key: 'settings', icon: 'settings', lbl: 'Settings', href: () => '#/settings', match: (h) => h === '/settings' },
];
const navSlice = (h, keys) => NAV.filter((n) => keys.includes(n.key)).map((n) => `<a class="navitem ${n.match(h) ? 'active' : ''}" href="${n.href()}">${icon(n.icon)}<span class="lbl">${n.lbl}</span></a>`).join('');
const PUBLIC = ['/', '/docs', '/login', '/signup'];

let pollTimer = null;
const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
const poll = (fn, ms = 2000) => { stopPoll(); fn(); pollTimer = setInterval(() => { if (!document.hidden) fn(); }, ms); };

function route() {
  stopPoll();
  const h = location.hash.replace(/^#/, '') || '/';
  const authed = !!S.auth?.accessToken;
  if (PUBLIC.includes(h)) {
    if (authed && h !== '/docs') { location.hash = '#/dashboard'; return; }
    renderPublic(h);
    return;
  }
  if (!authed) { S.pending = h; save(); location.hash = '#/login'; return; }
  renderShell(h);
  const c = document.getElementById('content');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'missions' && parts[1] === 'new') return pagePromptBuilder(c);
  if (parts[0] === 'missions' && parts[1]) return pageMonitor(c, parts[1]);
  if (parts[0] === 'missions') return pageMissions(c);
  if (parts[0] === 'dashboard') return pageDashboard(c);
  if (parts[0] === 'keys') return pageKeys(c);
  if (parts[0] === 'integration') return pageIntegration(c);
  if (parts[0] === 'settings') return pageSettings(c);
  return pageDashboard(c);
}
window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.auth) { e.preventDefault(); if (!document.querySelector('.palette')) openPalette(); } });

// =========================================================================
//  PUBLIC PAGES (landing / docs / auth)
// =========================================================================
function publicNav(active) {
  return `<header class="pnav">
    <a class="brand-lg" href="#/">${icon('anchor')}<span>Anchor</span></a>
    <nav class="pnav-links">
      <a href="#/docs" class="${active === 'docs' ? 'on' : ''}">How it works</a>
      <a href="#/login" class="btn ghost sm">Log in</a>
      <a href="#/signup" class="btn sm">Get started</a>
    </nav>
  </header>`;
}
function publicFooter() {
  return `<footer class="pfooter">
    <div class="brand-lg sm">${icon('anchor')}<span>Anchor</span></div>
    <div class="pfoot-links"><a href="#/docs">How it works</a><a href="#/login">Log in</a><a href="#/signup">Sign up</a><a href="https://github.com/sudhishbommaraju/Anchor" target="_blank" rel="noreferrer">GitHub</a></div>
    <div class="muted" style="font-size:12px">© 2026 Anchor · Built on InsForge</div>
  </footer>`;
}
function heroMock() {
  return `<div class="mock card">
    <div class="mock-bar"><span class="dot active"></span><span class="muted" style="font-size:12px">Mission · CLI Todo App</span></div>
    <div class="mock-stats">
      <div><div class="mn">5.9k</div><div class="ml">tokens</div></div>
      <div><div class="mn">$0.0016</div><div class="ml">cost</div></div>
      <div><div class="mn" style="color:var(--loop)">2</div><div class="ml">loops</div></div>
    </div>
    <div class="mock-tl">
      <div class="mock-step"><span class="seq">#7</span><span class="flag ok">on track</span> write list command</div>
      <div class="mock-step loop"><span class="seq">#9</span><span class="flag loop">LOOP 100%</span> repeat: fix JSONDecodeError</div>
      <div class="mock-step loop"><span class="seq">#11</span><span class="flag anchor">Anchor stepped in</span> re-grounded</div>
      <div class="mock-step"><span class="seq">#13</span><span class="flag ok">on track</span> add done command</div>
    </div>
  </div>`;
}
function pageLanding(app) {
  app.innerHTML = `<div class="public">${publicNav()}
    <main class="pmain">
      <section class="hero">
        <div class="hero-copy">
          <h1>Set the mission once.<br>Anchor keeps your agent on it.</h1>
          <p class="lead">Anchor is a drop-in layer for AI coding agents that stops them looping, losing context, and burning tokens. Give it your goal, get an API key, and it re-injects your mission and memory into the agent on every step.</p>
          <div class="row" style="gap:12px;margin-top:8px">
            <a class="btn lg" href="#/signup">Get started — it's free ${icon('arrow')}</a>
            <a class="btn ghost lg" href="#/docs">See how it works</a>
          </div>
        </div>
        <div class="hero-visual">${heroMock()}</div>
      </section>

      <section class="psection">
        <h2 class="ph">The problem</h2>
        <div class="cards3">
          ${[['repeat', 'Agents go in circles', 'They retry the same failing approach over and over, never noticing the loop.'],
            ['compass', 'They forget what you told them', 'Your goal and rules get buried as the conversation grows, and the agent drifts.'],
            ['wallet', 'You find out when the bill arrives', 'Every wasted loop is tokens you paid for, with no visibility until it is too late.']].map(([ic, t, d]) =>
            `<div class="card feat"><div class="feat-ic">${icon(ic)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>

      <section class="psection">
        <h2 class="ph">How it works</h2>
        <div class="steps">
          ${[['1', 'Write your mission', 'Your goal plus any rules and constraints — once.'],
            ['2', 'Get an API key', 'Anchor turns the mission into a dedicated key.'],
            ['3', 'Point your agent at it', 'Anchor re-injects mission + memory every step and flags loops in real time.']].map(([n, t, d]) =>
            `<div class="step-card"><div class="step-n">${n}</div><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}
        </div>
      </section>

      <section class="psection">
        <h2 class="ph">What you get</h2>
        <div class="cards2">
          ${[['Continuous memory injection', 'Mission + a deduped, living memory re-injected on every model call.'],
            ['Semantic loop & drift detection', 'pgvector similarity catches repeats and off-task steps, then re-grounds the agent.'],
            ['Live monitoring', 'Watch tokens, cost, loops, and interventions update in real time.'],
            ['Drop-in everywhere', 'Works with Claude Code, Cursor, and any OpenAI- or Anthropic-compatible agent — or read the key directly via REST/MCP.']].map(([t, d]) =>
            `<div class="card feat"><div class="feat-ic sm">${icon('check')}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>

      <section class="cta-band">
        <h2>Keep your agents on task.</h2>
        <a class="btn lg" href="#/signup">Get started ${icon('arrow')}</a>
      </section>
      ${publicFooter()}
    </main></div>`;
}
function pageDocs(app) {
  const k = 'anc_live_…';
  app.innerHTML = `<div class="public">${publicNav('docs')}
    <main class="pmain docs">
      <h1 style="font-size:30px;margin-bottom:8px">How Anchor works</h1>
      <p class="lead" style="max-width:720px">One injection at the start isn't enough — instructions get buried as the conversation grows. Anchor rebuilds and re-injects your mission plus a living memory on <b>every</b> model call, and watches for the agent repeating itself or drifting off task.</p>
      <div class="grid2" style="margin-top:24px">
        <div class="card"><h3 class="sec">1 · Write your mission</h3><p class="muted">Create a mission with your goal and constraints. Anchor embeds the goal for drift detection and mints an <span class="mono">anc_live_</span> key (stored only as a hash).</p></div>
        <div class="card"><h3 class="sec">2 · Anchor proxies every call</h3><p class="muted">It authenticates the key, injects mission + memory, runs loop/drift detection via pgvector, forwards to the model, then updates memory and logs spend.</p></div>
        <div class="card"><h3 class="sec">3 · It re-grounds the agent</h3><p class="muted">A repeated step (cosine ≥ 0.85 to a recent action) is flagged as a loop; an off-goal step (≤ 0.15 to the goal) as drift. Anchor injects a corrective so the agent recovers.</p></div>
        <div class="card"><h3 class="sec">4 · You watch it live</h3><p class="muted">The Monitor shows each step, the re-injected memory, where it looped, and token/cost spend in real time.</p></div>
      </div>
      <h2 class="ph" style="margin-top:32px">Connect any agent</h2>
      <div class="card"><pre class="code"># OpenAI-compatible (Cursor, OpenAI SDK)
export OPENAI_BASE_URL="${openaiBase()}"
export OPENAI_API_KEY="${k}"

# Claude Code / Anthropic
export ANTHROPIC_BASE_URL="${apiBase()}"
export ANTHROPIC_AUTH_TOKEN="${k}"

# Or read the key directly (any agent / MCP)
curl ${apiBase()}/v1/context -H "authorization: Bearer ${k}"</pre></div>
      <div class="cta-band" style="margin-top:32px"><h2>Ready?</h2><a class="btn lg" href="#/signup">Create your account ${icon('arrow')}</a></div>
      ${publicFooter()}
    </main></div>`;
}
function authShell(title, sub, formHtml, footHtml) {
  return `<div class="public auth-bg">
    <a class="brand-lg auth-logo" href="#/">${icon('anchor')}<span>Anchor</span></a>
    <div class="auth-card card">
      <h1>${title}</h1><p class="muted" style="margin-bottom:18px">${sub}</p>
      ${formHtml}
      <div class="auth-foot">${footHtml}</div>
    </div></div>`;
}
function pageLogin(app) {
  app.innerHTML = authShell('Log in', 'Welcome back.',
    `<label>Email</label><input id="aEmail" type="email" autocomplete="email" placeholder="you@example.com"/>
     <label>Password</label><input id="aPass" type="password" autocomplete="current-password" placeholder="••••••••"/>
     <div id="aErr" class="auth-err hide"></div>
     <button class="btn" id="aGo" style="width:100%;justify-content:center;margin-top:16px">Log in</button>`,
    `New here? <a href="#/signup">Create an account</a>`);
  const err = (m) => { const e = document.getElementById('aErr'); e.textContent = m; e.classList.remove('hide'); };
  const submit = async () => {
    const email = document.getElementById('aEmail').value.trim(), pass = document.getElementById('aPass').value;
    if (!email || !pass) return err('Enter your email and password.');
    const b = document.getElementById('aGo'); b.disabled = true; b.innerHTML = 'Logging in… <span class="spin"></span>';
    const res = await auth.signIn(email, pass);
    if (res.error) { err(res.error); b.disabled = false; b.textContent = 'Log in'; return; }
    await loadMissions(); const dest = S.pending; S.pending = null; save(); location.hash = '#' + (dest || '/dashboard');
  };
  document.getElementById('aGo').onclick = submit;
  ['aEmail', 'aPass'].forEach((id) => document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
}
function pageSignup(app) {
  app.innerHTML = authShell('Create your account', 'Set the mission once. Anchor keeps your agent on it.',
    `<label>Name</label><input id="aName" autocomplete="name" placeholder="Ada Lovelace"/>
     <label>Email</label><input id="aEmail" type="email" autocomplete="email" placeholder="you@example.com"/>
     <label>Password</label><input id="aPass" type="password" autocomplete="new-password" placeholder="at least 6 characters"/>
     <label>Confirm password</label><input id="aPass2" type="password" autocomplete="new-password" placeholder="repeat password"/>
     <div id="aErr" class="auth-err hide"></div>
     <button class="btn" id="aGo" style="width:100%;justify-content:center;margin-top:16px">Create account</button>`,
    `Already have an account? <a href="#/login">Log in</a>`);
  const err = (m) => { const e = document.getElementById('aErr'); e.textContent = m; e.classList.remove('hide'); };
  const submit = async () => {
    const name = document.getElementById('aName').value.trim();
    const email = document.getElementById('aEmail').value.trim();
    const pass = document.getElementById('aPass').value, pass2 = document.getElementById('aPass2').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('Enter a valid email address.');
    if (pass.length < 6) return err('Password must be at least 6 characters.');
    if (pass !== pass2) return err('Passwords do not match.');
    const b = document.getElementById('aGo'); b.disabled = true; b.innerHTML = 'Creating… <span class="spin"></span>';
    const res = await auth.signUp(email, pass, name || email.split('@')[0]);
    if (res.error) { err(res.error); b.disabled = false; b.textContent = 'Create account'; return; }
    await loadMissions(); location.hash = '#/dashboard';
  };
  document.getElementById('aGo').onclick = submit;
  ['aName', 'aEmail', 'aPass', 'aPass2'].forEach((id) => document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
}

// =========================================================================
//  APP SHELL (protected)
// =========================================================================
function renderPublic(h) {
  const app = document.getElementById('app');
  app.className = '';
  if (h === '/docs') return pageDocs(app);
  if (h === '/login') return pageLogin(app);
  if (h === '/signup') return pageSignup(app);
  return pageLanding(app);
}
function renderShell(h) {
  const app = document.getElementById('app');
  const opts = MISSIONS.map((m) => `<option value="${m.id}" ${m.id === S.selected ? 'selected' : ''}>${esc(trunc(m.name || m.goal, 34))}</option>`).join('');
  const sel = selRef();
  const switcher = MISSIONS.length
    ? `<div class="lab">Active mission</div>
       <select id="missionSel">${opts}</select>
       <div class="row" style="margin-top:8px; justify-content:space-between; font-size:11px;">
         <span class="pill"><span class="dot ${sel?.status || ''}"></span>${esc(sel?.status || 'active')}</span>
       </div>
       <a class="newbtn" href="#/missions/new">${icon('plus')} New mission</a>`
    : `<div class="lab">No mission yet</div><a class="newbtn" href="#/missions/new">${icon('plus')} Create your first mission</a>`;
  const cur = NAV.find((n) => n.match(h))?.lbl || 'Dashboard';
  const email = S.auth?.user?.email || 'account';
  const initial = (email[0] || 'a').toUpperCase();
  app.innerHTML = `
    <button class="menu-btn" id="menuBtn">${icon('list')}</button>
    <div class="scrim" id="scrim"></div>
    <aside class="sidebar ${S.collapsed ? 'collapsed' : ''}" id="sidebar">
      <div class="brand"><span class="anchor-ic">${icon('anchor')}</span><div><span class="bword">Anchor</span><div class="btag">Set the mission once.</div></div></div>
      <div class="switcher">${switcher}</div>
      <nav class="navlist">
        <div class="nav-group">Overview</div>${navSlice(h, ['dashboard', 'missions', 'monitor'])}
        <div class="nav-group">Build</div>${navSlice(h, ['builder', 'keys', 'integration'])}
        <div class="nav-group">Config</div>${navSlice(h, ['settings'])}
      </nav>
      <div class="collapsebtn" id="collapseBtn">${icon('chevron')}<span class="ctxt">Collapse</span></div>
      <div class="sb-foot"><span class="av">${esc(initial)}</span><span class="who" title="${esc(email)}">${esc(trunc(email, 18))}<br><a id="logoutBtn" class="muted lnk">${icon('logout')} Log out</a></span></div>
    </aside>
    <main class="main">
      <div class="content fade" id="content"></div>
    </main>`;
  document.getElementById('missionSel')?.addEventListener('change', (e) => { S.selected = e.target.value; save(); route(); });
  document.getElementById('collapseBtn').onclick = () => { S.collapsed = !S.collapsed; save(); document.getElementById('sidebar').classList.toggle('collapsed', S.collapsed); };
  document.getElementById('logoutBtn').onclick = async (e) => { e.preventDefault(); await auth.signOut(); location.hash = '#/'; };
  const sb = document.getElementById('sidebar'), scrim = document.getElementById('scrim');
  document.getElementById('menuBtn').onclick = () => { sb.classList.add('open'); scrim.classList.add('show'); };
  scrim.onclick = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
  sb.querySelectorAll('.navitem,.newbtn').forEach((a) => a.addEventListener('click', () => { sb.classList.remove('open'); scrim.classList.remove('show'); }));
}
function openPalette() {
  const cmds = [
    { label: 'Dashboard', hint: 'go', ic: 'dashboard', run: () => (location.hash = '#/dashboard') },
    { label: 'Missions', hint: 'go', ic: 'list', run: () => (location.hash = '#/missions') },
    { label: 'New mission — Prompt Builder', hint: 'create', ic: 'edit', run: () => (location.hash = '#/missions/new') },
    { label: 'API Keys', hint: 'go', ic: 'key', run: () => (location.hash = '#/keys') },
    { label: 'Integration', hint: 'go', ic: 'link', run: () => (location.hash = '#/integration') },
    { label: 'Settings', hint: 'go', ic: 'settings', run: () => (location.hash = '#/settings') },
    { label: 'Log out', hint: 'account', ic: 'logout', run: async () => { await auth.signOut(); location.hash = '#/'; } },
    ...MISSIONS.map((m) => ({ label: 'Switch to: ' + trunc(m.name || m.goal, 38), hint: 'mission', ic: 'activity', run: () => { S.selected = m.id; save(); location.hash = `#/missions/${m.id}`; } })),
  ];
  const bg = el(`<div class="modal-bg"><div class="modal palette"><div class="pin">${icon('search')}<input id="pq" placeholder="Type a command or mission…" autocomplete="off"/></div><div class="plist" id="plist"></div></div></div>`);
  document.body.appendChild(bg);
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  const input = bg.querySelector('#pq'), list = bg.querySelector('#plist');
  let sel = 0, filtered = cmds;
  const render = () => {
    list.innerHTML = filtered.map((c, i) => `<div class="pitem ${i === sel ? 'sel' : ''}" data-i="${i}">${icon(c.ic)}<span>${esc(c.label)}</span><span class="ph">${c.hint}</span></div>`).join('') || '<div class="pitem muted">No matches</div>';
    list.querySelectorAll('.pitem[data-i]').forEach((it) => (it.onclick = () => { filtered[+it.dataset.i].run(); bg.remove(); }));
  };
  input.addEventListener('input', () => { const q = input.value.toLowerCase().trim(); filtered = q ? cmds.filter((c) => c.label.toLowerCase().includes(q)) : cmds; sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run(); bg.remove(); }
    else if (e.key === 'Escape') bg.remove();
  });
  render(); input.focus();
}

// ---------- shared bits ----------
function statRow(st) {
  st = st || {};
  const n = (v) => Number(v || 0).toLocaleString();
  const cell = (label, val, color) => `<div class="cell"><div class="cl">${label}</div><div class="cv"${color ? ` style="color:${color}"` : ''}>${val}</div></div>`;
  return `<div class="statrow">
    ${cell('Tokens In', n(st.tokens_in))}
    ${cell('Tokens Out', n(st.tokens_out))}
    ${cell('Cost', fmtCost(st.cost_usd))}
    ${cell('Loops', st.loops || 0, 'var(--loop)')}
    ${cell('Drifts', st.drifts || 0, 'var(--drift)')}
    ${cell('Interventions', st.interventions || 0, 'var(--accent)')}
  </div>`;
}
const emptyState = (iconName, title, sub, btnLabel, btnHref) =>
  `<div class="card"><div class="empty"><div class="big">${icon(iconName)}</div><h2>${title}</h2><p>${sub}</p>${btnHref ? `<a class="btn" href="${btnHref}" style="display:inline-flex;margin-top:14px">${btnLabel}</a>` : ''}</div></div>`;
const needMission = (c) => { c.innerHTML = emptyState('anchor', 'No mission selected', 'Create a mission first, then this page will have something to show.', 'Open Prompt Builder', '#/missions/new'); };

// ---------- Dashboard ----------
async function pageDashboard(c) {
  c.innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><div class="sub">Overview across your missions</div></div><a class="btn" href="#/missions/new">${icon('plus')} New mission</a></div><div id="dash"><div class="card muted">Loading… <span class="spin"></span></div></div>`;
  await loadMissions();
  const dash = document.getElementById('dash');
  if (!MISSIONS.length) { dash.innerHTML = emptyState('anchor', 'No missions yet', 'Anchor keeps your agents on task. Create your first mission to begin.', 'Create your first mission', '#/missions/new'); return; }
  const agg = MISSIONS.reduce((a, m) => { a.tin += +m.tokens_in || 0; a.tout += +m.tokens_out || 0; a.cost += +m.cost_usd || 0; a.loops += +m.loops || 0; a.interv += +m.interventions || 0; if (m.status === 'active') a.active++; return a; }, { tin: 0, tout: 0, cost: 0, loops: 0, interv: 0, active: 0 });
  const maxCost = Math.max(...MISSIONS.map((m) => +m.cost_usd || 0), 0.000001);
  dash.innerHTML = `
    <div class="card"><div class="stats">
      <div class="stat"><div class="n">${MISSIONS.length}</div><div class="l">missions</div></div>
      <div class="stat"><div class="n">${agg.active}</div><div class="l">active</div></div>
      <div class="stat"><div class="n">${agg.tin + agg.tout}</div><div class="l">total tokens</div></div>
      <div class="stat"><div class="n">${fmtCost(agg.cost)}</div><div class="l">total cost</div></div>
      <div class="stat ${agg.loops > 0 ? 'on' : ''}"><div class="n">${agg.loops}</div><div class="l"><span class="ldot"></span>loops caught</div></div>
      <div class="stat"><div class="n">${agg.interv}</div><div class="l">interventions</div></div>
    </div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h3 class="sec">Recent missions</h3><table class="tbl"><thead><tr><th>Mission</th><th>Status</th><th class="num">Cost</th><th class="num">Loops</th><th>Activity</th></tr></thead><tbody>
        ${MISSIONS.map((m) => `<tr class="clk" data-id="${m.id}"><td>${esc(trunc(m.name || m.goal, 40))}</td><td><span class="st st-${m.status}">${m.status}</span></td><td class="num">${fmtCost(m.cost_usd)}</td><td class="num">${m.loops || 0}</td><td class="muted">${ago(m.updated_at || m.created_at)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card"><h3 class="sec">Cost by mission</h3><div style="display:flex;flex-direction:column;gap:10px">
        ${MISSIONS.map((m) => { const v = +m.cost_usd || 0; return `<div><div class="row" style="justify-content:space-between;font-size:12px"><span>${esc(trunc(m.name || m.goal, 32))}</span><span class="muted num">${fmtCost(v)}</span></div><div class="spark"><div class="bar" style="height:${Math.max(4, (v / maxCost) * 44)}px;width:100%"></div></div></div>`; }).join('')}
      </div></div>
    </div>`;
  dash.querySelectorAll('tr.clk').forEach((tr) => (tr.onclick = () => { S.selected = tr.dataset.id; save(); location.hash = `#/missions/${tr.dataset.id}`; }));
}

// ---------- Missions ----------
async function pageMissions(c) {
  c.innerHTML = `<div class="page-head"><div><h1>Missions</h1><div class="sub">Manage all your missions</div></div><a class="btn" href="#/missions/new">${icon('plus')} New mission</a></div><div id="ml"><div class="card muted">Loading… <span class="spin"></span></div></div>`;
  await loadMissions();
  const ml = document.getElementById('ml');
  if (!MISSIONS.length) { ml.innerHTML = emptyState('list', 'No missions yet', 'Create one to get started.', 'Create mission', '#/missions/new'); return; }
  ml.innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Mission</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Loop/Drift</th><th>Created</th><th></th></tr></thead><tbody>
    ${MISSIONS.map((m) => `<tr><td><a href="#/missions/${m.id}">${esc(trunc(m.name || m.goal, 40))}</a><div class="muted" style="font-size:11px">${esc(trunc(m.goal, 52))}</div></td>
      <td><span class="st st-${m.status}">${m.status}</span></td>
      <td class="num">${(+m.tokens_in || 0) + (+m.tokens_out || 0)}</td><td class="num">${fmtCost(m.cost_usd)}</td>
      <td class="num">${m.loops || 0}/${m.drifts || 0}</td><td class="muted">${ago(m.created_at)}</td>
      <td><div class="row">
        <a class="btn ghost sm" href="#/missions/${m.id}">Open</a>
        <button class="btn ghost sm" data-toggle="${m.id}" data-st="${m.status === 'active' ? 'paused' : 'active'}">${m.status === 'active' ? 'Pause' : 'Resume'}</button>
        <button class="btn ghost sm" data-complete="${m.id}">Complete</button>
        <button class="btn danger sm" data-del="${m.id}">Delete</button>
      </div></td></tr>`).join('')}
  </tbody></table></div>`;
  ml.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => { await api.patch(b.dataset.toggle, { status: b.dataset.st }); toast('Updated'); pageMissions(c); }));
  ml.querySelectorAll('[data-complete]').forEach((b) => (b.onclick = async () => { await api.patch(b.dataset.complete, { status: 'completed' }); toast('Completed'); pageMissions(c); }));
  ml.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    const mo = modal(`<h2>Delete mission?</h2><p class="muted">This permanently deletes the mission, its keys, steps, and memory.</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="cx">Cancel</button><button class="btn danger" id="cy">Delete</button></div>`);
    mo.querySelector('#cx').onclick = () => mo.remove();
    mo.querySelector('#cy').onclick = async () => { await api.del(b.dataset.del); delete S.keyCache[b.dataset.del]; if (S.selected === b.dataset.del) S.selected = null; save(); mo.remove(); toast('Deleted'); pageMissions(c); };
  }));
}

// ---------- Monitor ----------
function pageMonitor(c, id) {
  if (S.selected !== id) { S.selected = id; save(); }
  const hasKey = !!S.keyCache[id];
  c.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
        <div style="display:flex;flex-direction:column;gap:8px">
          <h1 id="mName" style="font-size:22px;font-weight:600;letter-spacing:-0.5px;line-height:1.25;margin:0">…</h1>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="livepill active" id="mStatus"><span class="ld"></span>active</span>
            <span class="mono" id="mUpdated" style="font-size:11px;color:var(--muted)"></span>
          </div>
          <div class="sub" id="mGoal" style="margin-top:2px"></div>
        </div>
        ${hasKey ? `<button class="btn ghost" id="mDemo">${icon('play')} Run demo</button>` : ''}
      </div>
      <div id="mStats">${statRow({})}</div>
      <div><h3 class="sec">Live Memory</h3><div class="summary" id="mSummary" style="margin-bottom:8px">—</div><div class="memlist" id="mMem"></div></div>
      <div><h3 class="sec">Step Timeline <span class="muted" id="mTlc"></span></h3><div class="tlist" id="mTl"></div></div>
      <div class="card"><h3 class="sec">Talk to your agent</h3>
        ${hasKey ? `<div class="row"><input id="mIn" placeholder="Type a message the agent would send to the model…" style="flex:1;min-width:240px"/><button class="btn" id="mSend">Send</button></div><div class="muted" id="mReply" style="margin-top:10px"></div>`
          : `<p class="muted">This browser doesn't hold this mission's secret key. <a href="#/keys">Generate a key</a> to talk to the agent here.</p>`}
      </div>
      <div class="card hide" id="mInjCard"><div class="row" style="justify-content:space-between"><h3 class="sec" style="margin:0">Injected system block (this step)</h3><button class="btn ghost sm" id="mInjX">close</button></div><pre class="code" id="mInj" style="margin-top:10px"></pre></div>
    </div>`;

  const convo = [{ role: 'system', content: 'You are a senior engineer. Be concise.' }];
  const renderState = (s) => {
    if (s.error || !s.mission) { document.getElementById('mName').textContent = 'Mission not found'; return; }
    const m = s.mission;
    document.getElementById('mName').textContent = m.name || m.goal;
    document.getElementById('mGoal').textContent = m.name && m.name !== m.goal ? m.goal : '';
    const stt = m.status || 'active';
    const sp = document.getElementById('mStatus'); sp.className = 'livepill ' + stt; sp.innerHTML = `<span class="ld"></span>${stt}`;
    document.getElementById('mUpdated').textContent = 'Updated ' + ago(m.updated_at || m.created_at);
    document.getElementById('mStats').innerHTML = statRow(s.stats);
    document.getElementById('mSummary').textContent = m.memory_summary || '(nothing recorded yet)';
    const mem = document.getElementById('mMem');
    mem.innerHTML = (s.memory_items || []).map((it) => `<div class="memrow"><span class="mbadge ${it.type}">${it.type}</span><span class="mtext">${esc(it.content)}</span></div>`).join('') || '<div class="memrow"><span class="mtext muted">(empty — memory builds as the agent works)</span></div>';
    const reqs = (s.steps || []).filter((x) => x.role === 'agent_request').slice().reverse();
    document.getElementById('mTlc').textContent = reqs.length ? `(${reqs.length})` : '';
    const tl = document.getElementById('mTl');
    if (!reqs.length) { tl.innerHTML = `<div class="memrow"><span class="mtext muted">No steps yet — point your agent at this mission's key${hasKey ? ', or press Run demo' : ''}.</span></div>`; return; }
    tl.innerHTML = '';
    for (const step of reqs) {
      const cls = step.loop_flag ? 'loop' : step.drift_flag ? 'drift' : '';
      const badges = [];
      if (step.loop_flag) badges.push(`<span class="tb loop">LOOP ${(Number(step.loop_similarity) * 100).toFixed(0)}%</span>`);
      if (step.drift_flag) badges.push('<span class="tb drift">DRIFT</span>');
      if (step.intervened) badges.push('<span class="tb interv">INTERVENED</span>');
      const div = el(`<div class="trow ${cls}"><span class="tseq">${step.seq}</span><span class="ttext">${esc(trunc((step.content || '').replace(/^user:\s*/, ''), 140))}</span>${badges.length ? `<div class="tbadges">${badges.join('')}</div>` : ''}</div>`);
      div.onclick = () => { const inj = step.meta?.injected_preview; if (!inj) return toast('No injected block for this step'); document.getElementById('mInj').textContent = inj; document.getElementById('mInjCard').classList.remove('hide'); document.getElementById('mInjCard').scrollIntoView({ behavior: 'smooth' }); };
      tl.appendChild(div);
    }
  };
  const refresh = async () => { try { renderState(await api.getMission(id)); } catch { /* transient/401 handled */ } };

  if (hasKey) {
    const send = async (text) => {
      convo.push({ role: 'user', content: text });
      const r = await api.chat(id, convo);
      const data = await r.json();
      const reply = data.choices?.[0]?.message?.content ?? '(no reply)';
      convo.push({ role: 'assistant', content: reply });
      const tags = [];
      if (r.headers.get('x-anchor-loop') === 'true') tags.push('LOOP');
      if (r.headers.get('x-anchor-drift') === 'true') tags.push('DRIFT');
      if (r.headers.get('x-anchor-intervened') === 'true') tags.push('INTERVENED');
      document.getElementById('mReply').innerHTML = (tags.length ? `<b style="color:var(--loop)">${tags.join('  ')}</b> — ` : '') + esc(trunc(reply.replace(/\s+/g, ' '), 280));
      await refresh();
    };
    document.getElementById('mInjX').onclick = () => document.getElementById('mInjCard').classList.add('hide');
    document.getElementById('mSend').onclick = async () => { const i = document.getElementById('mIn'); const t = i.value.trim(); if (!t) return; i.value = ''; const b = document.getElementById('mSend'); b.disabled = true; try { await send(t); } catch (e) { toast('Error: ' + e.message); } b.disabled = false; };
    document.getElementById('mIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('mSend').click(); });
    const DEMO = ['Give me a one-line plan for building this.', 'Write the add_task(task) function and save to todos.json.', 'Write the list command that prints all tasks with status.', 'I get a JSONDecodeError when todos.json is empty. Fix load_tasks.', 'I get a JSONDecodeError when todos.json is empty. Fix load_tasks.', 'I get a JSONDecodeError when todos.json is empty. Fix load_tasks.', 'Quick tangent — best pizza toppings to order tonight?', 'Perfect. Now add the done(index) command.'];
    document.getElementById('mDemo').onclick = async () => { const b = document.getElementById('mDemo'), sb = document.getElementById('mSend'); b.disabled = sb.disabled = true; for (let i = 0; i < DEMO.length; i++) { b.textContent = `running ${i + 1}/${DEMO.length}…`; try { await send(DEMO[i]); } catch (e) { toast('Error: ' + e.message); } await new Promise((r) => setTimeout(r, 350)); } b.innerHTML = icon('play') + ' Run demo'; b.disabled = sb.disabled = false; };
  }
  poll(refresh, 2000);
}

// ---------- Prompt Builder ----------
function pagePromptBuilder(c) {
  let constraints = ['Use only the Python standard library', 'Persist tasks to todos.json'];
  c.innerHTML = `<div class="page-head"><div><h1>Prompt Builder</h1><div class="sub">Write the mission once — Anchor keeps the agent on it</div></div></div>
    <div class="card">
      <label>Mission name</label>
      <input id="pName" placeholder="CLI Todo App"/>
      <label>Mission goal — what should the agent accomplish?</label>
      <textarea id="pGoal" style="min-height:84px" placeholder="Build a command-line todo app in Python…">Build a command-line todo app in Python with add, list, and done commands and JSON file persistence</textarea>
      <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="pRefine">${icon('sparkles')} Refine with AI</button><span class="muted" id="pRefineMsg"></span></div>
      <label>Constraints (must / must-not)</label>
      <div class="row"><input id="pConsIn" placeholder="e.g. Use only the Python standard library" style="flex:1"/><button class="btn ghost" id="pConsAdd">Add</button></div>
      <div class="chips" id="pChips"></div>
      <details style="margin-top:18px"><summary class="muted" style="cursor:pointer">Advanced options</summary>
        <div class="grid2" style="margin-top:12px">
          <div><label>Model</label><select id="pModel">${MODELS.map((x) => `<option ${x === 'openai/gpt-4o-mini' ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div><label>Auto-correct on loop/drift</label><label class="toggle" style="margin-top:6px"><input type="checkbox" id="pAuto" checked><span class="tr"></span><span class="muted">inject correctives</span></label></div>
          <div><label>Loop threshold</label><input id="pLoop" type="number" step="0.01" min="0" max="1" value="0.85"/></div>
          <div><label>Drift threshold</label><input id="pDrift" type="number" step="0.01" min="0" max="1" value="0.15"/></div>
          <div><label>Sequencing</label><label class="toggle" style="margin-top:6px"><input type="checkbox" id="pSeq"><span class="tr"></span><span class="muted">feed plan steps one at a time</span></label></div>
          <div><label>BYOK provider key (optional)</label><input id="pByok" placeholder="sk-… (blank = Anchor's gateway)"/></div>
        </div>
      </details>
      <div class="row" style="margin-top:18px"><button class="btn" id="pCreate">Create mission</button><span class="muted" id="pMsg"></span></div>
    </div>`;
  const renderChips = () => { document.getElementById('pChips').innerHTML = constraints.map((c2, i) => `<span class="chip">${esc(c2)}<span class="x" data-i="${i}">✕</span></span>`).join('') || '<span class="muted" style="font-size:12px">No constraints yet</span>'; document.querySelectorAll('#pChips .x').forEach((x) => (x.onclick = () => { constraints.splice(+x.dataset.i, 1); renderChips(); })); };
  const addCons = () => { const v = document.getElementById('pConsIn').value.trim(); if (v) { constraints.push(v); document.getElementById('pConsIn').value = ''; renderChips(); } };
  renderChips();
  document.getElementById('pConsAdd').onclick = addCons;
  document.getElementById('pConsIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCons(); } });
  document.getElementById('pRefine').onclick = async () => {
    const g = document.getElementById('pGoal').value.trim(); if (!g) return toast('Enter a rough goal first');
    const msg = document.getElementById('pRefineMsg'); msg.innerHTML = 'Refining… <span class="spin"></span>';
    try { const r = await api.refine(g); document.getElementById('pGoal').value = r.goal || g; if (Array.isArray(r.constraints) && r.constraints.length) { constraints = r.constraints; renderChips(); } msg.textContent = 'Sharpened ✓'; } catch { msg.textContent = 'Refine failed'; }
  };
  document.getElementById('pCreate').onclick = async () => {
    const goal = document.getElementById('pGoal').value.trim(); if (!goal) return toast('Enter a goal');
    const name = document.getElementById('pName').value.trim() || goal.slice(0, 48);
    const options = { model: document.getElementById('pModel').value, autoCorrect: document.getElementById('pAuto').checked, sequencing: document.getElementById('pSeq').checked, loopThreshold: +document.getElementById('pLoop').value, driftThreshold: +document.getElementById('pDrift').value };
    const byok = document.getElementById('pByok').value.trim(); if (byok) options.byok = { apiKey: byok };
    const btn = document.getElementById('pCreate'); btn.disabled = true; document.getElementById('pMsg').innerHTML = 'Creating… <span class="spin"></span>';
    try {
      const j = await api.createMission({ name, goal, constraints, options });
      if (!j.mission_id) throw new Error(j.error || JSON.stringify(j));
      S.keyCache[j.mission_id] = j.api_key; S.selected = j.mission_id; save();
      await loadMissions();
      revealKeyModal(j.api_key, j.mission_id, true);
    } catch (e) { document.getElementById('pMsg').textContent = 'Failed: ' + e.message; btn.disabled = false; }
  };
}
function revealKeyModal(key, missionId, isNew) {
  const mo = modal(`<h2>${isNew ? 'Mission created' : 'New API key'}</h2>
    <p class="muted">Copy your key now — the full secret is shown <b>once</b>.</p>
    <label>API key</label><div class="copybar"><code id="rkKey">${esc(key)}</code><button class="btn sm" id="rkCopy">Copy</button></div>
    <label>OpenAI base URL</label><div class="copybar"><code>${esc(openaiBase())}</code><button class="btn sm" data-c="${esc(openaiBase())}">Copy</button></div>
    <p class="warn" style="margin-top:12px">Store it securely. You won't be able to see it again.</p>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><a class="btn ghost" href="#/keys" id="rkKeys">API Keys</a><a class="btn" href="#/missions/${missionId}" id="rkMon">Open Monitor</a></div>`);
  mo.querySelector('#rkCopy').onclick = () => copy(key);
  mo.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => copy(b.dataset.c)));
  mo.querySelectorAll('#rkKeys,#rkMon').forEach((a) => a.addEventListener('click', () => mo.remove()));
}

// ---------- API Keys (user-scoped history) ----------
let keyFilter = { show: 'all', q: '' };
async function pageKeys(c) {
  c.innerHTML = `<div class="page-head"><div><h1>API Keys</h1><div class="sub">Every key you've created, and which mission it was for</div></div>
    <button class="btn" id="kNew">${icon('plus')} Generate key</button></div>
    <div class="card" style="padding:12px 14px;margin-bottom:14px"><div class="row" style="justify-content:space-between">
      <div class="row" style="gap:6px"><button class="btn flat sm filt" data-f="all">All</button><button class="btn flat sm filt" data-f="active">Active</button><button class="btn flat sm filt" data-f="revoked">Revoked</button></div>
      <div style="position:relative"><input id="kSearch" placeholder="Search by mission or label" style="width:240px;padding-left:32px"/><span style="position:absolute;left:9px;top:9px;color:var(--muted)">${icon('search')}</span></div>
    </div></div>
    <div id="kbody"><div class="card muted">Loading… <span class="spin"></span></div></div>`;
  document.getElementById('kNew').onclick = () => generateKeyFlow(() => pageKeys(c));
  document.getElementById('kSearch').value = keyFilter.q;
  document.getElementById('kSearch').addEventListener('input', (e) => { keyFilter.q = e.target.value; renderKeyTable(); });
  c.querySelectorAll('.filt').forEach((b) => (b.onclick = () => { keyFilter.show = b.dataset.f; renderKeyTable(); }));

  let allKeys = [];
  const renderKeyTable = () => {
    c.querySelectorAll('.filt').forEach((b) => b.classList.toggle('on', b.dataset.f === keyFilter.show));
    const q = keyFilter.q.toLowerCase();
    const rows = allKeys.filter((k) => (keyFilter.show === 'all' || k.status === keyFilter.show) && (!q || (k.mission?.name || '').toLowerCase().includes(q) || (k.mission?.goal || '').toLowerCase().includes(q) || (k.label || '').toLowerCase().includes(q)));
    const body = document.getElementById('kbody');
    if (!allKeys.length) { body.innerHTML = emptyState('key', 'No keys yet', 'Create a mission to generate your first key.', 'Create mission', '#/missions/new'); return; }
    body.innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Key</th><th>For</th><th>Status</th><th>Created</th><th>Last used</th><th class="num">Usage</th><th></th></tr></thead><tbody>
      ${rows.map((k) => {
        const cached = S.keyCache[k.mission?.id] && S.keyCache[k.mission.id].startsWith(k.key_prefix);
        return `<tr>
          <td class="mono">${esc(k.key_prefix)}…${k.label ? `<div class="muted" style="font-size:11px;font-family:var(--fs)">${esc(k.label)}</div>` : ''}</td>
          <td><a href="#/missions/${k.mission?.id}">${esc(trunc(k.mission?.name || 'mission', 28))}</a><div class="muted" style="font-size:11px">${esc(trunc(k.mission?.goal || '', 44))}</div></td>
          <td><span class="st st-${k.status}">${k.status}</span></td>
          <td class="muted">${ago(k.created_at)}</td><td class="muted">${k.last_used_at ? ago(k.last_used_at) : 'never'}</td>
          <td class="num" style="font-size:12px">${k.usage.tokens} tok · ${fmtCost(k.usage.cost_usd)}${k.usage.loops ? ` · ${k.usage.loops}⟳` : ''}</td>
          <td><div class="row">
            <button class="btn ghost sm" data-copy="${cached ? esc(S.keyCache[k.mission.id]) : esc(k.key_prefix)}" title="${cached ? 'Copy full key' : 'Copy prefix'}">${icon('copy')}</button>
            <button class="btn ghost sm" data-label="${k.id}" data-cur="${esc(k.label || '')}">Label</button>
            ${k.status === 'active' ? `<button class="btn ghost sm" data-rotate="${k.mission?.id}">Rotate</button><button class="btn danger sm" data-revoke="${k.mission?.id}" data-kid="${k.id}">Revoke</button>` : ''}
          </div></td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No keys match.</td></tr>'}
    </tbody></table></div>`;
    body.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
    body.querySelectorAll('[data-label]').forEach((b) => (b.onclick = () => {
      const mo = modal(`<h2>Label this key</h2><label>Label</label><input id="lk" value="${esc(b.dataset.cur)}" placeholder="e.g. Todo app build"/><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" id="lx">Cancel</button><button class="btn" id="ly">Save</button></div>`);
      mo.querySelector('#lk').focus();
      mo.querySelector('#lx').onclick = () => mo.remove();
      mo.querySelector('#ly').onclick = async () => { await api.labelKey(b.dataset.label, mo.querySelector('#lk').value.trim()); mo.remove(); toast('Labeled'); pageKeys(c); };
    }));
    body.querySelectorAll('[data-rotate]').forEach((b) => (b.onclick = async () => { const r = await api.createKey(b.dataset.rotate, 'rotated'); if (r.api_key) { S.keyCache[b.dataset.rotate] = r.api_key; save(); revealKeyModal(r.api_key, b.dataset.rotate, false); pageKeys(c); } }));
    body.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = () => {
      const mo = modal(`<h2>Revoke key?</h2><p class="muted">This immediately blocks all calls using this key.</p><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="rx">Cancel</button><button class="btn danger" id="ry">Revoke</button></div>`);
      mo.querySelector('#rx').onclick = () => mo.remove();
      mo.querySelector('#ry').onclick = async () => { await api.revokeKey(b.dataset.revoke, b.dataset.kid); mo.remove(); toast('Revoked'); pageKeys(c); };
    }));
  };
  try { const j = await api.listKeys(); allKeys = j.keys || []; } catch { allKeys = []; }
  renderKeyTable();
}
async function generateKeyFlow(after) {
  await loadMissions();
  if (!MISSIONS.length) { location.hash = '#/missions/new'; return; }
  const opts = MISSIONS.map((m) => `<option value="${m.id}">${esc(trunc(m.name || m.goal, 40))}</option>`).join('');
  const mo = modal(`<h2>Generate a key</h2><label>For which mission?</label><select id="gkM">${opts}</select><label>Label (optional)</label><input id="gkL" placeholder="e.g. Cursor on laptop"/><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" id="gkx">Cancel</button><button class="btn" id="gky">Generate</button></div>`);
  mo.querySelector('#gkx').onclick = () => mo.remove();
  mo.querySelector('#gky').onclick = async () => { const mid = mo.querySelector('#gkM').value; const label = mo.querySelector('#gkL').value.trim() || 'manual'; const r = await api.createKey(mid, label); mo.remove(); if (r.api_key) { S.keyCache[mid] = r.api_key; save(); revealKeyModal(r.api_key, mid, false); after?.(); } else toast('Failed'); };
}

// ---------- Integration ----------
function pageIntegration(c) {
  const m = selRef();
  c.innerHTML = `<div class="page-head"><div><h1>Integration</h1><div class="sub">Point any agent at Anchor — proxy, direct REST, or MCP</div></div></div><div id="ibody"></div>`;
  if (!m) return needMission(document.getElementById('ibody'));
  const k = S.keyCache[m.id];
  if (!k) { document.getElementById('ibody').innerHTML = emptyState('key', 'No local key for this mission', 'Generate a key for this mission to get copy-paste setup with your secret filled in.', 'Generate a key', '#/keys'); return; }
  const ob = openaiBase(), ab = apiBase();
  const snippets = {
    openai: { note: 'Proxy path: set these env vars (or SDK baseURL/apiKey). Works with the OpenAI SDK, Cursor, and most OpenAI-compatible tools — every call is auto-anchored.', code: `export OPENAI_BASE_URL="${ob}"\nexport OPENAI_API_KEY="${k}"\n\n// or in code:\nimport OpenAI from 'openai';\nconst client = new OpenAI({ baseURL: "${ob}", apiKey: "${k}" });` },
    anthropic: { note: 'Proxy path for Claude Code or the Anthropic SDK.', code: `export ANTHROPIC_BASE_URL="${ab}"\nexport ANTHROPIC_AUTH_TOKEN="${k}"` },
    direct: { note: 'Direct retrieval: any agent reads the mission behind the key and reports progress — no base-URL swap.', code: `# Pull mission context\ncurl ${ab}/v1/context -H "authorization: Bearer ${k}"\n\n# Report a step → refreshed context + warnings\ncurl -X POST ${ab}/v1/report -H "authorization: Bearer ${k}" -H "content-type: application/json" \\\n  -d '{"action":"what I did","result":"what happened","outcome":"done"}'` },
    mcp: { note: 'MCP (recommended for Claude Code): native tools anchor_get_context / anchor_report_step / anchor_check.', code: `{\n  "mcpServers": {\n    "anchor": {\n      "command": "node",\n      "args": ["/abs/path/to/Anchor/mcp/anchor-mcp.mjs"],\n      "env": { "ANCHOR_KEY": "${k}", "ANCHOR_API_BASE": "${ab}" }\n    }\n  }\n}` },
    curl: { note: 'Quick proxy test from the terminal.', code: `curl ${ob}/chat/completions -H "authorization: Bearer ${k}" -H "content-type: application/json" \\\n  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'` },
  };
  document.getElementById('ibody').innerHTML = `<div class="card">
    <div class="tabs"><div class="tab active" data-t="openai">OpenAI</div><div class="tab" data-t="anthropic">Claude Code</div><div class="tab" data-t="direct">Direct (REST)</div><div class="tab" data-t="mcp">MCP</div><div class="tab" data-t="curl">cURL</div></div>
    <div class="muted" id="iNote" style="margin-bottom:10px"></div><pre class="code" id="iCode"></pre>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="iCopy">Copy snippet</button></div></div>`;
  const setTab = (t) => { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.t === t)); document.getElementById('iNote').textContent = snippets[t].note; document.getElementById('iCode').textContent = snippets[t].code; document.getElementById('iCopy').onclick = () => copy(snippets[t].code); };
  document.querySelectorAll('.tab').forEach((x) => (x.onclick = () => setTab(x.dataset.t)));
  setTab('openai');
}

// ---------- Settings ----------
async function pageSettings(c) {
  const m = selRef();
  c.innerHTML = `<div class="page-head"><div><h1>Settings</h1><div class="sub">Per-mission anchoring config + account</div></div></div><div id="sbody"></div>`;
  const body = document.getElementById('sbody');
  const acct = `<div class="card"><h3 class="sec">Account</h3><div class="row" style="justify-content:space-between"><div><div>${esc(S.auth?.user?.email || '')}</div><div class="muted" style="font-size:12px">Signed in</div></div><button class="btn ghost" id="sLogout">${icon('logout')} Log out</button></div></div>`;
  if (!m) { body.innerHTML = acct + emptyState('anchor', 'No mission selected', 'Select or create a mission to edit its anchoring settings.', 'New mission', '#/missions/new'); document.getElementById('sLogout').onclick = async () => { await auth.signOut(); location.hash = '#/'; }; return; }
  body.innerHTML = `<div class="card muted">Loading… <span class="spin"></span></div>`;
  const s = await api.getMission(m.id).catch(() => null);
  const o = s?.mission?.options || {};
  body.innerHTML = acct + `<div class="card" style="margin-top:16px">
    <h3 class="sec">Mission: ${esc(trunc(s?.mission?.name || s?.mission?.goal || '', 60))}</h3>
    <div class="grid2">
      <div><label>Model</label><select id="oModel">${MODELS.map((x) => `<option ${x === o.model ? 'selected' : ''}>${x}</option>`).join('')}${o.model && !MODELS.includes(o.model) ? `<option selected>${esc(o.model)}</option>` : ''}</select></div>
      <div><label>Auto-correct on loop/drift</label><label class="toggle" style="margin-top:6px"><input type="checkbox" id="oAuto" ${o.autoCorrect !== false ? 'checked' : ''}><span class="tr"></span><span class="muted">inject correctives</span></label></div>
      <div><label>Loop threshold</label><input id="oLoop" type="number" step="0.01" min="0" max="1" value="${o.loopThreshold ?? 0.85}"/></div>
      <div><label>Drift threshold</label><input id="oDrift" type="number" step="0.01" min="0" max="1" value="${o.driftThreshold ?? 0.15}"/></div>
      <div><label>Similarity window N</label><input id="oWin" type="number" step="1" min="1" max="32" value="${o.window ?? 8}"/></div>
      <div><label>Sequencing</label><label class="toggle" style="margin-top:6px"><input type="checkbox" id="oSeq" ${o.sequencing ? 'checked' : ''}><span class="tr"></span><span class="muted">feed plan steps one at a time</span></label></div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn" id="oSave">Save mission settings</button><span class="muted" id="oMsg"></span></div>
  </div>`;
  document.getElementById('sLogout').onclick = async () => { await auth.signOut(); location.hash = '#/'; };
  document.getElementById('oSave').onclick = async () => {
    const options = { model: document.getElementById('oModel').value, autoCorrect: document.getElementById('oAuto').checked, loopThreshold: +document.getElementById('oLoop').value, driftThreshold: +document.getElementById('oDrift').value, window: +document.getElementById('oWin').value, sequencing: document.getElementById('oSeq').checked };
    await api.patch(m.id, { options }); document.getElementById('oMsg').textContent = 'Saved ✓'; toast('Settings saved');
  };
}

// ---------- boot ----------
async function boot() {
  document.getElementById('app').className = '';
  if (!location.hash) location.hash = S.auth ? '#/dashboard' : '#/';
  if (S.auth?.accessToken) { try { await loadMissions(); } catch { /* token may be stale; route handles 401 */ } }
  route();
}
boot();
