(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const R = 22;
  const RA = 31; // areas are drawn larger so they read as hubs
  const rad = (n) => (n && n.type === 'area' ? RA : R);
  const hexPoints = (r) => [0, 1, 2, 3, 4, 5]
    .map((i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`; })
    .join(' ');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs, cls) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cls) e.setAttribute('class', cls);
    return e;
  }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  class Graph {
    constructor(svg, handlers) {
      this.svg = svg;
      this.h = handlers;
      this.nodes = [];
      this.edges = [];
      this.byId = new Map();
      this.nodeEls = new Map();
      this.edgeEls = new Map();
      this.view = { x: 0, y: 0, k: 1 };
      this.selected = null;
      this.linkFrom = null;
      this.hover = null;
      this.matches = null;
      this.lastClick = null;
      this.colorOf = () => '#7D8D93';

      const defs = el('defs');
      const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
      marker.append(el('path', { d: 'M0 0L10 5L0 10z' }));
      defs.append(marker);
      this.root = el('g');
      this.edgeLayer = el('g');
      this.nodeLayer = el('g');
      this.root.append(this.edgeLayer, this.nodeLayer);
      svg.append(defs, this.root);
      this.bind();
    }

    set(nodes, edges) {
      this.nodes = nodes;
      this.edges = edges;
      this.render();
    }

    render() {
      this.edgeLayer.replaceChildren();
      this.nodeLayer.replaceChildren();
      this.nodeEls.clear();
      this.edgeEls.clear();
      this.byId = new Map(this.nodes.map((n) => [n.id, n]));

      for (const e of this.edges) {
        const ends = [this.byId.get(e.from), this.byId.get(e.to)];
        const g = el('g', null, ends.some((n) => n && n.type === 'area') ? 'edge member' : 'edge');
        const line = el('line');
        const label = el('text');
        label.textContent = e.label;
        g.append(line, label);
        this.edgeLayer.append(g);
        this.edgeEls.set(e.id, { g, line, label });
      }
      for (const n of this.nodes) {
        const g = el('g', null, n.type === 'area' ? 'node area' : 'node');
        g.dataset.id = n.id;
        const r = rad(n);
        const shape = n.type === 'app'
          ? el('rect', { x: -r, y: -r, width: r * 2, height: r * 2, rx: 10 }, 'shape')
          : n.type === 'area'
            ? el('polygon', { points: hexPoints(r) }, 'shape')
            : el('circle', { r }, 'shape');
        const color = this.colorOf(n);
        shape.setAttribute('fill', color);
        const label = el('text', { y: r + 17 }, 'label');
        label.textContent = short(n.name, 20);
        if (n.icon) {
          // Logo on white, ringed in the group color so grouping stays visible.
          g.classList.add('has-icon');
          g.style.setProperty('--ring', color);
          const cid = 'clip-' + n.id.replace(/[^a-zA-Z0-9]/g, '');
          const clip = el('clipPath', { id: cid });
          const h = n.type === 'area' ? 25 : 19; // half the logo size
          clip.append(n.type === 'app'
            ? el('rect', { x: -h, y: -h, width: h * 2, height: h * 2, rx: 8 })
            : el('circle', { r: h }));
          const img = el('image', {
            href: n.icon, x: -h, y: -h, width: h * 2, height: h * 2,
            preserveAspectRatio: 'xMidYMid meet', 'clip-path': `url(#${cid})`,
          });
          g.append(shape, clip, img, label);
        } else {
          const letter = el('text', null, 'letter');
          letter.textContent = (n.name.trim()[0] || '?').toUpperCase();
          g.append(shape, letter, label);
        }
        this.nodeLayer.append(g);
        this.nodeEls.set(n.id, g);
      }
      this.updatePositions();
      this.applyState();
      this.applyView();
    }

    updatePositions() {
      for (const n of this.nodes) {
        const g = this.nodeEls.get(n.id);
        if (g) g.setAttribute('transform', `translate(${n.x || 0} ${n.y || 0})`);
      }
      for (const e of this.edges) {
        const a = this.byId.get(e.from);
        const b = this.byId.get(e.to);
        const o = this.edgeEls.get(e.id);
        if (!a || !b || !o) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const gap = a.type === 'area' || b.type === 'area' ? 2 : 4; // area links have no arrowhead
        o.line.setAttribute('x1', a.x + ux * rad(a));
        o.line.setAttribute('y1', a.y + uy * rad(a));
        o.line.setAttribute('x2', b.x - ux * (rad(b) + gap));
        o.line.setAttribute('y2', b.y - uy * (rad(b) + gap));
        o.label.setAttribute('x', (a.x + b.x) / 2);
        o.label.setAttribute('y', (a.y + b.y) / 2 - 5);
      }
    }

    applyState() {
      const focus = this.hover || this.selected;
      let near = null;
      if (focus) {
        near = new Set([focus]);
        for (const e of this.edges) {
          if (e.from === focus) near.add(e.to);
          if (e.to === focus) near.add(e.from);
        }
      }
      for (const [id, g] of this.nodeEls) {
        const dim = (near && !near.has(id)) || (this.matches && !this.matches.has(id));
        g.classList.toggle('dim', !!dim);
        g.classList.toggle('selected', id === this.selected);
        g.classList.toggle('linksrc', id === this.linkFrom);
      }
      for (const e of this.edges) {
        const o = this.edgeEls.get(e.id);
        if (!o) continue;
        const hot = !!focus && (e.from === focus || e.to === focus);
        const filtered = this.matches && !(this.matches.has(e.from) && this.matches.has(e.to));
        o.g.classList.toggle('hot', hot);
        o.g.classList.toggle('dim', (!!focus && !hot) || !!filtered);
      }
    }

    setSelected(id) { this.selected = id; this.applyState(); }
    setLinkFrom(id) { this.linkFrom = id; this.svg.classList.toggle('linking', !!id); this.applyState(); }
    setMatches(set) { this.matches = set; this.applyState(); }
    setHover(id) { if (this.hover !== id) { this.hover = id; this.applyState(); } }

    applyView() {
      const v = this.view;
      this.root.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.k})`);
    }

    animateTo(t, ms = 260) {
      if (reduceMotion || !ms) { this.view = { ...t }; this.applyView(); return; }
      const s = { ...this.view };
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - p, 3);
        this.view = { x: s.x + (t.x - s.x) * e, y: s.y + (t.y - s.y) * e, k: s.k + (t.k - s.k) * e };
        this.applyView();
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // Fits the view around every node, or only the ids in `only` (a Set) when given.
    fit(only) {
      const r = this.svg.getBoundingClientRect();
      const list = only && only.size ? this.nodes.filter((n) => only.has(n.id)) : this.nodes;
      if (!list.length) { this.animateTo({ x: r.width / 2, y: r.height / 2, k: 1 }); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of list) {
        const q = rad(n);
        x0 = Math.min(x0, n.x - q); x1 = Math.max(x1, n.x + q);
        y0 = Math.min(y0, n.y - q); y1 = Math.max(y1, n.y + q + 26);
      }
      const pad = 60;
      const bw = x1 - x0 + pad * 2;
      const bh = y1 - y0 + pad * 2;
      const k = Math.max(0.2, Math.min(r.width / bw, r.height / bh, 1.3));
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      this.animateTo({ k, x: r.width / 2 - cx * k, y: r.height / 2 - cy * k });
    }

    centerOn(id) {
      const n = this.byId.get(id);
      if (!n) return;
      const r = this.svg.getBoundingClientRect();
      const k = this.view.k;
      this.animateTo({ k, x: r.width / 2 - n.x * k, y: r.height / 2 - n.y * k });
    }

    viewCenter() {
      const r = this.svg.getBoundingClientRect();
      return { x: (r.width / 2 - this.view.x) / this.view.k, y: (r.height / 2 - this.view.y) / this.view.k };
    }

    bind() {
      const svg = this.svg;
      let drag = null;
      let pan = null;

      svg.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        const g = ev.target.closest('.node');
        svg.setPointerCapture(ev.pointerId);
        if (g) {
          drag = { n: this.byId.get(g.dataset.id), sx: ev.clientX, sy: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false };
        } else {
          pan = { sx: ev.clientX, sy: ev.clientY, vx: this.view.x, vy: this.view.y, moved: false };
        }
      });

      svg.addEventListener('pointermove', (ev) => {
        if (drag) {
          if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
          drag.moved = true;
          drag.n.x += (ev.clientX - drag.lx) / this.view.k;
          drag.n.y += (ev.clientY - drag.ly) / this.view.k;
          drag.lx = ev.clientX;
          drag.ly = ev.clientY;
          this.updatePositions();
        } else if (pan) {
          const dx = ev.clientX - pan.sx;
          const dy = ev.clientY - pan.sy;
          if (!pan.moved && Math.hypot(dx, dy) < 4) return;
          pan.moved = true;
          svg.classList.add('panning');
          this.view.x = pan.vx + dx;
          this.view.y = pan.vy + dy;
          this.applyView();
        } else {
          const g = ev.target.closest('.node');
          this.setHover(g ? g.dataset.id : null);
        }
      });

      const end = (ev) => {
        if (svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
        svg.classList.remove('panning');
        if (drag) {
          const d = drag;
          drag = null;
          if (d.moved) { this.h.onMove(d.n); return; }
          if (this.linkFrom) { this.h.onLinkTarget(d.n.id); return; }
          const now = performance.now();
          if (this.lastClick && this.lastClick.id === d.n.id && now - this.lastClick.t < 350) {
            this.lastClick = null;
            this.h.onLaunch(d.n.id);
          } else {
            this.lastClick = { id: d.n.id, t: now };
            this.h.onSelect(d.n.id);
          }
        } else if (pan) {
          const p = pan;
          pan = null;
          if (!p.moved) this.h.onBackground();
        }
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('pointerleave', () => { if (!drag && !pan) this.setHover(null); });

      svg.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const r = svg.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        const my = ev.clientY - r.top;
        const k = Math.min(3, Math.max(0.2, this.view.k * Math.exp(-ev.deltaY * 0.0015)));
        const f = k / this.view.k;
        this.view.x = mx - (mx - this.view.x) * f;
        this.view.y = my - (my - this.view.y) * f;
        this.view.k = k;
        this.applyView();
      }, { passive: false });
    }

    // Force-directed layout. Nodes in opts.pinned stay where they are.
    static layout(nodes, edges, opts = {}) {
      const pinned = opts.pinned || new Set();
      const groups = [...new Set(nodes.map((n) => n.group || ''))];
      // Space the clusters by how big the largest one is, so neighbours do not overlap.
      const biggest = Math.max(...groups.map((g) => nodes.filter((n) => (n.group || '') === g).length));
      const clusterR = 70 + 38 * Math.sqrt(biggest);
      const ring = groups.length > 1 ? (clusterR + 40) / Math.sin(Math.PI / groups.length) : 0;
      const center = new Map(groups.map((g, i) => {
        const a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
        return [g, { x: Math.cos(a) * ring, y: Math.sin(a) * ring }];
      }));
      for (const n of nodes) {
        if (n.x == null || n.y == null) {
          const c = center.get(n.group || '');
          const spread = n.type === 'area' ? 20 : 150;
          n.x = c.x + (Math.random() - 0.5) * spread;
          n.y = c.y + (Math.random() - 0.5) * spread;
        }
      }
      const N = nodes.length;
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      const links = edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter((l) => l[0] != null && l[1] != null);
      const ITER = 320;
      for (let it = 0; it < ITER; it++) {
        const t = 1 - it / ITER;
        const fx = new Float64Array(N);
        const fy = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            const d = Math.sqrt(d2);
            const f = 14000 / d2;
            fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
            fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
          }
        }
        for (const [a, b] of links) {
          const dx = nodes[b].x - nodes[a].x;
          const dy = nodes[b].y - nodes[a].y;
          const d = Math.hypot(dx, dy) || 1;
          const f = (d - 170) * 0.04;
          fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
          fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
        }
        for (let i = 0; i < N; i++) {
          const c = center.get(nodes[i].group || '');
          const pull = nodes[i].type === 'area' ? 0.08 : 0.012; // hubs sit in the middle of their cluster
          fx[i] += (c.x - nodes[i].x) * pull;
          fy[i] += (c.y - nodes[i].y) * pull;
        }
        for (let i = 0; i < N; i++) {
          if (pinned.has(nodes[i].id)) continue;
          const m = Math.hypot(fx[i], fy[i]) || 1;
          const s = Math.min(m, 40 * t + 2) / m;
          nodes[i].x += fx[i] * s;
          nodes[i].y += fy[i] * s;
        }
      }
      for (const n of nodes) { n.x = Math.round(n.x); n.y = Math.round(n.y); }
    }
  }

  window.Graph = Graph;
})();
