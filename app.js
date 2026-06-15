/* =========================================================================
   Anchor — shared interactions (multi-page, vanilla, no deps).
   ========================================================================= */
(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const raf = (fn) => requestAnimationFrame(fn);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- CTA links → console ---- */
  const CONSOLE_URL = 'http://localhost:8123'; // ← change to your deployed console
  const CTA = { signup: CONSOLE_URL + '/#/signup', login: CONSOLE_URL + '/#/login' };
  document.querySelectorAll('[data-cta]').forEach((a) => { const d = CTA[a.getAttribute('data-cta')]; if (d) a.href = d; });

  const y = document.getElementById('year'); if (y) y.textContent = String(new Date().getFullYear());

  /* ---- nav ---- */
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8); onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    const toggle = document.getElementById('navToggle'), mobile = document.getElementById('navMobile');
    if (toggle && mobile) {
      const setOpen = (o) => { nav.classList.toggle('open', o); toggle.setAttribute('aria-expanded', String(o)); mobile.hidden = !o; };
      toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
      mobile.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    }
  }

  /* ---- reveals ---- */
  const revealEls = [...document.querySelectorAll('.reveal')];
  if (reduce || !('IntersectionObserver' in window)) { revealEls.forEach((el) => el.classList.add('in')); }
  else {
    const io = new IntersectionObserver((es, obs) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      const d = parseInt(e.target.getAttribute('data-reveal-delay') || '0', 10);
      setTimeout(() => e.target.classList.add('in'), d); obs.unobserve(e.target);
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    revealEls.forEach((el) => io.observe(el));
  }

  const whenVisible = (el, cb, th = 0.35) => {
    if (!el) return;
    if (reduce || !('IntersectionObserver' in window)) { cb(); return; }
    const io = new IntersectionObserver((es, obs) => es.forEach((e) => { if (e.isIntersecting) { cb(); obs.disconnect(); } }), { threshold: th });
    io.observe(el);
  };

  /* ---- count-up (any [data-count]) ---- */
  const animateCount = (el) => {
    const raw = el.getAttribute('data-count');
    const t = parseFloat(raw);
    if (reduce || isNaN(t)) { el.textContent = raw; return; }
    const decimals = (raw.split('.')[1] || '').length;
    const dur = 1200, t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const v = t * e;
      el.textContent = (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString());
      if (p < 1) raf(tick);
    };
    raf(tick);
  };
  document.querySelectorAll('[data-count]').forEach((el) => whenVisible(el, () => animateCount(el), 0.6));

  /* ---- fcard cursor glow ---- */
  if (!reduce) document.querySelectorAll('.fcard,.icard').forEach((card) => card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }));

  /* ---- demo cursor: move → click → onHit, loop ---- */
  const demoCursor = (card, targetSel, opts = {}) => {
    if (!card) return;
    const cur = card.querySelector('.dcursor');
    const target = card.querySelector(targetSel);
    if (!cur || !target) return;
    if (reduce) { cur.style.display = 'none'; if (opts.onHit) opts.onHit(); return; }
    const base = () => (cur.offsetParent || card).getBoundingClientRect();
    const rel = (el) => { const c = base(), r = el.getBoundingClientRect(); return { x: r.left - c.left + r.width / 2 - 4, y: r.top - c.top + r.height / 2 - 2 }; };
    const home = () => { const c = base(); return { x: c.width - 46, y: c.height - 40 }; };
    const place = (p, anim) => { cur.style.transition = anim ? 'transform 1s cubic-bezier(.5,0,.2,1),opacity .4s' : 'none'; cur.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)'; };
    let alive = true;
    (async function loop() {
      while (alive) {
        if (opts.onReset) opts.onReset();
        place(home(), false); cur.style.opacity = '0';
        await wait(500); cur.style.opacity = '1';
        place(rel(target), true);
        await wait(1100);
        cur.classList.add('click'); target.classList.add('press');
        await wait(260); cur.classList.remove('click'); target.classList.remove('press');
        if (opts.onHit) opts.onHit();
        await wait(opts.hold || 3200);
      }
    })();
  };

  /* key graphic */
  whenVisible(document.getElementById('keygraphic'), () => {
    const out = document.getElementById('kgOut');
    demoCursor(document.getElementById('keygraphic'), '#kgGen', {
      onHit: () => out && out.classList.add('show'),
      onReset: () => out && out.classList.remove('show'),
      hold: 3600,
    });
  });

  /* monitor */
  whenVisible(document.getElementById('monitor'), () => {
    if (!reduce) [...document.querySelectorAll('#timeline .mrow')].forEach((s, i) => {
      s.style.opacity = '0'; s.style.transform = 'translateY(8px)'; s.style.transition = 'opacity .5s var(--e-out),transform .5s var(--e-out)';
      setTimeout(() => { s.style.opacity = ''; s.style.transform = ''; }, 300 + i * 180);
    });
    const row = document.querySelector('#monitor .focusrow');
    demoCursor(document.getElementById('monitor'), '.focusrow', {
      onHit: () => row && row.classList.add('hl'),
      onReset: () => row && row.classList.remove('hl'),
    });
  });

  /* work */
  whenVisible(document.getElementById('work'), () => { demoCursor(document.getElementById('work'), '.witem .ic.run', {}); });

  /* analytics */
  whenVisible(document.getElementById('analytics'), () => {
    const tip = document.querySelector('#analytics .an-tip');
    demoCursor(document.getElementById('analytics'), '.an-point', {
      onHit: () => tip && tip.classList.add('show'),
      onReset: () => tip && tip.classList.remove('show'),
      hold: 3600,
    });
  });

  /* ---- animated hero demo: generate key → terminal → live monitor (loops) ---- */
  (function heroDemo(){
    const root = document.getElementById('heroDemo');
    if (!root) return;
    const stage = root.querySelector('.demo-stage');
    const scenes = [...root.querySelectorAll('.scene')];
    const title = document.getElementById('dTitle');
    const live = document.getElementById('dLive');
    const dots = [...root.querySelectorAll('.dsteps .ds')];
    const gen = document.getElementById('dGen'), key = document.getElementById('dKey');
    const keyText = document.getElementById('dKeyText'), copy = document.getElementById('dCopy');
    const copyLbl = document.getElementById('dCopyLbl'), cur = document.getElementById('dCursor');
    const tl = [1, 2, 3, 4].map((i) => document.getElementById('tl' + i));
    const stats = [...root.querySelectorAll('.hstats [data-c]')];
    const rows = [...root.querySelectorAll('.s3tl .mrow')];
    const KEY = 'anc_live_a3f0b9…c21d';
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    const setScene = (n) => { scenes.forEach((s) => s.classList.toggle('s-on', s.dataset.scene === String(n))); dots.forEach((d, i) => d.classList.toggle('on', i === n - 1)); };

    // Hero demo always plays (owner choice); CSS restores its transitions under reduced-motion.
    const baseRect = () => (cur.offsetParent || stage).getBoundingClientRect();
    const rel = (el) => { const c = baseRect(), r = el.getBoundingClientRect(); return { x: r.left - c.left + r.width / 2 - 4, y: r.top - c.top + r.height / 2 - 2 }; };
    const home = () => { const c = baseRect(); return { x: c.width - 46, y: c.height - 40 }; };
    const move = (p, anim) => { cur.style.transition = anim ? 'transform .85s cubic-bezier(.5,0,.2,1),opacity .4s' : 'none'; cur.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px)'; };
    const type = async (el, text, sp) => { el.textContent = ''; for (let i = 0; i < text.length; i++) { el.textContent += text[i]; await w(sp); } };
    const countUp = (el) => { const t = parseInt(el.dataset.c, 10), t0 = performance.now(), d = 1100; const tick = (n) => { const p = Math.min(1, (n - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(t * e).toLocaleString(); if (p < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); };

    let alive = true;
    const run = async () => {
      while (alive) {
        // SCENE 1 — generate key
        title.textContent = 'New mission'; live.hidden = true; setScene(1);
        key.classList.remove('show'); keyText.textContent = ''; copy.classList.remove('done'); copyLbl.textContent = 'copy';
        move(home(), false); cur.style.opacity = '0';
        await w(550); cur.style.opacity = '1';
        move(rel(gen), true); await w(900);
        gen.classList.add('press'); cur.classList.add('click'); await w(230); gen.classList.remove('press'); cur.classList.remove('click');
        key.classList.add('show'); await w(220);
        await type(keyText, KEY, 30);
        await w(320);
        move(rel(copy), true); await w(700);
        cur.classList.add('click'); await w(220); cur.classList.remove('click');
        copy.classList.add('done'); copyLbl.textContent = 'copied';
        await w(950);
        // SCENE 2 — terminal
        title.textContent = 'Terminal'; setScene(2); cur.style.opacity = '0';
        tl.forEach((e) => { e.textContent = ''; e.classList.remove('caret'); e.style.opacity = ''; });
        await w(320);
        await type(tl[0], '$ export ANTHROPIC_BASE_URL="…insforge.app/anchor"', 14);
        await type(tl[1], '$ export ANTHROPIC_AUTH_TOKEN="' + KEY + '"', 14);
        await type(tl[2], '$ claude', 42); tl[2].classList.add('caret');
        await w(800);
        tl[2].classList.remove('caret'); tl[3].style.opacity = '1'; tl[3].textContent = '✓ mission injected — re-anchored on every call';
        await w(1600);
        // SCENE 3 — live monitor
        title.textContent = 'Mission · CLI Todo App'; live.hidden = false; setScene(3);
        stats.forEach((e) => e.textContent = '0');
        rows.forEach((r) => { r.style.opacity = '0'; r.style.transform = 'translateY(8px)'; r.style.transition = 'opacity .4s var(--e-out),transform .4s var(--e-out)'; });
        stats.forEach(countUp);
        rows.forEach((r, i) => setTimeout(() => { r.style.opacity = ''; r.style.transform = ''; }, 250 + i * 240));
        await w(3400);
      }
    };
    setTimeout(run, 350);
  })();

  /* ---- hero integrations field: center card cycles through what Anchor drops into ---- */
  (function integrationsField(){
    const focus = document.getElementById('ifFocus');
    if (!focus) return;
    const logo = document.getElementById('ifLogo'), name = document.getElementById('ifName');
    const items = [
      { n: 'Claude Code',     i: 'i-burst',  c: '#5e6ad2' },
      { n: 'Cursor',          i: 'i-cursor', c: '#2f3850' },
      { n: 'OpenAI SDK',      i: 'i-knot',   c: '#0d9488' },
      { n: 'Anthropic SDK',   i: 'i-burst',  c: '#c2680a' },
      { n: 'MCP',             i: 'i-plug',   c: '#5e6ad2' },
      { n: 'any REST client', i: 'i-term',   c: '#2f3850' },
    ];
    let k = 0;
    const show = (idx) => {
      const it = items[idx];
      focus.style.setProperty('--fc', it.c);
      logo.innerHTML = '<svg aria-hidden="true"><use href="#' + it.i + '"/></svg>';
      name.textContent = it.n;
    };
    show(0);
    setInterval(() => {
      k = (k + 1) % items.length;
      focus.classList.remove('swap'); void focus.offsetWidth; focus.classList.add('swap');
      show(k);
    }, 2600);
  })();

  /* ---- tabs ---- */
  const tabs = [...document.querySelectorAll('.tab')], panes = [...document.querySelectorAll('.code-pane')];
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    const id = tab.getAttribute('data-tab');
    tabs.forEach((t) => { const on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
    panes.forEach((p) => { const on = p.getAttribute('data-pane') === id; p.hidden = !on; p.classList.toggle('on', on); });
  }));

  /* ---- cursor follower ---- */
  if (fine && !reduce) {
    const dot = document.createElement('div'); dot.className = 'cursor-dot'; document.body.appendChild(dot);
    let mx = innerWidth / 2, my = innerHeight / 2, dx = mx, dy = my;
    addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; dot.classList.add('on'); }, { passive: true });
    addEventListener('pointerdown', () => dot.classList.add('tap'));
    addEventListener('pointerup', () => dot.classList.remove('tap'));
    document.addEventListener('pointerover', (e) => { if (e.target.closest && e.target.closest('a,button,.btn,.tab,.fcard,.ncard,.icard,.flow .step,.ccol')) dot.classList.add('tap'); });
    document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('a,button,.btn,.tab,.fcard,.ncard,.icard,.flow .step,.ccol')) dot.classList.remove('tap'); });
    (function tick() { dx += (mx - dx) * 0.18; dy += (my - dy) * 0.18; dot.style.transform = 'translate(' + dx + 'px,' + dy + 'px) translate(-50%,-50%)'; raf(tick); })();
  }

  /* ---- smooth (lerp) wheel scrolling ---- */
  if (fine && !reduce) {
    let target = window.scrollY, cur = window.scrollY, running = false;
    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;
    const clamp = (v) => Math.max(0, Math.min(v, maxScroll()));
    const step = () => {
      cur += (target - cur) * 0.12;
      if (Math.abs(target - cur) < 0.4) { cur = target; window.scrollTo(0, cur); running = false; return; }
      window.scrollTo(0, cur); raf(step);
    };
    addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 32 : (e.deltaMode === 2 ? window.innerHeight : 1);
      target = clamp(target + e.deltaY * unit);
      if (!running) { running = true; raf(step); }
    }, { passive: false });
    // keep in sync when scrolled by other means (keyboard, scrollbar, anchor)
    addEventListener('scroll', () => { if (!running) { target = cur = window.scrollY; } }, { passive: true });
    addEventListener('resize', () => { target = clamp(target); }, { passive: true });
  }
})();
