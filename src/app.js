(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };

  const OS = hub.platform === 'darwin' ? 'mac' : 'win';
  const OS_NAME = OS === 'mac' ? 'Mac' : 'Windows';
  const PALETTE = ['#2A7F7A', '#C2882B', '#8A4F86', '#3F6FA3', '#B65A42', '#7C8A3A', '#B04F73', '#4F7F52'];
  const UNGROUPED = '#7D8D93';

  const state = { nodes: [], edges: [], file: '' };
  let selectedId = null;
  let linkFrom = null;
  let saveTimer = null;
  let query = '';
  let editing = null;
  let iconDraft = '';
  let iconCleared = false;
  let colorDraft = '';
  let focusId = '';

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const byId = (id) => state.nodes.find((n) => n.id === id);
  const targetOf = (n) => (n.type === 'web' ? n.url : n.paths[OS]);
  const snapshot = () => ({ version: 1, nodes: state.nodes, edges: state.edges });
  const sameName = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  const areaFor = (g) => (g ? state.nodes.find((n) => n.type === 'area' && sameName(n.name, g)) : null);
  const groupColor = (g) => {
    if (!g) return UNGROUPED;
    const area = areaFor(g);
    if (area && area.color) return area.color;
    const hash = [...g.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return PALETTE[hash % PALETTE.length];
  };

  const shapeClass = (n) => (n.type === 'app' ? 'sq' : n.type === 'area' ? 'hex' : 'ci');
  const badge = (n) => (n.icon
    ? h('img', { class: 'ico ' + shapeClass(n), src: n.icon, alt: '' })
    : h('span', { class: 'swatch ' + shapeClass(n), style: `background:${groupColor(n.group)}` }));

  const graph = new Graph($('#graph'), {
    onSelect: (id) => { select(id); centerSoon(id); },
    onLaunch: (id) => { cancelCenter(); const n = byId(id); if (n && n.type !== 'area') launch(n); },
    onMove: () => scheduleSave(),
    onLinkTarget: (id) => finishLink(id),
    onBackground: () => { cancelCenter(); if (!linkFrom) select(null); },
    onInteract: () => cancelCenter(),
  });

  // Clicking an item on the map selects it right away and, a moment later, glides the map to center it.
  // The pause leaves time to double-click to open it, and the second click cancels the glide. Dragging,
  // scrolling or clicking elsewhere cancels it too. Items the side panel would hide are centered at once.
  const CENTER_DELAY_MS = 1000;
  let centerTimer = null;
  function cancelCenter() { if (centerTimer) { clearTimeout(centerTimer); centerTimer = null; } }
  function centerSoon(id) {
    cancelCenter();
    requestAnimationFrame(() => {
      if (selectedId !== id) return;
      if (!graph.isVisible(id)) { graph.centerOn(id); return; }
      centerTimer = setTimeout(() => {
        centerTimer = null;
        if (selectedId !== id || linkFrom || document.querySelector('dialog[open]')) return;
        graph.centerOn(id);
      }, CENTER_DELAY_MS - 20);
    });
  }
  graph.colorOf = (n) => groupColor(n.group);

  // ---------- feedback ----------
  let toastTimer;
  let toastHide;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    clearTimeout(toastHide);
    try { if (!t.matches(':popover-open')) t.showPopover(); } catch { /* ignore */ }
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('show');
      toastHide = setTimeout(() => { try { t.hidePopover(); } catch { /* ignore */ } }, 250);
    }, isErr ? 6000 : 2600);
  }
  function setStatus(msg) { $('#status').textContent = msg; }

  // ---------- persistence ----------
  // Undo and redo keep snapshots of the map (items, positions and connections).
  const MAX_HISTORY = 60;
  let past = [];
  let future = [];
  let baseline = '';
  const snap = () => JSON.stringify({ nodes: state.nodes, edges: state.edges });
  function markBaseline() { baseline = snap(); past = []; future = []; }
  function recordChange(skip) {
    const cur = snap();
    if (cur === baseline) return;
    if (!skip) { past.push(baseline); if (past.length > MAX_HISTORY) past.shift(); future = []; }
    baseline = cur;
  }
  function restore(json) {
    const d = JSON.parse(json);
    applyData({ nodes: d.nodes, edges: d.edges });
    graph.fit(focusSet());
    scheduleSave(true);
  }
  function undo() {
    if (!past.length) { toast('Nothing to undo.'); return; }
    future.push(baseline);
    baseline = past.pop();
    restore(baseline);
    toast('Undone. Press ' + (OS === 'mac' ? '⌘⇧Z' : 'Ctrl+Shift+Z') + ' to redo.');
  }
  function redo() {
    if (!future.length) { toast('Nothing to redo.'); return; }
    past.push(baseline);
    baseline = future.pop();
    restore(baseline);
    toast('Redone.');
  }

  function scheduleSave(skipHistory) {
    recordChange(!!skipHistory);
    clearTimeout(saveTimer);
    setStatus('Saving…');
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await hub.save(snapshot());
        setStatus('All changes saved');
      } catch (e) {
        setStatus('Could not save');
        toast('Could not save your changes: ' + e.message, true);
      }
    }, 400);
  }
  window.addEventListener('beforeunload', () => {
    if (saveTimer) { clearTimeout(saveTimer); hub.saveSync(snapshot()); }
  });

  function layoutMissing() {
    const missing = state.nodes.some((n) => n.x == null || n.y == null);
    if (!missing) return false;
    const pinned = new Set(state.nodes.filter((n) => n.x != null && n.y != null).map((n) => n.id));
    Graph.layout(state.nodes, state.edges, { pinned });
    return true;
  }

  function applyData(data, file) {
    state.nodes = data.nodes;
    state.edges = data.edges;
    if (file) state.file = file;
    const placed = layoutMissing();
    if (!byId(selectedId)) selectedId = null;
    linkFrom = null;
    graph.setLinkFrom(null);
    graph.set(state.nodes, state.edges);
    graph.setSelected(selectedId);
    applySearch();
    renderAll();
    $('#file').textContent = state.file;
    $('#file').title = state.file;
    return placed;
  }

  // ---------- rendering ----------
  function renderAll() {
    renderFocus();
    renderList();
    renderDetail();
    renderLegend();
    updateHint();
    $('#empty').hidden = state.nodes.length > 0;
    $('#groupList').replaceChildren(...[...new Set(state.nodes.map((n) => n.group).filter(Boolean))].sort().map((g) => h('option', { value: g })));
  }

  const matchesQuery = (n, q) => [n.name, n.group, n.url, n.notes].some((s) => (s || '').toLowerCase().includes(q));
  // Everything that belongs to an area: items in its group, items linked to it, and items nested under those
  // (an arrow means parent to child). Areas themselves are never members.
  function areaMembers(area) {
    const out = [];
    const seen = new Set();
    const add = (n) => { if (n && n.type !== 'area' && !seen.has(n.id)) { seen.add(n.id); out.push(n); } };
    for (const n of state.nodes) if (sameName(n.group, area.name)) add(n);
    for (const e of state.edges) {
      if (e.from === area.id) add(byId(e.to));
      else if (e.to === area.id) add(byId(e.from));
    }
    for (let i = 0; i < out.length; i++) for (const e of state.edges) if (e.from === out[i].id) add(byId(e.to));
    return out;
  }
  // Focus on one area: the area and everything that belongs to it.
  const focusSet = () => {
    const a = byId(focusId);
    if (!a || a.type !== 'area') return null;
    return new Set([a.id, ...areaMembers(a).map((n) => n.id)]);
  };
  const visibleSet = () => {
    const f = focusSet();
    const q = query.trim().toLowerCase();
    if (!f && !q) return null;
    return new Set(state.nodes.filter((n) => (!f || f.has(n.id)) && (!q || matchesQuery(n, q))).map((n) => n.id));
  };
  const filtered = () => {
    const vis = visibleSet();
    const rank = (n) => (n.type === 'area' ? 0 : 1); // the area leads its group
    return state.nodes.filter((n) => !vis || vis.has(n.id)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  };

  function renderList() {
    const items = filtered();
    const groups = new Map();
    for (const n of items) {
      const g = n.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const out = [];
    for (const g of keys) {
      out.push(h('h2', {}, h('span', { class: 'swatch ci', style: `background:${groupColor(g)}` }), g || 'No group', h('span', { class: 'count' }, String(groups.get(g).length))));
      for (const n of groups.get(g)) {
        out.push(h('div', { class: 'row' + (n.id === selectedId ? ' on' : '') },
          h('button', { class: 'row-main', onclick: () => { select(n.id); graph.centerOn(n.id); } },
            badge(n), n.name),
          n.type === 'area' ? null : h('button', { class: 'row-open', 'aria-label': `Open ${n.name}`, onclick: () => launch(n) }, 'Open')));
      }
    }
    if (!out.length) out.push(h('p', { class: 'list-empty' }, state.nodes.length ? 'No items match your search.' : 'Your items will appear here.'));
    $('#list').replaceChildren(...out);
  }

  function renderLegend() {
    const groups = [...new Set(state.nodes.map((n) => n.group || ''))].sort();
    const items = groups.map((g) => {
      const swatch = h('span', { class: 'swatch ci', style: `background:${groupColor(g)}` });
      const area = areaFor(g);
      if (!area) return h('li', {}, swatch, g || 'No group');
      return h('li', {}, h('button', { title: `Focus on ${area.name}`, onclick: () => { const sel = $('#focus'); sel.value = area.id; sel.dispatchEvent(new Event('change')); } }, swatch, g));
    });
    if (items.length) {
      items.push(h('li', { class: 'sep' }));
      items.push(h('li', {}, h('span', { class: 'swatch ci', style: 'background:var(--muted)' }), 'Website'));
      items.push(h('li', {}, h('span', { class: 'swatch sq', style: 'background:var(--muted)' }), 'App'));
      if (state.nodes.some((n) => n.type === 'area')) items.push(h('li', {}, h('span', { class: 'swatch hex', style: 'background:var(--muted)' }), 'Area'));
    }
    $('#legend').replaceChildren(...items);
    $('#legend').hidden = !items.length;
  }

  function linkRow(n, e) {
    const out = e.from === n.id;
    const other = byId(out ? e.to : e.from);
    if (!other) return null;
    return h('li', {},
      h('button', { class: 'linklink', onclick: () => { select(other.id); graph.centerOn(other.id); } }, (out ? 'To ' : 'From ') + other.name),
      h('button', {
        class: 'icon', 'aria-label': `Remove connection with ${other.name}`,
        onclick: () => { state.edges = state.edges.filter((x) => x !== e); graph.set(state.nodes, state.edges); graph.setSelected(selectedId); renderDetail(); scheduleSave(); },
      }, 'Remove'),
      h('input', {
        class: 'edge-input', 'data-edge': e.id, value: e.label, maxlength: '40', placeholder: 'How do they connect?',
        'aria-label': `Connection label with ${other.name}`,
        onchange: (ev) => { e.label = ev.target.value.trim(); graph.render(); scheduleSave(); },
      }));
  }

  function renderDetail() {
    const box = $('#detail');
    const n = byId(selectedId);
    box.hidden = !n;
    if (!n) return;
    const target = targetOf(n);
    const links = state.edges.filter((e) => (e.from === n.id || e.to === n.id) && !graph.hidden.has(e.id));
    const parts = [
      h('div', { class: 'd-head' },
        badge(n),
        h('div', {}, h('h2', {}, n.name), h('p', { class: 'muted' }, (n.type === 'app' ? 'Desktop app' : n.type === 'area' ? 'Area' : 'Website') + (n.type !== 'area' && n.group ? ' in ' + n.group : '')))),
      h('div', { class: 'd-actions' },
        n.type === 'area'
          ? (openable(n).length ? h('button', { class: 'primary', onclick: () => openAll(n) }, `Open all (${openable(n).length})`) : null)
          : h('button', { class: 'primary', onclick: () => launch(n) }, 'Open'),
        h('button', { onclick: () => openEdit(n) }, 'Edit'),
        h('button', { onclick: startLink }, 'Connect to…')),
      n.type === 'area'
        ? h('p', { class: 'muted' }, 'An area opens nothing. Connect the apps and websites that belong to it.')
        : h('dl', {}, h('dt', {}, n.type === 'web' ? 'Address' : `Path on ${OS_NAME}`),
          h('dd', { class: target ? 'mono' : 'warn' }, target || `Not set for ${OS_NAME}. Choose Edit to add it.`)),
      n.notes ? h('dl', {}, h('dt', {}, 'Notes'), h('dd', { class: 'notes' }, n.notes)) : null,
      h('h3', {}, `Connections (${links.length})`),
      links.length
        ? h('ul', { class: 'links' }, links.map((e) => linkRow(n, e)))
        : h('p', { class: 'muted' }, 'Nothing connected yet. Choose “Connect to…” to show how this fits with your other tools.'),
      h('h3', {}, 'Remove'),
      h('button', { class: 'danger', onclick: () => remove(n) }, 'Delete this item'),
    ];
    box.replaceChildren(...parts.filter(Boolean));
  }

  function updateHint() {
    const hint = $('#hint');
    const src = byId(linkFrom);
    hint.hidden = !src;
    if (src) hint.textContent = `Click the item to connect “${src.name}” to. Press Esc to cancel.`;
  }

  // ---------- actions ----------
  function select(id) {
    cancelCenter();
    selectedId = id;
    linkFrom = null;
    graph.setLinkFrom(null);
    graph.setSelected(id);
    renderList();
    renderDetail();
    updateHint();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Items of an area that can be opened on this computer, in name order.
  const openable = (area) => areaMembers(area).filter((n) => targetOf(n)).sort((a, b) => a.name.localeCompare(b.name));
  async function openAll(area) {
    const items = openable(area);
    if (!items.length) { toast(`Nothing in “${area.name}” can be opened on ${OS_NAME}.`, true); return; }
    const list = items.slice(0, 8).map((n) => '• ' + n.name).join('\n') + (items.length > 8 ? `\n• …and ${items.length - 8} more` : '');
    if (!confirm(`Open ${items.length} item${items.length === 1 ? '' : 's'} from “${area.name}”?\n\n${list}`)) return;
    let failed = 0;
    for (const n of items) {
      const r = await hub.launch(n);
      if (!r.ok) failed++;
      await sleep(350);
    }
    if (failed) toast(`Opened ${items.length - failed} of ${items.length}. ${failed} could not be opened.`, true);
    else toast(`Opened ${items.length} item${items.length === 1 ? '' : 's'} from “${area.name}”.`);
  }

  async function launch(n) {
    const r = await hub.launch(n);
    if (!r.ok) toast(r.error, true);
  }

  function startLink() {
    if (!selectedId) return;
    linkFrom = selectedId;
    graph.setLinkFrom(linkFrom);
    updateHint();
  }

  function finishLink(targetId) {
    const src = linkFrom;
    linkFrom = null;
    graph.setLinkFrom(null);
    if (!src || src === targetId) { updateHint(); return; }
    if (state.edges.some((e) => (e.from === src && e.to === targetId) || (e.from === targetId && e.to === src))) {
      toast('Those two are already connected.');
      updateHint();
      return;
    }
    const e = { id: uid(), from: src, to: targetId, label: '' };
    state.edges.push(e);
    graph.set(state.nodes, state.edges);
    select(src);
    scheduleSave();
    const input = document.querySelector(`[data-edge="${e.id}"]`);
    if (input) input.focus();
  }

  function remove(n) {
    if (!confirm(`Delete “${n.name}” and its connections?\n\nYou can undo this with ${OS === 'mac' ? '⌘Z' : 'Ctrl+Z'}.`)) return;
    state.nodes = state.nodes.filter((x) => x !== n);
    state.edges = state.edges.filter((e) => e.from !== n.id && e.to !== n.id);
    graph.set(state.nodes, state.edges);
    select(null);
    renderAll();
    scheduleSave();
  }

  // Connects an item to the area named like its group (or an area to the items in its group).
  // Only runs when the item is new or its group changed, so a connection you removed by hand stays removed.
  function linkToArea(node) {
    const connect = (a, b) => {
      if (state.edges.some((e) => (e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id))) return;
      state.edges.push({ id: uid(), from: a.id, to: b.id, label: '' });
    };
    if (node.type === 'area') {
      for (const x of state.nodes) if (x !== node && x.type !== 'area' && x.group && sameName(x.group, node.name)) connect(node, x);
    } else if (node.group) {
      const hubNode = areaFor(node.group);
      if (hubNode) { node.group = hubNode.name; connect(hubNode, node); }
    }
  }

  // ---------- add / edit dialog ----------
  const dlg = $('#editDlg');
  const typeValue = () => document.querySelector('input[name=type]:checked').value;
  function syncType() {
    const t = typeValue();
    $('#rowUrl').hidden = t !== 'web';
    $('#rowApp').hidden = t !== 'app';
    $('#rowGroup').hidden = t === 'area';
    $('#rowAreaNote').hidden = t !== 'area';
    $('#iconAuto').hidden = t === 'area';
    $('#iconNote').textContent = t === 'area'
      ? 'Optional. Choose an image to show inside the area, or leave it as a letter.'
      : "Websites: Hub looks up the site's own icon online. Apps: Hub reads the icon from the app. Or choose any image file.";
    if (t === 'area') renderColors();
  }
  const nextFreeColor = () => {
    const used = new Set(state.nodes.filter((n) => n.type === 'area' && n.color).map((n) => n.color.toLowerCase()));
    return PALETTE.find((c) => !used.has(c.toLowerCase())) || PALETTE[state.nodes.filter((n) => n.type === 'area').length % PALETTE.length];
  };
  function renderColors() {
    $('#colorChoices').replaceChildren(...PALETTE.map((c) => h('button', {
      type: 'button', role: 'radio', 'aria-label': c, 'aria-checked': String(c.toLowerCase() === colorDraft.toLowerCase()),
      style: `background:${c}`,
      onclick: () => { colorDraft = c; renderColors(); },
    })));
  }
  function openEdit(n) {
    editing = n;
    $('#editTitle').textContent = n ? 'Edit item' : 'Add item';
    $('#f_name').value = n ? n.name : '';
    document.querySelector(`input[name=type][value=${n ? n.type : 'web'}]`).checked = true;
    $('#f_url').value = n ? n.url : '';
    $('#f_win').value = n ? n.paths.win : '';
    $('#f_mac').value = n ? n.paths.mac : '';
    $('#f_group').value = n ? n.group : '';
    $('#f_notes').value = n ? n.notes : '';
    iconDraft = n ? n.icon || '' : '';
    iconCleared = false;
    colorDraft = n && n.color ? n.color : nextFreeColor();
    renderIconPreview();
    $('#formError').hidden = true;
    $('#browseWin').hidden = OS !== 'win';
    $('#browseMac').hidden = OS !== 'mac';
    syncType();
    dlg.showModal();
    $('#f_name').focus();
  }
  document.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', syncType));
  $('#cancelEdit').addEventListener('click', () => dlg.close());
  function renderIconPreview() {
    const box = $('#iconPreview');
    if (iconDraft) box.replaceChildren(h('img', { src: iconDraft, alt: '' }));
    else box.textContent = ($('#f_name').value.trim()[0] || '?').toUpperCase();
  }
  $('#f_name').addEventListener('input', () => { if (!iconDraft) renderIconPreview(); });

  // Looks up a logo for an item: the site's icon for websites, the app's own icon for apps.
  async function lookupIcon(item) {
    if (item.type === 'area') return null;
    if (item.type === 'web') return item.url ? hub.fetchFavicon(item.url) : null;
    return item.paths[OS] ? hub.appIcon(item.paths[OS]) : null;
  }
  $('#iconAuto').addEventListener('click', async () => {
    const btn = $('#iconAuto');
    const item = { type: typeValue(), url: $('#f_url').value.trim(), paths: { win: $('#f_win').value.trim(), mac: $('#f_mac').value.trim() } };
    if (item.type === 'area') { toast('Areas have no icon to look up. Choose an image instead.', true); return; }
    if (item.type === 'web' && !item.url) { toast('Enter the web address first.', true); return; }
    if (item.type === 'app' && !item.paths[OS]) { toast(`Enter the ${OS_NAME} path first.`, true); return; }
    btn.disabled = true;
    btn.textContent = 'Looking…';
    const icon = await lookupIcon(item);
    btn.disabled = false;
    btn.textContent = 'Find automatically';
    if (icon) { iconDraft = icon; iconCleared = false; renderIconPreview(); }
    else toast('No logo found. Try “Choose image” instead.', true);
  });
  $('#iconPick').addEventListener('click', async () => {
    const r = await hub.pickImage();
    if (!r) return;
    if (r.error) { toast(r.error, true); return; }
    iconDraft = r.icon;
    iconCleared = false;
    renderIconPreview();
  });
  $('#iconClear').addEventListener('click', () => { iconDraft = ''; iconCleared = true; renderIconPreview(); });

  // Fills in a logo in the background after an item is saved without one.
  async function autoIcon(n) {
    try {
      const icon = await lookupIcon(n);
      if (icon && byId(n.id) && !n.icon) {
        n.icon = icon;
        graph.render();
        renderAll();
        scheduleSave(true);
      }
    } catch { /* logos are optional */ }
  }

  async function browse(inputId) {
    const p = await hub.pickApp();
    if (p) $(inputId).value = p;
  }
  $('#browseWin').addEventListener('click', () => browse('#f_win'));
  $('#browseMac').addEventListener('click', () => browse('#f_mac'));

  $('#editForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const type = typeValue();
    const data = {
      name: $('#f_name').value.trim(),
      type,
      url: $('#f_url').value.trim(),
      paths: { win: $('#f_win').value.trim(), mac: $('#f_mac').value.trim() },
      group: $('#f_group').value.trim(),
      notes: $('#f_notes').value.trim(),
      icon: iconDraft,
    };
    if (type === 'area') { data.group = data.name; data.url = ''; data.paths = { win: '', mac: '' }; data.color = colorDraft || nextFreeColor(); }
    else data.color = '';
    let error = '';
    if (!data.name) error = 'Enter a name for this item.';
    else if (type === 'web' && !data.url) error = 'Enter a web address.';
    else if (type === 'app' && !data.paths.win && !data.paths.mac) error = 'Enter the path to the app on Windows, Mac, or both.';
    if (error) {
      $('#formError').textContent = error;
      $('#formError').hidden = false;
      return;
    }
    let node = editing;
    let membershipChanged = true;
    if (node) {
      const oldGroup = node.group;
      const oldType = node.type;
      Object.assign(node, data);
      // Renaming an area renames its group so colors and focus keep working.
      if (node.type === 'area' && oldType === 'area' && oldGroup && oldGroup !== node.name) {
        for (const x of state.nodes) if (x !== node && x.group === oldGroup) x.group = node.name;
      }
      membershipChanged = oldGroup !== node.group || oldType !== node.type;
    } else {
      const c = graph.viewCenter();
      node = { id: uid(), ...data, x: Math.round(c.x + (Math.random() - 0.5) * 120), y: Math.round(c.y + (Math.random() - 0.5) * 120) };
      state.nodes.push(node);
    }
    if (membershipChanged) linkToArea(node);
    dlg.close();
    graph.set(state.nodes, state.edges);
    select(node.id);
    renderAll();
    scheduleSave();
    if (!node.icon && !iconCleared) autoIcon(node);
  });

  // ---------- data dialog ----------
  const dataDlg = $('#dataDlg');
  $('#btnData').addEventListener('click', async () => {
    $('#dataPath').textContent = state.file;
    $('#verLine').textContent = 'Version ' + (await hub.version());
    dataDlg.showModal();
  });
  $('#closeData').addEventListener('click', () => dataDlg.close());
  $('#btnLocation').addEventListener('click', async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await hub.save(snapshot()); }
    const r = await hub.chooseLocation(snapshot());
    if (!r) return;
    applyData(r.data, r.file);
    graph.fit();
    setStatus('All changes saved');
    $('#dataPath').textContent = r.file;
    if (r.warning) toast(r.warning, true);
    else toast('Now using that data file.');
  });
  $('#btnExport').addEventListener('click', async () => {
    const p = await hub.exportData(snapshot());
    if (p) toast('Backup saved.');
  });
  $('#btnImport').addEventListener('click', async () => {
    const d = await hub.importData();
    if (!d) return;
    if (!confirm(`Replace your current ${state.nodes.length} items with the ${d.nodes.length} items in that file?`)) return;
    applyData(d);
    graph.fit();
    scheduleSave();
    dataDlg.close();
  });

  // ---------- toolbar, search, keys ----------
  $('#btnAdd').addEventListener('click', () => openEdit(null));
  $('#emptyAdd').addEventListener('click', () => openEdit(null));
  $('#btnFit').addEventListener('click', () => graph.fit(focusSet()));
  $('#btnTidy').addEventListener('click', () => {
    if (!state.nodes.length) return;
    Graph.layout(state.nodes, state.edges);
    graph.updatePositions();
    graph.fit();
    scheduleSave();
  });
  $('#emptyExamples').addEventListener('click', () => {
    const mk = (type, name, url, group) => ({ id: uid(), name, type, url, paths: { win: '', mac: '' }, group, notes: '', icon: '', x: null, y: null });
    const work = mk('area', 'Work', '', 'Work');
    const school = mk('area', 'School', '', 'School');
    work.color = PALETTE[3];
    school.color = PALETTE[1];
    const mail = mk('web', 'Mail', 'https://mail.google.com', 'Work');
    const cal = mk('web', 'Calendar', 'https://calendar.google.com', 'Work');
    const slack = mk('web', 'Slack', 'https://app.slack.com', 'Work');
    const jira = mk('web', 'Jira', 'https://www.atlassian.com/software/jira', 'Work');
    const canvas = mk('web', 'Canvas', 'https://canvas.instructure.com', 'School');
    const sMail = mk('web', 'Student email', 'https://outlook.office.com', 'School');
    const library = mk('web', 'Library', 'https://www.worldcat.org', 'School');
    const link = (a, b, label = '') => ({ id: uid(), from: a.id, to: b.id, label });
    const all = [work, mail, cal, slack, jira, school, canvas, sMail, library];
    applyData({
      nodes: all,
      edges: [
        link(work, mail), link(work, cal), link(work, slack), link(work, jira), link(slack, jira, 'alerts'),
        link(school, canvas), link(school, sMail), link(school, library), link(sMail, canvas, 'announcements'),
      ],
    });
    graph.fit();
    scheduleSave();
    all.forEach(autoIcon);
  });

  function applySearch() { graph.setMatches(visibleSet()); }

  function renderFocus() {
    const sel = $('#focus');
    const areas = state.nodes.filter((n) => n.type === 'area').sort((a, b) => a.name.localeCompare(b.name));
    if (!areas.some((a) => a.id === focusId)) focusId = '';
    sel.replaceChildren(h('option', { value: '' }, 'Everything'), ...areas.map((a) => h('option', { value: a.id }, a.name)));
    sel.value = focusId;
    sel.hidden = !areas.length;
    applySearch();
  }
  $('#focus').addEventListener('change', (ev) => {
    focusId = ev.target.value;
    applySearch();
    renderList();
    graph.fit(focusSet());
  });
  $('#search').addEventListener('input', (ev) => { query = ev.target.value; applySearch(); renderList(); });
  $('#search').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const first = filtered().find((n) => n.type !== 'area');
      if (first) launch(first);
    } else if (ev.key === 'Escape') {
      ev.target.value = '';
      query = '';
      applySearch();
      renderList();
      ev.target.blur();
    }
  });
  document.addEventListener('keydown', (ev) => {
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    if (mod && key === 'k') {
      ev.preventDefault();
      if (present) setPresent(false);
      $('#search').focus();
      $('#search').select();
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
    if (mod && !typing && (key === 'z' || key === 'y')) {
      ev.preventDefault();
      if (key === 'y' || ev.shiftKey) redo(); else undo();
      return;
    }
    if (typing || mod || ev.altKey) return;
    const n = byId(selectedId);
    const onButton = ev.target.tagName === 'BUTTON' || ev.target.tagName === 'A';
    if (ev.key === 'Escape') {
      if (present) setPresent(false);
      else if (linkFrom) { linkFrom = null; graph.setLinkFrom(null); updateHint(); }
      else if (selectedId) select(null);
    } else if (ev.key === 'Enter' && n && n.type !== 'area' && !onButton) {
      launch(n);
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && n) {
      ev.preventDefault();
      remove(n);
    } else if (key === 'n' && !present) { openEdit(null); ev.preventDefault();
    } else if (key === 'e' && n && !present) { openEdit(n); ev.preventDefault();
    } else if (key === 'f') { graph.fit(focusSet());
    } else if (key === 'p') { setPresent(!present);
    } else if (ev.key === '/' && !present) { ev.preventDefault(); $('#search').focus();
    } else if (ev.key === '?') { $('#helpDlg').showModal(); }
  });

  // ---------- map tools: backgrounds, presentation, image export, help ----------
  const pref = {
    get(k, d) { try { const v = localStorage.getItem('hub.' + k); return v === null ? d : v === '1'; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('hub.' + k, v ? '1' : '0'); } catch { /* preferences are optional */ } },
  };
  function setHalos(on) {
    graph.setHalos(on);
    $('#btnHalos').setAttribute('aria-pressed', String(on));
    pref.set('halos', on);
  }
  $('#btnHalos').addEventListener('click', () => setHalos($('#btnHalos').getAttribute('aria-pressed') !== 'true'));
  setHalos(pref.get('halos', true));

  let present = false;
  function setPresent(on) {
    present = on;
    document.body.classList.toggle('present', on);
    $('#btnPresent').textContent = on ? 'Exit' : 'Present';
    if (on) toast('Presenting. Press Esc to exit.');
    setTimeout(() => graph.fit(focusSet()), 80);
  }
  $('#btnPresent').addEventListener('click', () => setPresent(!present));

  function rasterize(out) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(2, 8000 / Math.max(out.width, out.height));
        const c = document.createElement('canvas');
        c.width = Math.round(out.width * scale);
        c.height = Math.round(out.height * scale);
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, out.width, out.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('the map could not be drawn'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg);
    });
  }
  $('#btnImage').addEventListener('click', async () => {
    const area = byId(focusId);
    const out = graph.toSVG(focusSet(), area ? area.name : '');
    if (!out) { toast('There is nothing to export yet.', true); return; }
    try {
      const png = await rasterize(out);
      const r = await hub.saveImage({ png, svg: out.svg, name: area ? area.name : 'Hub map' });
      if (r.ok) toast('Saved ' + r.file.split(/[\\/]/).pop());
      else if (!r.canceled) toast(r.error || 'Could not save the image.', true);
    } catch (e) {
      toast('Could not create the image: ' + e.message, true);
    }
  });

  document.querySelectorAll('#helpDlg .mod').forEach((k) => { k.textContent = OS === 'mac' ? '⌘' : 'Ctrl'; });
  $('#btnHelp').addEventListener('click', () => $('#helpDlg').showModal());
  $('#closeHelp').addEventListener('click', () => $('#helpDlg').close());
  $('#btnLog').addEventListener('click', () => hub.showLog());
  $('#search').placeholder = `Search, then Enter to open (${OS === 'mac' ? '⌘' : 'Ctrl'}+K)`;

  // ---------- updates ----------
  let manualCheck = false;
  let updateReady = false;
  let gotUpdateEvent = false;
  async function installNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; try { await hub.save(snapshot()); } catch { /* the window save on close is the backup */ } }
    hub.installUpdate();
  }
  let banner = { state: '', version: '' };
  hub.onUpdate((u) => {
    gotUpdateEvent = true;
    if (updateReady && u.state !== 'ready') return;
    const box = $('#update');
    const show = (...kids) => { box.replaceChildren(...kids); banner = { state: u.state, version: u.version || banner.version }; };
    const download = (label) => h('button', { class: 'primary', onclick: () => hub.installUpdate() }, label);
    if (u.state === 'available') show(`Update ${u.version} found. Downloading…`);
    else if (u.state === 'manual') show(`Version ${u.version} is available.`, download('Download'));
    else if (u.state === 'downloading') show(`Downloading update… ${u.percent}%`);
    else if (u.state === 'ready') {
      updateReady = true;
      show(`Version ${u.version} is ready.`, h('button', { class: 'primary', onclick: installNow }, 'Restart to update'));
    } else if (u.state === 'error' && (banner.state === 'available' || banner.state === 'downloading')) {
      // The automatic download failed: offer the release page instead of leaving a stale message.
      show(`Update ${banner.version} could not be downloaded.`, download('Download manually'));
      banner.state = 'manual';
    } else if (u.state === 'none' && manualCheck) toast('You have the latest version.');
    else if (u.state === 'error' && manualCheck) toast('Could not check for updates: ' + (u.message || 'unknown error'), true);
    if (u.state === 'none' || u.state === 'error') manualCheck = false;
  });
  $('#btnUpdate').addEventListener('click', async () => {
    manualCheck = true;
    gotUpdateEvent = false;
    const r = await hub.checkUpdates();
    if (r.state === 'dev') { manualCheck = false; toast('Updates only work in the installed app, not with npm start.', true); }
    else if (r.state === 'error') { manualCheck = false; toast(r.message || 'Update checking is not available.', true); }
    else if (!gotUpdateEvent) toast('Checking for updates…');
  });

  // ---------- start ----------
  async function reloadFromDisk(quiet) {
    const r = await hub.load();
    applyData(r.data, r.file);
    markBaseline();
    setStatus('All changes saved');
    if (r.warning) toast(r.warning, true);
    else if (!quiet) toast('Updated from the synced data file.');
    return r;
  }
  hub.onExternalChange(() => { if (!saveTimer) reloadFromDisk(false); });
  reloadFromDisk(true).then(() => graph.fit());
})();
