// Headless render smoke test for the Anchor web app. Runs app.js as a real script
// inside jsdom (proper window globals) and exercises each route, asserting it
// renders without throwing. Run: node scripts/uitest.mjs
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const appjs = fs.readFileSync('web/app.js', 'utf8');

const dom = new JSDOM(
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><div id="toast" class="toast hide"></div></body></html>',
  { url: 'http://localhost:8123/', runScripts: 'dangerously', pretendToBeVisual: true },
);
const { window } = dom;
const d = window.document;

// minimal stubs (set before the app boots)
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', headers: new Map() });
window.navigator.clipboard = { writeText: async () => {} };
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));

// run app.js in the window's global scope
const script = d.createElement('script');
script.textContent = appjs;
d.body.appendChild(script);

const must = (cond, msg) => { console.log((cond ? '✓' : '✗') + ' ' + msg); if (!cond) process.exitCode = 1; };

must(d.querySelector('.sidebar'), 'sidebar rendered');
must(d.querySelectorAll('.navitem').length === 7, 'seven nav items (' + d.querySelectorAll('.navitem').length + ')');
must(d.querySelector('.brand'), 'brand rendered');
must((d.getElementById('content')?.innerHTML.length || 0) > 50, 'dashboard content rendered');

const routes = ['#/', '#/missions', '#/missions/new', '#/keys', '#/integration', '#/settings'];
for (const r of routes) {
  try {
    window.location.hash = r;
    window.dispatchEvent(new window.Event('hashchange'));
    must((d.getElementById('content')?.innerHTML.length || 0) > 20, `route ${r} renders`);
  } catch (e) { console.log('✗ route ' + r + ' threw: ' + e.message); process.exitCode = 1; }
}

window.location.hash = '#/missions/new';
window.dispatchEvent(new window.Event('hashchange'));
must(d.getElementById('pCreate'), 'prompt builder has Create button');
must(d.getElementById('pChips')?.querySelectorAll('.chip').length === 2, 'default constraints render as 2 chips');

// open load-existing modal (exercises the modal path)
try { window.location.hash = '#/'; window.dispatchEvent(new window.Event('hashchange')); d.getElementById('loadExisting')?.click(); must(d.querySelector('.modal'), 'load-existing modal opens'); } catch (e) { must(false, 'load modal threw: ' + e.message); }

setTimeout(() => {
  must(errors.length === 0, 'no window errors (' + errors.join(' | ') + ')');
  console.log(process.exitCode ? '\nFAIL' : '\nALL PASS');
}, 150);
