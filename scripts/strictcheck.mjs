// Reproduce the real-browser (ES module = strict mode) behavior: run app.js with
// "use strict" and surface any uncaught error that would blank the page content.
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';

const appjs = '"use strict";\n' + fs.readFileSync('web/app.js', 'utf8');
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push('jsdomError: ' + (e?.detail?.stack || e?.stack || e?.message || String(e))));

const dom = new JSDOM('<!doctype html><body><div id="app"></div><div id="toast"></div></body>', {
  url: 'http://localhost:8123/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
});
const { window } = dom; const d = window.document;
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', headers: new Map() });
window.navigator.clipboard = { writeText: async () => {} };
window.addEventListener('error', (e) => errs.push('window.error: ' + (e.error?.stack || e.message)));

const s = d.createElement('script'); s.textContent = appjs; d.body.appendChild(s);
console.log('sidebar rendered:', !!d.querySelector('.sidebar'));
console.log('boot content length:', d.getElementById('content')?.innerHTML.length || 0);
for (const r of ['#/', '#/missions', '#/missions/new', '#/keys', '#/integration', '#/settings']) {
  window.location.hash = r; window.dispatchEvent(new window.Event('hashchange'));
  console.log(r.padEnd(16), '→ content length', d.getElementById('content')?.innerHTML.length || 0);
}
setTimeout(() => console.log('\nERRORS:', errs.length ? '\n' + errs.join('\n') : 'none'), 200);
