/* Family tree site — no build step, no dependencies. */
(() => {
  'use strict';

  // ---------- small helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('ft.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ft.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
  const plural = (n, one, many = one + 's') => `${n || 0} ${n === 1 ? one : many}`;
  const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const SITE = window.SITE || { title: 'Our Family Tree', tagline: '' };
  document.title = SITE.title;
  $('#site-title').textContent = SITE.title;

  // ---------- invite link handling: ?k=<family key>&from=<inviter> ----------
  const qs = new URLSearchParams(location.search);
  if (qs.get('k')) store.set('key', qs.get('k'));
  if (qs.get('from')) store.set('invitedBy', qs.get('from'));
  if (qs.has('k') || qs.has('from')) history.replaceState(null, '', location.pathname + location.hash);
  const KEY = store.get('key');
  const clientId = store.get('clientId') || (() => { const id = uid(); store.set('clientId', id); return id; })();

  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-family-key': KEY || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* non-JSON error page */ }
    if (!r.ok) throw new Error((data && data.error) || `Something went wrong (${r.status}). Please try again.`);
    return data;
  }
  const photoUrl = path => `/api/photo?path=${encodeURIComponent(path)}&k=${encodeURIComponent(KEY || '')}`;

  // ---------- tree data ----------
  let tree = null;
  let treeError = null;
  let treeLoadedAt = 0;
  const byId = id => tree && tree.people.find(p => p.id === id);
  async function loadTree(force) {
    if (tree && !force && Date.now() - treeLoadedAt < 30000) return tree;
    try {
      tree = await api('/api/tree');
      treeLoadedAt = Date.now();
      treeError = null;
      tree.people = tree.people || [];
      tree.photos = tree.photos || [];
      tree.submissionToPerson = tree.submissionToPerson || {};
      const dl = $('#known-names');
      dl.replaceChildren(...[...new Set(tree.people.map(p => p.name))].sort().map(n => h('option', { value: n })));
    } catch (e) {
      treeError = e.message;
      tree = tree || { people: [], photos: [], submissionToPerson: {}, stats: {} };
    }
    return tree;
  }
  const me = () => store.get('me');
  const myPersonId = () => { const m = me(); return m && tree && tree.submissionToPerson[m.submissionId]; };
  const inviterName = () => {
    const from = store.get('invitedBy');
    const p = from && tree && byId(tree.submissionToPerson[from]);
    return p ? p.name : null;
  };
  function inviteLink() {
    const m = me();
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('k', KEY || '');
    if (m && m.submissionId) u.searchParams.set('from', m.submissionId);
    return u.toString();
  }

  // ---------- router ----------
  const app = $('#app');
  const routes = { '': viewHome, join: viewJoin, tree: viewTree, invite: viewInvite, done: viewDone };
  async function render() {
    const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (!KEY) return app.replaceChildren(viewNoKey());
    app.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
    await loadTree();
    const view = routes[route] || viewHome;
    app.replaceChildren(await view(arg && decodeURIComponent(arg)));
  }
  window.addEventListener('hashchange', render);
  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

  // ---------- views ----------
  function viewNoKey() {
    return h('section', { class: 'card center' },
      h('div', { class: 'big-emoji' }, '🔒'),
      h('h1', {}, 'This is a private family site'),
      h('p', {}, 'Please open the invite link a family member sent you. If you have lost it, ask them to send it again.'));
  }

  function viewHome() {
    const inviter = inviterName();
    const m = me();
    const stats = tree.stats || {};
    return h('div', {},
      h('section', { class: 'hero' },
        inviter && !m ? h('p', { class: 'pill' }, `👋 ${inviter} invited you`) : null,
        h('h1', {}, m ? `Welcome back, ${firstName(m.name)}!` : SITE.title),
        h('p', { class: 'lead' }, m ? 'Thank you for adding yourself. Invite more relatives so every branch gets filled in.' : SITE.tagline),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary big', href: '#/join' }, m ? '✏️ Update my details' : '➕ Add myself to the tree'),
          h('a', { class: 'btn big', href: '#/tree' }, '🌳 Explore the family tree'),
          h('a', { class: 'btn big', href: '#/invite' }, '💌 Invite family')),
        stats.people ? h('p', { class: 'muted stats' }, [plural(stats.people, 'person', 'people'), plural(stats.contributors, 'family member', 'family members') + ' joined', plural(stats.photos, 'photo')].join(' · ')) : null,
        treeError ? h('p', { class: 'error' }, treeError) : null),
      h('section', { class: 'card how' },
        h('h2', {}, 'How it works'),
        h('ol', {},
          h('li', {}, h('b', {}, 'Add yourself'), ' — your name, your parents, grandparents, brothers & sisters, and children. Skip anything you don\'t know.'),
          h('li', {}, h('b', {}, 'Share a few photos'), ' — tap on faces to say who is who.'),
          h('li', {}, h('b', {}, 'Invite others'), ' — the tree connects everyone automatically as more relatives join.'))));
  }

  // ---------- join wizard ----------
  const emptyRel = () => ({ name: '', deceased: false, notes: '' });
  function newDraft() {
    return {
      self: { name: '', gender: null, birthYear: '', location: '', birthPlace: '', about: '' },
      father: emptyRel(), mother: emptyRel(),
      fatherParents: { father: emptyRel(), mother: emptyRel() },
      motherParents: { father: emptyRel(), mother: emptyRel() },
      spouse: emptyRel(), siblings: [], children: [], origins: '',
      profilePhotoPath: null, photos: [],
    };
  }
  let draft = Object.assign(newDraft(), store.get('draft') || {});
  // Photo pixels live only in memory; uploaded photos are remembered by their path.
  const photoData = new Map();
  let profileData = null;
  let refreshNext = () => {};
  function saveDraft() {
    store.set('draft', { ...draft, photos: draft.photos.filter(p => p.path) });
    refreshNext();
  }

  let step = 0;
  let flushers = [];

  const STEPS = [
    {
      title: () => 'Let\'s start with you',
      sub: 'Only your name is required. Everything else is optional.',
      body: () => [
        field('Your full name', input(draft.self, 'name', { placeholder: 'e.g. Lakshmi Ramesh Rao', autocomplete: 'name', list: 'known-names', required: true })),
        field('You are', segmented(draft.self, 'gender', [['female', 'Female'], ['male', 'Male'], [null, 'Prefer not to say']])),
        h('div', { class: 'row' },
          field('Year born', input(draft.self, 'birthYear', { inputmode: 'numeric', placeholder: 'e.g. 1972', maxlength: 4 })),
          field('Where you live now', input(draft.self, 'location', { placeholder: 'City, country' }))),
        field('Where you were born', input(draft.self, 'birthPlace', { placeholder: 'Town or city' })),
      ],
      valid: () => draft.self.name.trim().length > 1 || 'Please enter your name.',
    },
    {
      title: () => 'Your parents',
      sub: 'If someone has passed away, tick the box. You can add a short note about them too.',
      body: () => [relField('Father\'s name', draft.father), relField('Mother\'s name', draft.mother)],
    },
    {
      title: () => 'Your grandparents',
      sub: 'Write whatever you know — a first name is fine. Skip if you don\'t know.',
      body: () => [
        h('h3', { class: 'group' }, draft.father.name ? `${firstName(draft.father.name)}'s parents (father's side)` : 'Father\'s side'),
        relField('Grandfather', draft.fatherParents.father, 'Where they lived, their work, years…'),
        relField('Grandmother', draft.fatherParents.mother, 'Where they lived, their work, years…'),
        h('h3', { class: 'group' }, draft.mother.name ? `${firstName(draft.mother.name)}'s parents (mother's side)` : 'Mother\'s side'),
        relField('Grandfather', draft.motherParents.father, 'Where they lived, their work, years…'),
        relField('Grandmother', draft.motherParents.mother, 'Where they lived, their work, years…'),
      ],
    },
    {
      title: () => 'Brothers & sisters',
      sub: 'Type a name and press Add (or Enter). Add as many as you have.',
      body: () => [chipInput(draft.siblings, 'Brother or sister\'s name')],
    },
    {
      title: () => 'Your spouse & children',
      sub: 'Skip whatever doesn\'t apply.',
      body: () => [
        relField('Husband / wife / partner', draft.spouse),
        h('label', { class: 'label' }, 'Children'),
        chipInput(draft.children, 'Child\'s name'),
      ],
    },
    {
      title: () => 'Family roots',
      sub: 'A sentence or two is plenty — this helps everyone understand where the family comes from.',
      body: () => [
        field('Where does your family come from?', textarea(draft, 'origins', 'Ancestral village or town, region, languages spoken, family stories, migrations…')),
        field('A little about you (optional)', textarea(draft.self, 'about', 'Work, interests, anything you\'d like relatives to know…')),
      ],
    },
    {
      title: () => 'Add a photo of yourself',
      sub: 'Optional, but it helps relatives recognise you.',
      body: () => [profilePicker()],
    },
    {
      title: () => 'Share family photos',
      sub: 'Old photos are treasures! After adding, tap a face to say who it is — or tap names underneath.',
      body: () => [familyPhotos()],
    },
    {
      title: () => 'All set?',
      sub: 'Check everything looks right, then press Send.',
      body: () => [review()],
    },
  ];

  function viewJoin() {
    if (!draft.invitedBy && store.get('invitedBy')) draft.invitedBy = store.get('invitedBy');
    const wrap = h('section', { class: 'card wizard' });
    const draw = () => {
      flushers = [];
      const s = STEPS[step];
      const isLast = step === STEPS.length - 1;
      const err = h('p', { class: 'error', role: 'alert' });
      const next = () => {
        flushers.forEach(f => f());
        const ok = s.valid ? s.valid() : true;
        if (ok !== true) { err.textContent = ok; return; }
        saveDraft();
        if (isLast) return submit(wrap);
        step++; draw(); window.scrollTo(0, 0);
      };
      const nextBtn = h('button', { type: 'submit', class: 'btn primary' });
      refreshNext = () => { nextBtn.textContent = isLast ? 'Send ✓' : (step > 0 && stepIsEmpty(step) ? 'Skip →' : 'Next →'); };
      refreshNext();
      wrap.replaceChildren(
        h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { style: `width:${((step + 1) / STEPS.length) * 100}%` })),
        h('p', { class: 'muted small' }, `Step ${step + 1} of ${STEPS.length}`),
        h('h1', {}, s.title()),
        h('p', { class: 'lead' }, s.sub),
        h('form', { class: 'step', onsubmit: e => { e.preventDefault(); next(); } },
          ...s.body(),
          err,
          h('div', { class: 'nav-buttons' },
            step > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => { flushers.forEach(f => f()); saveDraft(); step--; draw(); } }, '← Back') : h('span'),
            nextBtn)));
      const first = wrap.querySelector('input:not([type=checkbox]):not([type=file])');
      if (first && step === 0 && !first.value) first.focus();
    };
    draw();
    return wrap;
  }

  function stepIsEmpty(i) {
    const d = draft;
    return [
      () => false,
      () => !d.father.name && !d.mother.name,
      () => ![d.fatherParents.father, d.fatherParents.mother, d.motherParents.father, d.motherParents.mother].some(r => r.name),
      () => !d.siblings.length,
      () => !d.spouse.name && !d.children.length,
      () => !d.origins && !d.self.about,
      () => !profileData && !d.profilePhotoPath,
      () => !d.photos.length,
      () => false,
    ][i]();
  }

  // ---------- form widgets ----------
  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label), control);
  }
  function input(obj, key, attrs = {}) {
    return h('input', { type: 'text', value: obj[key] || '', ...attrs, oninput: e => { obj[key] = e.target.value; saveDraft(); } });
  }
  function textarea(obj, key, placeholder) {
    const t = h('textarea', { rows: 4, placeholder, oninput: e => { obj[key] = e.target.value; saveDraft(); } });
    t.value = obj[key] || '';
    return t;
  }
  function segmented(obj, key, options) {
    const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
    const draw = () => wrap.replaceChildren(...options.map(([v, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(obj[key] === v), class: obj[key] === v ? 'on' : '', onclick: () => { obj[key] = v; saveDraft(); draw(); } }, label)));
    draw();
    return wrap;
  }
  function relField(label, rel, notePlaceholder = 'Anything you\'d like to share about them…') {
    const note = h('textarea', { rows: 2, placeholder: notePlaceholder, oninput: e => { rel.notes = e.target.value; saveDraft(); } });
    note.value = rel.notes || '';
    const noteWrap = h('div', { class: rel.notes ? '' : 'hidden' }, note);
    return h('div', { class: 'rel' },
      field(label, input(rel, 'name', { list: 'known-names', placeholder: 'Name', autocomplete: 'off' })),
      h('div', { class: 'rel-extras' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: !!rel.deceased, onchange: e => { rel.deceased = e.target.checked; saveDraft(); } }),
          ' Passed away'),
        h('button', { type: 'button', class: 'link', onclick: () => { noteWrap.classList.toggle('hidden'); note.focus(); } }, '+ Add a note')),
      noteWrap);
  }
  function chipInput(list, placeholder) {
    const chips = h('div', { class: 'chips' });
    const inp = h('input', { type: 'text', placeholder, list: 'known-names', autocomplete: 'off', enterkeyhint: 'enter' });
    const add = () => {
      for (const name of inp.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)) {
        if (!list.some(r => norm(r.name) === norm(name))) list.push({ ...emptyRel(), name });
      }
      inp.value = '';
      saveDraft();
      draw();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    flushers.push(() => { if (inp.value.trim()) add(); });
    const draw = () => chips.replaceChildren(...list.map((r, i) =>
      h('span', { class: 'chip' }, r.name,
        h('button', { type: 'button', 'aria-label': `Remove ${r.name}`, onclick: () => { list.splice(i, 1); saveDraft(); draw(); } }, '×'))));
    draw();
    return h('div', { class: 'chip-input' }, h('div', { class: 'chip-row' }, inp, h('button', { type: 'button', class: 'btn', onclick: add }, 'Add')), chips);
  }

  // ---------- photos ----------
  async function resizeImage(file, max, square) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error(`Couldn't open "${file.name}". Please choose a JPG or PNG photo.`));
        i.src = url;
      });
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) * 0.3; sw = sh = s; }
      const scale = Math.min(1, max / Math.max(sw, sh));
      const c = h('canvas', { width: Math.round(sw * scale), height: Math.round(sh * scale) });
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function filePicker(label, multiple, onFiles) {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple, class: 'visually-hidden', onchange: e => { onFiles([...e.target.files]); e.target.value = ''; } });
    return h('label', { class: 'dropzone' }, inp, h('span', { class: 'big-emoji' }, '📷'), h('span', {}, label));
  }

  function profilePicker() {
    const wrap = h('div', { class: 'profile-picker' });
    const draw = (msg) => {
      const src = profileData || (draft.profilePhotoPath && photoUrl(draft.profilePhotoPath));
      wrap.replaceChildren(
        src ? h('img', { class: 'avatar xl', src, alt: 'Your photo' }) : null,
        filePicker(src ? 'Choose a different photo' : 'Take or choose a photo', false, async ([f]) => {
          if (!f) return;
          draw('Preparing photo…');
          try { profileData = await resizeImage(f, 640, true); draft.profilePhotoPath = null; saveDraft(); draw(); } catch (e) { draw(e.message); }
        }),
        src ? h('button', { type: 'button', class: 'link', onclick: () => { profileData = null; draft.profilePhotoPath = null; saveDraft(); draw(); } }, 'Remove photo') : null,
        msg ? h('p', { class: 'muted' }, msg) : null);
    };
    draw();
    return wrap;
  }

  /** Everyone the person named in the form, for quick tagging. */
  function draftNames() {
    const d = draft;
    const out = [{ name: d.self.name || 'Me', self: true, label: 'Me' }];
    const add = (r, label) => { if (r && r.name && !out.some(o => norm(o.name) === norm(r.name))) out.push({ name: r.name.trim(), label }); };
    add(d.spouse, 'Spouse');
    d.children.forEach(r => add(r, 'Child'));
    add(d.father, 'Father');
    add(d.mother, 'Mother');
    d.siblings.forEach(r => add(r, 'Sibling'));
    add(d.fatherParents.father, 'Grandfather');
    add(d.fatherParents.mother, 'Grandmother');
    add(d.motherParents.father, 'Grandfather');
    add(d.motherParents.mother, 'Grandmother');
    return out;
  }

  function familyPhotos() {
    const wrap = h('div', { class: 'photos' });
    const status = h('p', { class: 'muted' });
    const list = h('div', { class: 'photo-list' });
    const drawList = () => list.replaceChildren(...draft.photos.map(ph => photoCard(ph, drawList)));
    wrap.append(
      filePicker('Add photos (you can pick several)', true, async files => {
        for (const [i, f] of files.entries()) {
          if (draft.photos.length >= 30) { status.textContent = 'That\'s the limit of 30 photos for now — thank you!'; break; }
          status.textContent = `Preparing photo ${i + 1} of ${files.length}…`;
          try {
            const id = uid();
            photoData.set(id, await resizeImage(f, 1600, false));
            draft.photos.push({ id, path: null, caption: '', tags: [] });
            drawList();
          } catch (e) { status.textContent = e.message; }
        }
        if (status.textContent.startsWith('Preparing')) status.textContent = '';
      }),
      status, list);
    drawList();
    return wrap;
  }

  function photoCard(ph, redrawAll) {
    const src = photoData.get(ph.id) || (ph.path && photoUrl(ph.path));
    const card = h('div', { class: 'photo-card' });
    const draw = () => {
      const img = h('img', { src, alt: ph.caption || 'Family photo', draggable: 'false' });
      const stage = h('div', { class: 'tagger', title: 'Tap a face to tag who it is' }, img,
        ...ph.tags.filter(t => t.x != null).map((t, i) => h('button', {
          type: 'button', class: 'tag-marker', style: `left:${t.x * 100}%;top:${t.y * 100}%`,
          title: 'Tap to remove', onclick: e => { e.stopPropagation(); ph.tags.splice(ph.tags.indexOf(t), 1); saveDraft(); draw(); },
        }, h('span', {}, t.self ? 'Me' : firstName(t.name)), ' ×')));
      stage.addEventListener('click', async e => {
        const r = img.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        const who = await pickName();
        if (!who) return;
        ph.tags = ph.tags.filter(t => norm(t.name) !== norm(who.name));
        ph.tags.push({ name: who.name, self: !!who.self, x, y });
        saveDraft(); draw();
      });
      const names = draftNames();
      const extra = ph.tags.filter(t => !names.some(n => norm(n.name) === norm(t.name)));
      const caption = h('input', { type: 'text', value: ph.caption, placeholder: 'Caption — e.g. "Wedding in Mysore, 1978"', oninput: e => { ph.caption = e.target.value; saveDraft(); } });
      card.replaceChildren(stage,
        h('p', { class: 'muted small' }, 'Who is in this photo? Tap faces above, or tap names:'),
        h('div', { class: 'chips toggles' },
          ...[...names, ...extra.map(t => ({ name: t.name }))].map(n => {
            const on = ph.tags.some(t => norm(t.name) === norm(n.name));
            return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
              if (on) ph.tags = ph.tags.filter(t => norm(t.name) !== norm(n.name));
              else ph.tags.push({ name: n.name, self: !!n.self, x: null, y: null });
              saveDraft(); draw();
            } }, on ? '✓ ' : '', n.label ? `${n.label === 'Me' ? 'Me' : n.name}` : n.name);
          }),
          h('button', { type: 'button', class: 'chip add', onclick: async () => {
            const who = await pickName(true);
            if (who && !ph.tags.some(t => norm(t.name) === norm(who.name))) { ph.tags.push({ name: who.name, self: !!who.self, x: null, y: null }); saveDraft(); draw(); }
          } }, '+ Someone else')),
        caption,
        h('button', { type: 'button', class: 'link danger', onclick: () => {
          draft.photos.splice(draft.photos.indexOf(ph), 1); photoData.delete(ph.id); saveDraft(); redrawAll();
        } }, 'Remove this photo'));
    };
    draw();
    return card;
  }

  /** Bottom sheet to choose who is in a photo. */
  function pickName(onlyOther) {
    return new Promise(resolve => {
      const done = v => { sheet.remove(); resolve(v); };
      const other = h('input', { type: 'text', placeholder: 'Type a name', list: 'known-names', autocomplete: 'off' });
      const sheet = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === sheet) done(null); } },
        h('form', { class: 'sheet', onsubmit: e => { e.preventDefault(); if (other.value.trim()) done({ name: other.value.trim() }); } },
          h('h3', {}, 'Who is this?'),
          onlyOther ? null : h('div', { class: 'chips' }, ...draftNames().map(n =>
            h('button', { type: 'button', class: 'chip', onclick: () => done(n) }, n.label === 'Me' ? 'Me' : n.name))),
          h('div', { class: 'chip-row' }, other, h('button', { type: 'submit', class: 'btn primary' }, 'OK')),
          h('button', { type: 'button', class: 'link', onclick: () => done(null) }, 'Cancel')));
      document.body.append(sheet);
      if (onlyOther) other.focus();
    });
  }

  function review() {
    const d = draft;
    const line = (label, v) => (v ? h('div', { class: 'review-line' }, h('span', { class: 'muted' }, label), h('span', {}, v)) : null);
    const rel = r => (r && r.name ? r.name + (r.deceased ? ' 🕊' : '') : '');
    const jump = i => h('button', { type: 'button', class: 'link', onclick: () => { step = i; render(); } }, 'Edit');
    return h('div', { class: 'review' },
      h('div', { class: 'review-block' }, h('h3', {}, 'You ', jump(0)),
        line('Name', d.self.name), line('Born', [d.self.birthYear, d.self.birthPlace].filter(Boolean).join(', ')), line('Lives in', d.self.location)),
      h('div', { class: 'review-block' }, h('h3', {}, 'Family ', jump(1)),
        line('Father', rel(d.father)), line('Mother', rel(d.mother)),
        line('Father\'s parents', [rel(d.fatherParents.father), rel(d.fatherParents.mother)].filter(Boolean).join(' & ')),
        line('Mother\'s parents', [rel(d.motherParents.father), rel(d.motherParents.mother)].filter(Boolean).join(' & ')),
        line('Brothers & sisters', d.siblings.map(rel).join(', ')),
        line('Spouse', rel(d.spouse)), line('Children', d.children.map(rel).join(', '))),
      d.origins ? h('div', { class: 'review-block' }, h('h3', {}, 'Roots ', jump(5)), h('p', {}, d.origins)) : null,
      h('div', { class: 'review-block' }, h('h3', {}, 'Photos ', jump(7)),
        h('p', {}, `${(profileData || d.profilePhotoPath) ? 'Your photo + ' : ''}${d.photos.length} family photo${d.photos.length === 1 ? '' : 's'}`)));
  }

  async function submit(wrap) {
    const status = h('p', { class: 'lead' }, 'Sending…');
    const bar = h('div', { style: 'width:5%' });
    wrap.replaceChildren(h('h1', {}, 'Saving to the family tree'), h('div', { class: 'progress' }, bar), status);
    const pending = draft.photos.filter(p => !p.path && photoData.has(p.id));
    const total = pending.length + (profileData ? 1 : 0) + 1;
    let n = 0;
    const tick = msg => { n++; bar.style.width = `${(n / total) * 100}%`; status.textContent = msg; };
    try {
      if (profileData) {
        status.textContent = 'Uploading your photo…';
        draft.profilePhotoPath = (await api('/api/upload-photo', { image: profileData })).path;
        profileData = null; saveDraft(); tick('Uploaded your photo');
      }
      for (const [i, ph] of pending.entries()) {
        status.textContent = `Uploading photo ${i + 1} of ${pending.length}…`;
        ph.path = (await api('/api/upload-photo', { image: photoData.get(ph.id) })).path;
        saveDraft(); tick(`Uploaded photo ${i + 1} of ${pending.length}`);
      }
      draft.photos = draft.photos.filter(p => p.path);
      status.textContent = 'Saving your details…';
      const { profilePhotoPath, photos, ...rest } = draft;
      const { id } = await api('/api/submit', {
        submission: {
          ...rest, clientId, profilePhoto: profilePhotoPath,
          photos: photos.map(p => ({ path: p.path, caption: p.caption, tags: p.tags })),
        },
      });
      const prev = me();
      store.set('me', { submissionId: (prev && prev.submissionId) || id, latest: id, name: draft.self.name });
      saveDraft();
      step = 0;
      tree = null; // refetch so the new entry shows up as soon as it's organized
      go('#/done');
    } catch (e) {
      wrap.replaceChildren(
        h('h1', {}, 'That didn\'t work'),
        h('p', { class: 'error' }, e.message),
        h('p', {}, 'Nothing you entered has been lost.'),
        h('div', { class: 'nav-buttons' },
          h('button', { class: 'btn', onclick: () => render() }, '← Back to form'),
          h('button', { class: 'btn primary', onclick: () => submit(wrap) }, 'Try again')));
    }
  }

  function viewDone() {
    const m = me();
    return h('section', { class: 'card center' },
      h('div', { class: 'big-emoji' }, '🎉'),
      h('h1', {}, `Thank you, ${firstName(m && m.name)}!`),
      h('p', { class: 'lead' }, 'You\'ll appear in the tree in about a minute. The tree grows as more relatives join — please invite them!'),
      shareBox(),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/tree' }, '🌳 See the tree')));
  }

  // ---------- invite ----------
  function shareBox() {
    const link = inviteLink();
    const m = me();
    const msg = `${m ? `Hi! It's ${firstName(m.name)}. ` : 'Hi! '}We're building our family tree together. Please add yourself (takes 3 minutes) and invite others: ${link}`;
    const copied = h('span', { class: 'muted small' });
    return h('div', { class: 'share' },
      h('p', { class: 'label' }, 'Your personal invite link'),
      h('div', { class: 'chip-row' },
        h('input', { type: 'text', value: link, readonly: true, onclick: e => e.target.select() }),
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(link); copied.textContent = 'Copied!'; } catch { copied.textContent = 'Select the link and copy it.'; } } }, 'Copy')),
      copied,
      h('div', { class: 'share-buttons' },
        navigator.share ? h('button', { class: 'btn primary', onclick: () => navigator.share({ title: SITE.title, text: msg }).catch(() => {}) }, '📤 Share…') : null,
        h('a', { class: 'btn whatsapp', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        h('a', { class: 'btn', href: `sms:?&body=${encodeURIComponent(msg)}` }, 'Text message'),
        h('a', { class: 'btn', href: `mailto:?subject=${encodeURIComponent(SITE.title)}&body=${encodeURIComponent(msg)}` }, 'Email')));
  }

  function viewInvite() {
    const m = me();
    return h('section', { class: 'card' },
      h('h1', {}, 'Invite family'),
      h('p', { class: 'lead' }, 'Send this link to any relative. They\'ll be guided through adding themselves, and can invite others too — the tree connects everyone automatically.'),
      m ? null : h('p', { class: 'note' }, 'Tip: ', h('a', { href: '#/join' }, 'add yourself first'), ' so people see who invited them.'),
      shareBox(),
      h('p', { class: 'muted small' }, 'Keep this link within the family — anyone with it can view the tree.'));
  }

  // ---------- tree ----------
  function personName(id) { const p = byId(id); return p ? p.name : ''; }
  function avatar(p, size = '') {
    if (p.photo) return h('img', { class: `avatar ${size}`, src: photoUrl(p.photo), alt: '', loading: 'lazy' });
    return h('span', { class: `avatar ${size} initials ${p.gender || ''}`, 'aria-hidden': 'true' }, initials(p.name));
  }
  function personCard(p, label, big) {
    if (!p) return null;
    const years = [p.birthYear, p.deceased ? '🕊' : null].filter(Boolean).join(' ');
    return h('a', { class: 'person' + (big ? ' focus' : '') + (p.selfSubmitted ? ' joined' : ''), href: `#/tree/${p.id}` },
      avatar(p, big ? 'lg' : ''),
      h('span', { class: 'pname' }, p.name),
      label ? h('span', { class: 'plabel' }, label) : null,
      years ? h('span', { class: 'pyears' }, years) : null);
  }
  function rowOf(title, people, labelFn) {
    const list = people.filter(Boolean);
    if (!list.length) return null;
    return h('div', { class: 'gen' }, h('h3', {}, title), h('div', { class: 'gen-row' }, ...list.map(p => personCard(p, labelFn && labelFn(p)))));
  }

  async function viewTree(focusId) {
    const people = tree.people;
    const wrap = h('div', { class: 'tree' });
    const m = me();
    if (m && !tree.submissionToPerson[m.latest || m.submissionId]) {
      wrap.append(h('p', { class: 'note' }, '⏳ Your latest entry is being added to the tree. ',
        h('button', { class: 'link', onclick: async () => { await loadTree(true); render(); } }, 'Refresh')));
    }
    if (treeError) wrap.append(h('p', { class: 'error' }, treeError));
    if (!people.length) {
      wrap.append(h('section', { class: 'card center' }, h('div', { class: 'big-emoji' }, '🌱'),
        h('h1', {}, 'The tree is just starting'), h('p', {}, 'Be the first to add yourself!'),
        h('a', { class: 'btn primary big', href: '#/join' }, '➕ Add myself')));
      return wrap;
    }
    const degree = p => p.parents.length + p.children.length + p.spouses.length + p.siblings.length;
    const focus = byId(focusId) || byId(myPersonId()) || [...people].sort((a, b) => degree(b) - degree(a))[0];
    const P = ids => ids.map(byId).filter(Boolean);

    const search = h('input', { type: 'search', placeholder: '🔍 Find someone…', list: 'known-names', 'aria-label': 'Find someone' });
    search.addEventListener('change', () => {
      const q = norm(search.value);
      const hit = people.find(p => norm(p.name) === q) || people.find(p => p.aliases.some(a => a.includes(q)));
      if (hit) go(`#/tree/${hit.id}`);
    });

    const parents = P(focus.parents);
    const gpRows = parents.map(par => rowOf(`${par.name}'s parents`, P(par.parents)));
    const grandkids = P(focus.children).flatMap(c => P(c.children));
    const relLabel = (p, role) => ({ parent: p.gender === 'male' ? 'Father' : p.gender === 'female' ? 'Mother' : 'Parent', child: p.gender === 'male' ? 'Son' : p.gender === 'female' ? 'Daughter' : 'Child', sibling: p.gender === 'male' ? 'Brother' : p.gender === 'female' ? 'Sister' : 'Sibling' })[role];

    wrap.append(
      h('div', { class: 'tree-tools' }, search,
        h('button', { class: 'btn small', onclick: async () => { await loadTree(true); render(); } }, '↻')),
      h('section', { class: 'card family-view' },
        h('div', { class: 'gp-rows' }, ...gpRows),
        rowOf('Parents', parents, p => relLabel(p, 'parent')),
        h('div', { class: 'gen center-gen' },
          h('div', { class: 'gen-row' }, personCard(focus, focus.id === myPersonId() ? 'You' : null, true),
            ...P(focus.spouses).map(s => personCard(s, 'Spouse')))),
        rowOf('Brothers & sisters', P(focus.siblings), p => relLabel(p, 'sibling')),
        rowOf('Children', P(focus.children), p => relLabel(p, 'child')),
        rowOf('Grandchildren', grandkids)),
      personDetails(focus),
      everyone());
    return wrap;
  }

  function personDetails(p) {
    const photos = tree.photos.filter(ph => ph.tags.some(t => t.personId === p.id) || ph.uploadedBy === p.id);
    const facts = [
      p.birthYear && ['Born', [p.birthYear, p.birthPlace].filter(Boolean).join(', ')],
      !p.birthYear && p.birthPlace && ['Born in', p.birthPlace],
      p.location && ['Lives in', p.location],
      p.deceased && ['', '🕊 Passed away'],
    ].filter(Boolean);
    const shared = p.notes.map(n => h('blockquote', {}, n.text, n.by ? h('cite', {}, ` — shared by ${personName(n.by)}`) : null));
    const invitedBy = p.invitedBy && byId(p.invitedBy);
    return h('section', { class: 'card details' },
      h('div', { class: 'details-head' }, avatar(p, 'xl'),
        h('div', {}, h('h2', {}, p.name),
          ...facts.map(([k, v]) => h('p', { class: 'fact' }, k ? h('span', { class: 'muted' }, k + ' ') : null, v)),
          p.selfSubmitted ? h('p', { class: 'muted small' }, '✓ Added themselves', invitedBy ? ` · invited by ${invitedBy.name}` : '')
            : (p.mentionedBy.length ? h('p', { class: 'muted small' }, `Added by ${p.mentionedBy.map(personName).join(', ')}`) : null))),
      p.about ? h('div', {}, h('h3', {}, 'About'), h('p', { class: 'pre' }, p.about)) : null,
      p.origins ? h('div', {}, h('h3', {}, 'Family roots'), h('p', { class: 'pre' }, p.origins)) : null,
      shared.length ? h('div', {}, h('h3', {}, 'Memories & notes'), ...shared) : null,
      photos.length ? h('div', {}, h('h3', {}, `Photos (${photos.length})`),
        h('div', { class: 'gallery' }, ...photos.map(ph => h('button', { class: 'thumb', onclick: () => lightbox(ph) },
          h('img', { src: photoUrl(ph.path), alt: ph.caption || 'Family photo', loading: 'lazy' }))))) : null,
      p.selfSubmitted ? null : h('p', { class: 'muted small' }, `Know ${firstName(p.name)}? `, h('a', { href: '#/invite' }, `Invite them to add their own details.`)));
  }

  function everyone() {
    const people = [...tree.people].sort((a, b) => a.name.localeCompare(b.name));
    return h('details', { class: 'card everyone' },
      h('summary', {}, `Everyone in the tree (${people.length})`),
      h('ul', {}, ...people.map(p => h('li', {}, h('a', { href: `#/tree/${p.id}` }, avatar(p, 'sm'), p.name, p.selfSubmitted ? h('span', { class: 'joined-dot', title: 'Joined' }, ' ●') : null)))));
  }

  function lightbox(ph) {
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const label = t => (t.personId ? personName(t.personId) : t.name);
    const box = h('div', { class: 'lightbox', onclick: e => { if (e.target === box) close(); } },
      h('div', { class: 'lightbox-inner' },
        h('button', { class: 'close', 'aria-label': 'Close', onclick: close }, '×'),
        h('div', { class: 'tagger view' }, h('img', { src: photoUrl(ph.path), alt: ph.caption || 'Family photo' }),
          ...ph.tags.filter(t => t.x != null).map(t => h('span', { class: 'tag-marker', style: `left:${t.x * 100}%;top:${t.y * 100}%` }, label(t)))),
        ph.caption ? h('p', { class: 'caption' }, ph.caption) : null,
        ph.tags.length ? h('p', {}, 'In this photo: ', ...ph.tags.map((t, i) => [i ? ', ' : '',
          t.personId ? h('a', { href: `#/tree/${t.personId}`, onclick: close }, label(t)) : label(t)])) : null,
        h('p', { class: 'muted small' }, `Shared by ${personName(ph.uploadedBy)}`)));
    document.body.append(box);
  }

  render();
})();
