export const EDITOR_SCRIPT = String.raw`
(() => {
  if (window.__webforgeEditorLoaded) return;
  window.__webforgeEditorLoaded = true;
  var TOKEN = "__WEBFORGE_TOKEN__";
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

  function ownText(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i += 1) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) out.push(n);
    }
    return out;
  }

  function textIndexAt(el, x, y) {
    var nodes = ownText(el);
    if (!nodes.length) return undefined;
    var target = null;
    if (document.caretRangeFromPoint) {
      try {
        var range = document.caretRangeFromPoint(x, y);
        if (range && range.startContainer && range.startContainer.nodeType === 3) target = range.startContainer;
      } catch (e) {}
    }
    if (!target && el.childNodes.length) {
      for (var i = 0; i < el.childNodes.length; i += 1) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) {
          var rect = textRect(n);
          if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { target = n; break; }
        }
      }
    }
    if (!target) return 0;
    for (var k = 0; k < nodes.length; k += 1) if (nodes[k] === target) return k;
    return 0;
  }

  function textRect(node) {
    try {
      var range = document.createRange();
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      if (!rects.length) return null;
      return rects[0];
    } catch (e) { return null; }
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

  function pickStyle(style, el) {
    var out = {};
    var keys = [
      'color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height',
      'letter-spacing', 'text-align', 'opacity', 'display', 'border-radius', 'border',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'max-width'
    ];
    for (var i = 0; i < keys.length; i += 1) out[keys[i]] = style.getPropertyValue(keys[i]);
    out['is-transparent-bg'] = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/.test(String(style['background-color'] || '').trim()) ? '1' : '0';
    return out;
  }

  function describe(el, x, y) {
    var style = getComputedStyle(el);
    var text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i += 1) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-webforge') === 0) continue;
      attrs[a.name] = a.value.slice(0, 2000);
    }
    var own = ownText(el);
    var ownTextValue = own.map(function (n) { return n.nodeValue.trim(); }).join(' ').slice(0, 400);
    var clickedIndex = textIndexAt(el, x, y);
    var clickedNode = own[clickedIndex];
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: text,
      html: el.innerHTML.slice(0, 40000),
      attrs: attrs,
      classes: (attrs['class'] || '').split(/\s+/).filter(Boolean),
      styles: pickStyle(style, el),
      imageSrc: el.currentSrc || el.src || null,
      textCount: own.length,
      textIndex: clickedIndex,
      clickedText: (clickedNode ? clickedNode.nodeValue.trim() : text).slice(0, 300),
      ownText: ownTextValue,
      editableText: ownTextValue || text,
      hasElementChildren: el.children.length > 0,
      levels: levels(el),
      label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (text ? ' — ' + text.slice(0, 60) : '')
    };
  }

  function levels(el) {
    var out = [];
    var node = el;
    for (var depth = 0; node && node.nodeType === 1 && node !== document.documentElement && depth < 6; depth += 1) {
      var own = ownText(node);
      var text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
      out.push({
        selector: cssPath(node),
        tag: node.tagName.toLowerCase(),
        text: text.slice(0, 120),
        textCount: own.length,
        editableText: (own.map(function (n) { return n.nodeValue.trim(); }).join(' ') || text).slice(0, 300)
      });
      node = node.parentElement;
    }
    return out;
  }

  function send(target) {
    window.parent.postMessage({ type: 'webforge:select', token: TOKEN, pagePath: pagePath(), target: target }, '*');
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
    if (!el || !el.closest) return;
    if (el.closest('[data-webforge-ui]')) return;
    event.preventDefault();
    event.stopPropagation();
    if ((event.detail > 1 || event.altKey) && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
    selected = el;
    place(el);
    send(describe(el, event.clientX, event.clientY));
  }, true);

  document.addEventListener('submit', function (event) {
    if (enabled) event.preventDefault();
  }, true);

  function applyTextIndex(el, index, value) {
    var nodes = ownText(el);
    if (!nodes.length) { el.textContent = value; return; }
    var node = nodes[index] || nodes[nodes.length - 1];
    node.nodeValue = value;
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.token !== TOKEN) return;
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
        if (data.kind === 'text') applyTextIndex(node, data.textIndex || 0, data.value);
        if (data.kind === 'attr') node.setAttribute(data.name, data.value);
        if (data.kind === 'removeAttr' || data.kind === 'remove-attr') node.removeAttribute(data.name);
        if (data.kind === 'style') {
          if (data.value === '' || data.value === null) node.style.removeProperty(data.name);
          else node.style.setProperty(data.name, data.value);
        }
        if (data.kind === 'image') {
          if (data.value) { node.src = data.value; if (data.alt !== undefined && data.alt !== null) node.setAttribute('alt', data.alt); }
        }
        if (data.kind === 'link' && data.value !== undefined) {
          node.setAttribute('href', data.value);
          if (data.target) node.setAttribute('target', data.target); else node.removeAttribute('target');
        }
        if (data.kind === 'html') node.innerHTML = data.value;
        if (data.kind === 'remove') node.remove();
        if (data.kind === 'insertBefore') node.insertAdjacentHTML('beforebegin', data.value);
        if (data.kind === 'insertAfter') node.insertAdjacentHTML('afterend', data.value);
        selected = document.querySelector(data.selector);
        place(selected);
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
  window.parent.postMessage({ type: 'webforge:ready', token: TOKEN, pagePath: pagePath() }, '*');
})();
`
