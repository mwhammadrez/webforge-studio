/* Universal page editor runtime.
   - reads /content.json (overrides saved by admin.html)
   - reads /panel-config.json (optional: hero image match + extra toggles)
   - ?edit=1 enables click-to-pick and sends an inventory to the admin panel
   Injected into every page by init_panel.py */
(() => {
  window.__gfEditor = 'v2';
  const API = '/api/content';
  const EDIT = new URLSearchParams(location.search).has('edit');
  const pageKey = (location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/') || '/';
  let data = { version: 1, pages: {} };
  let cfg = {};
  let overrides = {};

  const cssPath = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 16) {
      if (n.id) { parts.unshift('#' + n.id); break; }
      let sel = n.tagName.toLowerCase();
      if (n.parentElement) {
        const same = [...n.parentElement.children].filter(c => c.tagName === n.tagName);
        sel += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(sel);
      n = n.parentElement;
    }
    return parts.join(' > ');
  };
  const q = (path) => { try { return document.querySelector(path); } catch (e) { return null; } };

  // saved paths can drift when a framework re-creates wrapper nodes
  const variants = (path) => {
    const parts = path.split(' > ');
    const out = [path];
    for (let i = parts.length - 1; i > 0 && out.length < 9; i--) out.push([...parts.slice(0, i), ...parts.slice(i + 1)].join(' > '));
    return out;
  };
  const resolve = (path, ov) => {
    for (const v of variants(path)) { const el = q(v); if (el) return el; }
    const a = ov && ov.anchor;
    if (!a || !a.label) return null;
    const cands = [...document.querySelectorAll(a.tag && a.tag !== 'any' && a.tag !== 'video' ? a.tag : '*')];
    return cands.find(e => e.children.length === 0 && e.textContent.trim() === a.label)
        || cands.find(e => ((e.currentSrc || e.src || '').split('/').pop() === a.label))
        || null;
  };

  const bySrc = (hash) => [...document.images].find(i => (i.currentSrc || i.src).includes(hash));
  const clearSrcset = (img) => { img.removeAttribute('srcset'); img.removeAttribute('sizes'); };

  function applyProps(el, p) {
    if (!el || !p) return;
    if (p.src) { el.src = p.src; clearSrcset(el); }
    if (p.href) el.setAttribute('href', p.href);
    if (p.text !== undefined && p.text !== null) el.textContent = p.text;
    if (p.hidden === true) { el.dataset.gfHide = '1'; el.style.display = 'none'; }
    else if (p.hidden === false && el.dataset.gfHide) { delete el.dataset.gfHide; el.style.display = ''; }
    if (p.video) { el.src = p.video; if (el.tagName === 'VIDEO') { el.load(); el.play().catch(() => {}); } }
    const s = p.style || {};
    for (const k of Object.keys(s)) if (s[k]) el.style[k] = s[k];
  }

  function findHero() {
    const marked = document.querySelector('[data-gf="hero-img"]');
    if (marked) return marked;
    if (cfg.hero && cfg.hero.match) { const el = bySrc(cfg.hero.match); if (el) return el; }
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const cands = [...document.images].filter(i => {
      const r = i.getBoundingClientRect();
      return r.width > 300 && r.height > 120 && (r.top + window.scrollY) < 1600;
    });
    return cands.sort((a, b) => area(b) - area(a))[0] || null;
  }

  function applyHero(hero) {
    if (!hero) return;
    const img = findHero();
    if (img) {
      img.setAttribute('data-gf', 'hero-img');
      if (hero.image) { img.src = hero.image; clearSrcset(img); }
      if (hero.ratio) {
        img.style.aspectRatio = String(hero.ratio);
        img.style.height = 'auto';
        img.style.width = '100%';
        img.style.objectFit = 'cover';
      }
    }
    for (const ex of (cfg.extras || [])) {
      const hide = hero.extras && hero.extras[ex.name] === false;
      const needles = Array.isArray(ex.match) ? ex.match : [ex.match];
      [...document.images].filter(i => needles.some(n => n && (i.currentSrc || i.src).includes(n)))
        .forEach(i => { i.style.display = hide ? 'none' : ''; });
    }
  }

  function applyAll() {
    const page = (data.pages || {})[pageKey] || {};
    overrides = page.overrides || {};
    applyHero(page.hero);
    for (const path of Object.keys(overrides)) applyProps(resolve(path, overrides[path]), overrides[path]);
  }

  function load() {
    Promise.all([
      fetch(API + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/panel-config.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([c, g]) => {
      if (c && c.pages) data = c;
      if (g) cfg = g;
      applyAll();
    });
  }

  [0, 400, 1200, 2500, 4500].forEach(t => setTimeout(applyAll, t));
  if (document.readyState !== 'loading') load(); else document.addEventListener('DOMContentLoaded', load);
  window.addEventListener('load', () => setTimeout(applyAll, 300));

  /* ---------- inventory for the "all content" tab ---------- */
  function inventory() {
    const seen = new Set();
    const images = [];
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const p = cssPath(img);
      if (seen.has(p)) continue;
      seen.add(p);
      images.push({ path: p, src: img.currentSrc || img.src, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY) });
    }
    const texts = [];
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,li,div,button,strong,em,label,blockquote,td,th')) {
      if (el.children.length) continue;
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t.length < 2) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const p = cssPath(el);
      if (seen.has(p)) continue;
      seen.add(p);
      const cs = getComputedStyle(el);
      texts.push({ path: p, text: t, tag: el.tagName.toLowerCase(), size: cs.fontSize, color: cs.color, top: Math.round(r.top + scrollY) });
    }
    const videos = [];
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      videos.push({ path: cssPath(v), src: v.currentSrc || v.src, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY) });
    }
    images.sort((a, b) => a.top - b.top);
    texts.sort((a, b) => a.top - b.top);
    videos.sort((a, b) => a.top - b.top);
    parent.postMessage({ source: 'goldify-page', type: 'inventory', page: pageKey, images, texts, videos, config: cfg }, '*');
  }

  if (!EDIT) return;

  const style = document.createElement('style');
  style.textContent = `
    .gf-hover { outline: 2px dashed #f5be09 !important; outline-offset: 2px; cursor: crosshair !important; }
    .gf-picked { outline: 2px solid #22c55e !important; outline-offset: 2px; }
    #gf-bar { position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; font: 12px/1.6 system-ui;
      background: #111; color: #f5be09; border: 1px solid #f5be09; border-radius: 8px; padding: 6px 10px; }
  `;
  document.documentElement.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'gf-bar';
  bar.textContent = 'Edit mode: click any element';
  document.documentElement.appendChild(bar);

  let hovered = null;
  let picked = null;
  const textLeaf = (el) => {
    let n = el;
    while (n.children.length === 1 && n.firstElementChild.textContent.trim() === n.textContent.trim()) n = n.firstElementChild;
    return n;
  };

  document.addEventListener('mouseover', (e) => {
    if (hovered) hovered.classList.remove('gf-hover');
    hovered = e.target;
    if (hovered && hovered !== document.body) hovered.classList.add('gf-hover');
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (hovered === e.target) { hovered.classList.remove('gf-hover'); hovered = null; }
  }, true);

  document.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.target || e.target === document.body) return;
    if (picked) picked.classList.remove('gf-picked');
    picked = e.target;
    picked.classList.add('gf-picked');
    const leaf = textLeaf(picked);
    const isImg = picked.tagName === 'IMG';
    const cs = getComputedStyle(picked);
    parent.postMessage({
      source: 'goldify-page',
      type: 'selected',
      path: cssPath(picked),
      tag: picked.tagName.toLowerCase(),
      text: picked.children.length === 0 ? picked.textContent : (leaf.children.length === 0 ? leaf.textContent : ''),
      textEditable: picked.children.length === 0 || leaf.children.length === 0,
      textPath: picked.children.length === 0 ? cssPath(picked) : cssPath(leaf),
      src: isImg ? (picked.currentSrc || picked.src) : '',
      href: picked.getAttribute('href') || '',
      style: { fontSize: cs.fontSize, color: cs.color, background: cs.backgroundColor, borderRadius: cs.borderRadius },
      hidden: picked.style.display === 'none',
    }, '*');
  }, true);

  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (m.source !== 'goldify-admin') return;
    if (m.type === 'set') {
      const el = q(m.path) || resolve(m.path, { anchor: m.anchor });
      if (el) applyProps(el, m.props);
      const page = (data.pages[pageKey] = data.pages[pageKey] || {});
      page.overrides = page.overrides || {};
      page.overrides[m.path] = { ...(page.overrides[m.path] || {}), ...m.props };
    }
    if (m.type === 'hero') {
      const page = (data.pages[pageKey] = data.pages[pageKey] || {});
      page.hero = { ...(page.hero || {}), ...m.hero };
      applyHero(page.hero);
    }
    if (m.type === 'scan') inventory();
    if (m.type === 'reload') location.reload();
    if (m.type === 'highlight') {
      const el = q(m.path);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('gf-picked'); setTimeout(() => el.classList.remove('gf-picked'), 1600); }
    }
  });

  parent.postMessage({ source: 'goldify-page', type: 'ready', page: pageKey }, '*');
  setTimeout(inventory, 1200);
})();
