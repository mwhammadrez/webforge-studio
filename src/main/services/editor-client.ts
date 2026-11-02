export const EDITOR_SCRIPT = String.raw`
(() => {
  if (window.__webforgeEditorLoaded) return;
  window.__webforgeEditorLoaded = true;
  var enabled = false;
  var selected = null;
  var overlay = null;
  var badge = null;

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) {
      var byId = '#' + CSS.escape(el.id);
      try { if (document.querySelectorAll(byId).length === 1) return byId; } catch (e) {}
    }
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') break;
      var parent = node.parentElement;
      if (!parent) break;
      var index = 1;
      var sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      node = parent;
    }
    return 'body' + (parts.length ? ' > ' + parts.join(' > ') : '');
  }

  function pagePath() {
    var p = decodeURIComponent(location.pathname);
    if (p.endsWith('/')) p += 'index.html';
    return p.replace(/^\/+/, '');
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-webforge-ui', 'overlay');
    overlay.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #38bdf8;background:rgba(56,189,248,.08);border-radius:4px;display:none;transition:all .08s ease;';
    badge = document.createElement('div');
    badge.setAttribute('data-webforge-ui', 'badge');
    badge.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#0ea5e9;color:#fff;font:11px/1.6 system-ui,sans-serif;padding:0 6px;border-radius:4px;display:none;direction:ltr;';
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(badge);
  }

  function place(el) {
    ensureOverlay();
    if (!el || !enabled) {
      if (overlay) overlay.style.display = 'none';
      if (badge) badge.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = Math.max(0, r.width) + 'px';
    overlay.style.height = Math.max(0, r.height) + 'px';
    badge.style.display = 'block';
    badge.textContent = el.tagName.toLowerCase();
    badge.style.left = Math.max(4, r.left) + 'px';
    badge.style.top = Math.max(4, r.top - 20) + 'px';
  }

  function describe(el) {
    var style = getComputedStyle(el);
    var text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i += 1) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-webforge') === 0) continue;
      attrs[a.name] = a.value.slice(0, 2000);
    }
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: text,
      html: el.innerHTML.slice(0, 4000),
      attrs: attrs,
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        borderRadius: style.borderRadius,
        display: style.display,
        textAlign: style.textAlign
      },
      imageSrc: el.currentSrc || el.src || null,
      label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (text ? ' — ' + text.slice(0, 60) : '')
    };
  }

  function send(target) {
    window.parent.postMessage({ type: 'webforge:select', pagePath: pagePath(), target: target }, '*');
  }

  document.addEventListener('mousemove', function (event) {
    if (!enabled) return;
    var el = event.target;
    if (!el || (el.closest && el.closest('[data-webforge-ui]'))) return;
    place(el);
  }, true);

  document.addEventListener('click', function (event) {
    if (!enabled) return;
    var el = event.target;
    if (!el || (el.closest && el.closest('[data-webforge-ui]'))) return;
    event.preventDefault();
    event.stopPropagation();
    selected = el;
    place(el);
    send(describe(el));
  }, true);

  document.addEventListener('submit', function (event) {
    if (enabled) event.preventDefault();
  }, true);

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'webforge:mode') {
      enabled = Boolean(data.enabled);
      if (!enabled) place(null);
      document.documentElement.style.cursor = enabled ? 'crosshair' : '';
    }
    if (data.type === 'webforge:highlight') {
      enabled = true;
      if (data.selector) {
        try {
          var el = document.querySelector(data.selector);
          if (el) { selected = el; place(el); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        } catch (e) {}
      }
    }
    if (data.type === 'webforge:refresh') location.reload();
    if (data.type === 'webforge:apply') {
      try {
        var node = data.selector ? document.querySelector(data.selector) : null;
        if (!node) return;
        if (data.kind === 'text') node.textContent = data.value;
        if (data.kind === 'attr') node.setAttribute(data.name, data.value);
        if (data.kind === 'style') node.style[data.name] = data.value;
        if (data.kind === 'image' && data.value) node.src = data.value;
        if (data.kind === 'link' && data.value !== undefined) node.setAttribute('href', data.value);
        place(node);
      } catch (e) {}
    }
  });

  var events = null;
  function connect() {
    try {
      events = new EventSource('/__webforge/events');
      events.addEventListener('reload', function () {
        if (!enabled) location.reload();
      });
    } catch (e) {}
  }
  connect();
  window.parent.postMessage({ type: 'webforge:ready', pagePath: pagePath() }, '*');
})();
`
